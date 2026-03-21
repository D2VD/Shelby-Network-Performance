/**
 * workers/geo-sync.ts — v2.7 FINAL
 *
 * ROOT CAUSE ĐÃ TÌM RA:
 * Shelby dùng BigOrderedMap (BPlusTreeMap) để store blobs.
 * Move Table blob_data có N slots (table items), mỗi slot là 1 BPlusTreeMap node
 * chứa nhiều blobs trong children.entries[].
 *
 * Để đếm totalBlobs: paginate qua current_table_items, sum len(entries) mỗi slot
 * Để tính totalSize: sum blob_size từ mỗi entry.value.value.blob_size
 *
 * Indexer không support _aggregate → dùng limit/offset pagination
 */

interface Env {
  SHELBY_KV_MAINNET: KVNamespace;
  SHELBY_KV_TESTNET: KVNamespace;
  SHELBY_R2:         R2Bucket;
  SYNC_SECRET?:      string;
}

const NETWORKS = {
  shelbynet: {
    coreAddress:     "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    nodeUrl:         "https://api.shelbynet.shelby.xyz/v1",
    indexerUrl:      "https://api.shelbynet.shelby.xyz/v1/graphql",
    blobTableHandle: "0xe41f1fa92a4beeacd0b83b7e05d150e2b260f6b7f934f62a5843f762260d5cb8",
  },
  testnet: {
    coreAddress:     "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    nodeUrl:         "https://api.testnet.aptoslabs.com/v1",
    indexerUrl:      "https://api.testnet.aptoslabs.com/v1/graphql",
    blobTableHandle: "",
  },
} as const;

type NetworkId = keyof typeof NETWORKS;

const ZONE_COORDS: Record<string, { lat: number; lng: number; city: string; country: string }> = {
  dc_asia:      { lat:   1.3521,   lng:  103.8198, city: "Singapore",  country: "SG" },
  dc_australia: { lat: -33.8688,   lng:  151.2093, city: "Sydney",     country: "AU" },
  dc_europe:    { lat:  50.1109,   lng:    8.6821, city: "Frankfurt",  country: "DE" },
  dc_us_east:   { lat:  39.0438,   lng:  -77.4360, city: "Virginia",   country: "US" },
  dc_us_west:   { lat:  37.3382,   lng: -121.8863, city: "San Jose",   country: "US" },
};

interface RawProvider { address: string; zone: string; state: string; health: string; bls_key?: string; capacity?: string; net_address?: string; }
interface GeoResult { lat: number; lng: number; city?: string; region?: string; country?: string; countryCode?: string; isp?: string; source: "geo-ip" | "zone-fallback"; geocodedAt: string; }
interface NodeRecord { address: string; addressShort: string; availabilityZone: string; state: string; health: string; blsKey: string; fullBlsKey?: string; capacityTiB?: number; netAddress?: string; geo: GeoResult; updatedAt: string; }
interface StatsSnapshot { network: string; ts: string; blockHeight: number; totalBlobs: number; totalStorageUsedBytes: number; storageProviders: number; placementGroups: number; slices: number; totalBlobEvents: number; }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
function trunc(addr: string, f = 6, b = 4) { if (!addr || addr.length <= f + b + 3) return addr; return `${addr.slice(0, f)}...${addr.slice(-b)}`; }
function getKV(env: Env, n: NetworkId): KVNamespace { return n === "shelbynet" ? env.SHELBY_KV_MAINNET : env.SHELBY_KV_TESTNET; }
function nb(v: any, fb = 0): number { const x = Number(v ?? fb); return isNaN(x) ? fb : x; }

async function doGql(indexerUrl: string, query: string, variables?: any): Promise<any> {
  const r = await fetch(indexerUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// ── Core: đếm blobs bằng cách paginate qua current_table_items ──────────────
// Mỗi table item = 1 BPlusTreeMap slot, chứa N blobs trong root.children.entries
async function countBlobsFromTable(indexerUrl: string, handle: string): Promise<{
  totalBlobs: number;
  totalStorageUsedBytes: number;
  slotCount: number;
}> {
  let totalBlobs = 0;
  let totalStorageUsedBytes = 0;
  let slotCount = 0;
  let offset = 0;
  const PAGE = 100; // items per page
  const MAX_PAGES = 50; // max 5000 slots để tránh timeout

  while (true) {
    const query = `
      query BlobSlots($handle: String!, $limit: Int!, $offset: Int!) {
        current_table_items(
          where: { table_handle: { _eq: $handle } }
          limit: $limit
          offset: $offset
          order_by: { key: asc }
        ) {
          decoded_value
        }
      }
    `;

    const data = await doGql(indexerUrl, query, { handle, limit: PAGE, offset });
    const items: any[] = data?.current_table_items ?? [];

    if (items.length === 0) break;

    for (const item of items) {
      slotCount++;
      const dv = item.decoded_value;

      // Traverse BPlusTreeMap: root.children.entries[] và nodes.slots
      // Leaf node: entries trực tiếp trong root.children.entries
      // Inner node: children point to other nodes
      const count = countEntriesInBPlusTree(dv);
      const { blobCount, totalSize } = countBlobsInBPlusTree(dv);
      totalBlobs += blobCount;
      totalStorageUsedBytes += totalSize;
    }

    offset += items.length;
    if (items.length < PAGE) break;
    if (offset / PAGE >= MAX_PAGES) {
      // Đã đọc MAX_PAGES, extrapolate nếu cần
      // Lấy tổng slot count từ max_leaf_index của slot đầu tiên nếu có
      break;
    }
  }

  return { totalBlobs, totalStorageUsedBytes, slotCount };
}

// Đếm số entries trong 1 BPlusTreeMap node (recursive cho inner nodes)
function countEntriesInBPlusTree(node: any): number {
  if (!node) return 0;
  let count = 0;

  // Check root entries (leaf node)
  const rootEntries = node?.root?.children?.entries ?? [];
  count += rootEntries.length;

  // Check nodes slots (inner nodes có thể có thêm entries)
  const slots = node?.nodes?.slots?.vec ?? [];
  for (const slot of slots) {
    if (!slot) continue;
    const slotEntries = slot?.children?.entries ?? slot?.value?.children?.entries ?? [];
    count += slotEntries.length;
  }

  return count;
}

// Đếm blobs VÀ tổng size trong 1 BPlusTreeMap
function countBlobsInBPlusTree(node: any): { blobCount: number; totalSize: number } {
  if (!node) return { blobCount: 0, totalSize: 0 };
  let blobCount = 0;
  let totalSize = 0;

  function processEntries(entries: any[]) {
    for (const entry of entries) {
      if (!entry) continue;
      // entry.value.value.blob_size hoặc entry.value.blob_size
      const blobData = entry?.value?.value ?? entry?.value ?? entry;
      const size = nb(blobData?.blob_size ?? blobData?.size ?? 0);
      if (size >= 0) {
        blobCount++;
        totalSize += size;
      }
    }
  }

  // Leaf: root.children.entries
  processEntries(node?.root?.children?.entries ?? []);

  // Inner nodes in slots
  const slots = node?.nodes?.slots?.vec ?? [];
  for (const slot of slots) {
    if (!slot) continue;
    processEntries(slot?.children?.entries ?? slot?.value?.children?.entries ?? []);
  }

  return { blobCount, totalSize };
}

// ── Fetch all network stats ────────────────────────────────────────────────────
async function fetchNetworkStats(network: NetworkId): Promise<Partial<StatsSnapshot>> {
  const cfg = NETWORKS[network];
  let blockHeight = 0, totalBlobs = 0, totalStorageUsedBytes = 0,
      storageProviders = 0, placementGroups = 0, slices = 0, totalBlobEvents = 0;

  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const d: any = await r.json(); blockHeight = Number(d.block_height ?? 0); }
  } catch {}

  // Blob count từ table items
  const handle = (cfg as any).blobTableHandle as string ||
    await (async () => {
      try {
        const r = await fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::blob_metadata::Blobs`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const d: any = await r.json(); return d?.data?.blob_data?.handle ?? ""; }
      } catch {} return "";
    })();

  if (handle) {
    try {
      const { totalBlobs: tb, totalStorageUsedBytes: ts } = await countBlobsFromTable(cfg.indexerUrl, handle);
      totalBlobs = tb;
      totalStorageUsedBytes = ts;
    } catch (e) { console.error("[stats] blob count failed:", e); }
  }

  // Providers, PGs, Slices
  try {
    const [pgR, spR, slR] = await Promise.allSettled([
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (pgR.status === "fulfilled" && pgR.value.ok) { const d: any = await pgR.value.json(); placementGroups = nb(d?.data?.next_unassigned_placement_group_index); }
    if (spR.status === "fulfilled" && spR.value.ok) { const d: any = await spR.value.json(); (d?.data?.active_providers_by_az?.root?.children?.entries ?? []).forEach((z: any) => { storageProviders += (z.value?.value ?? []).length; }); }
    if (slR.status === "fulfilled" && slR.value.ok) { const d: any = await slR.value.json(); slices = nb(d?.data?.slices?.big_vec?.vec?.[0]?.end_index) + nb(d?.data?.slices?.inline_vec?.length); }
  } catch {}

  return { blockHeight, totalBlobs, totalStorageUsedBytes, storageProviders, placementGroups, slices, totalBlobEvents };
}

// ── Provider helpers ───────────────────────────────────────────────────────────
async function geocodeIP(ip: string, zone: string): Promise<GeoResult> {
  const now = new Date().toISOString();
  const fb = ZONE_COORDS[zone] ?? { lat: 0, lng: 0, city: "Unknown", country: "??" };
  if (!ip || /^(10\.|192\.168\.|127\.|0\.0\.0\.0)/.test(ip)) return { ...fb, source: "zone-fallback", geocodedAt: now };
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,city,regionName,country,countryCode,isp`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error("ip-api"); const d: any = await r.json();
    if (d.status !== "success") throw new Error("fail");
    return { lat: d.lat, lng: d.lon, city: d.city, region: d.regionName, country: d.country, countryCode: d.countryCode, isp: d.isp, source: "geo-ip", geocodedAt: now };
  } catch { return { ...fb, source: "zone-fallback", geocodedAt: now }; }
}

async function fetchIndexer(url: string): Promise<RawProvider[]> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: `{ current_storage_providers { address zone state health bls_key capacity net_address } }` }), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Indexer ${r.status}`); const j: any = await r.json();
  const sps = j.data?.current_storage_providers; if (!sps?.length) throw new Error("Empty"); return sps;
}

async function fetchRPC(nodeUrl: string, core: string): Promise<RawProvider[]> {
  const r = await fetch(`${nodeUrl}/accounts/${core}/resource/${core}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`RPC ${r.status}`); const j: any = await r.json();
  const zones: any[] = j?.data?.active_providers_by_az?.root?.children?.entries ?? [];
  const out: RawProvider[] = [];
  for (const z of zones) for (const n of (z.value?.value ?? [])) out.push({ address: n.addr, zone: z.key, state: "Active", health: n.status?.condition === 0 ? "Healthy" : "Faulty", bls_key: "", net_address: "", capacity: n.status?.quota?.value });
  return out;
}

async function writeR2Snapshot(env: Env, network: NetworkId, ctx: ExecutionContext) {
  try {
    const stats = await fetchNetworkStats(network); const now = new Date();
    const key = `snapshots/${network}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${String(now.getUTCDate()).padStart(2,"0")}/${String(now.getUTCHours()).padStart(2,"0")}.json`;
    const snap: StatsSnapshot = { network, ts: now.toISOString(), blockHeight: stats.blockHeight??0, totalBlobs: stats.totalBlobs??0, totalStorageUsedBytes: stats.totalStorageUsedBytes??0, storageProviders: stats.storageProviders??0, placementGroups: stats.placementGroups??0, slices: stats.slices??0, totalBlobEvents: stats.totalBlobEvents??0 };
    ctx.waitUntil(env.SHELBY_R2.put(key, JSON.stringify(snap), { httpMetadata: { contentType: "application/json" } }));
    console.log(`[r2] blobs=${snap.totalBlobs} size=${snap.totalStorageUsedBytes}`);
  } catch (e) { console.error("[r2]", e); }
}

async function syncNetwork(network: NetworkId, env: Env, ctx: ExecutionContext): Promise<{ synced: number; errors: string[] }> {
  const cfg = NETWORKS[network]; const kv = getKV(env, network); const errors: string[] = [];
  let raw: RawProvider[] = [];
  try { raw = await fetchIndexer(cfg.indexerUrl); }
  catch { try { raw = await fetchRPC(cfg.nodeUrl, cfg.coreAddress); } catch (e: any) { errors.push(e.message); return { synced: 0, errors }; } }
  if (!raw.length) return { synced: 0, errors: ["No providers"] };
  const records: NodeRecord[] = []; const addrs: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (i > 0 && i % 10 === 0) await new Promise(r => setTimeout(r, 1000));
    const p = raw[i]; const geo = await geocodeIP(p.net_address ?? "", p.zone ?? "");
    records.push({ address: p.address, addressShort: trunc(p.address), availabilityZone: p.zone??"unknown", state: p.state??"Active", health: p.health??"Healthy", blsKey: p.bls_key?trunc(p.bls_key,8,8):"", fullBlsKey: p.bls_key??"", capacityTiB: p.capacity?Number(p.capacity)/(1024**4):undefined, netAddress: p.net_address, geo, updatedAt: new Date().toISOString() });
    addrs.push(p.address);
  }
  const writes = records.map(r => kv.put(`node:${r.address}`, JSON.stringify(r), { expirationTtl: 7200 }));
  writes.push(kv.put("index:providers", JSON.stringify({ addresses: addrs, updatedAt: new Date().toISOString(), network, count: addrs.length }), { expirationTtl: 7200 }));
  ctx.waitUntil(Promise.allSettled(writes));
  await writeR2Snapshot(env, network, ctx);
  return { synced: records.length, errors };
}

// ── HTTP Handlers ──────────────────────────────────────────────────────────────
async function handleNodes(url: URL, env: Env): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const kv = getKV(env, network);
  try {
    const indexStr = await kv.get("index:providers");
    if (!indexStr) return Response.json({ ok: false, error: "KV not populated", data: { providers: [], count: 0 } }, { headers: CORS });
    const index: { addresses: string[] } = JSON.parse(indexStr);
    const nodeStrs = await Promise.all(index.addresses.map(a => kv.get(`node:${a}`)));
    const providers = nodeStrs.filter(Boolean).map(s => { const r: NodeRecord = JSON.parse(s!); return { ...r, coordinates: [r.geo.lng, r.geo.lat] as [number, number] }; });
    return Response.json({ ok: true, network, source: "kv", data: { providers, count: providers.length }, fetchedAt: new Date().toISOString() }, { headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
  } catch (e: any) { return Response.json({ ok: false, error: e.message, data: { providers: [], count: 0 } }, { status: 500, headers: CORS }); }
}

async function handleSnapshots(url: URL, env: Env): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const limit = Math.min(168, Number(url.searchParams.get("limit") ?? "24"));
  try {
    const list = await env.SHELBY_R2.list({ prefix: `snapshots/${network}/`, limit: limit+5 });
    const keys = list.objects.map(o => o.key).sort((a,b) => b.localeCompare(a)).slice(0, limit);
    const snaps = (await Promise.all(keys.map(async k => { const obj = await env.SHELBY_R2.get(k); if (!obj) return null; return JSON.parse(await obj.text()) as StatsSnapshot; }))).filter(Boolean).sort((a,b) => new Date(a!.ts).getTime()-new Date(b!.ts).getTime()) as StatsSnapshot[];
    return Response.json({ ok: true, network, data: { snapshots: snaps, count: snaps.length }, fetchedAt: new Date().toISOString() }, { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
  } catch (e: any) { return Response.json({ ok: false, error: e.message, data: { snapshots: [], count: 0 } }, { status: 500, headers: CORS }); }
}

async function handleStats(url: URL, env: Env): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (!NETWORKS[network]) return Response.json({ ok: false, error: "Unknown network" }, { status: 400, headers: CORS });
  const cfg = NETWORKS[network];

  let node = null;
  try { const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5000) }); if (r.ok) { const d: any = await r.json(); node = { blockHeight: nb(d.block_height), ledgerVersion: nb(d.ledger_version), chainId: nb(d.chain_id) }; } } catch {}

  let stats: Record<string, number | null> = { totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, storageProviders: null, placementGroups: null, slices: null };
  let source = "none";
  let slotCount = 0;

  // Priority 1: Count via BPlusTreeMap traversal
  const handle = (cfg as any).blobTableHandle as string;
  if (handle) {
    try {
      const result = await countBlobsFromTable(cfg.indexerUrl, handle);
      if (result.totalBlobs > 0) {
        stats.totalBlobs            = result.totalBlobs;
        stats.totalStorageUsedBytes = result.totalStorageUsedBytes || null;
        slotCount = result.slotCount;
        source = "graphql-bptree";
      }
    } catch (e: any) { console.error("[stats] bptree count failed:", e.message); }
  }

  // On-chain: providers, PGs, slices
  try {
    const [pgR, spR, slR] = await Promise.allSettled([
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (pgR.status === "fulfilled" && pgR.value.ok) { const d: any = await pgR.value.json(); stats.placementGroups = nb(d?.data?.next_unassigned_placement_group_index); }
    if (spR.status === "fulfilled" && spR.value.ok) { const d: any = await spR.value.json(); let c = 0; (d?.data?.active_providers_by_az?.root?.children?.entries ?? []).forEach((z: any) => { c += (z.value?.value ?? []).length; }); stats.storageProviders = c; }
    if (slR.status === "fulfilled" && slR.value.ok) { const d: any = await slR.value.json(); stats.slices = nb(d?.data?.slices?.big_vec?.vec?.[0]?.end_index) + nb(d?.data?.slices?.inline_vec?.length); }
    if (source === "none") source = "on-chain";
  } catch {}

  return Response.json({
    ok: true,
    data: { node, stats, network, statsSource: `worker-${source}`, _slotCount: slotCount },
    fetchedAt: new Date().toISOString(),
  }, { headers: { ...CORS, "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}

async function handleSync(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.SYNC_SECRET) { const s = url.searchParams.get("secret") ?? ""; if (s !== env.SYNC_SECRET) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS }); }
  const n = (url.searchParams.get("network") ?? "both") as NetworkId | "both";
  const results: Record<string, any> = {};
  if (n === "both" || n === "shelbynet") results.shelbynet = await syncNetwork("shelbynet", env, ctx);
  if (n === "both" || n === "testnet")   results.testnet   = await syncNetwork("testnet", env, ctx);
  return Response.json({ ok: true, message: "Sync completed", results, syncedAt: new Date().toISOString() }, { headers: CORS });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/health")    return Response.json({ ok: true, worker: "shelby-geo-sync", version: "2.7.0", ts: new Date().toISOString() }, { headers: CORS });
    if (url.pathname === "/nodes"     && request.method === "GET")  return handleNodes(url, env);
    if (url.pathname === "/snapshots" && request.method === "GET")  return handleSnapshots(url, env);
    if (url.pathname === "/stats"     && request.method === "GET")  return handleStats(url, env);
    if (url.pathname === "/sync"      && request.method === "POST") return handleSync(url, env, ctx);
    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: CORS });
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await Promise.allSettled([syncNetwork("shelbynet", env, ctx), syncNetwork("testnet", env, ctx)]);
  },
};