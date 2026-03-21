/**
 * workers/geo-sync.ts — v3.0
 *
 * THAY ĐỔI CHIẾN LƯỢC:
 * 1. Thêm /count endpoint — test cursor pagination trực tiếp, lưu kết quả vào KV
 * 2. /stats đọc từ KV "stats:shelbynet" thay vì R2 (nhanh hơn)
 * 3. writeR2Snapshot và writeKVStats chạy song song
 * 4. Fix cursor: dùng numeric comparison cho decoded_key
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
interface KVStats { totalBlobs: number; totalStorageUsedBytes: number; totalBlobEvents: number; updatedAt: string; }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
function trunc(a: string, f = 6, b = 4) { if (!a || a.length <= f+b+3) return a; return `${a.slice(0,f)}...${a.slice(-b)}`; }
function getKV(env: Env, n: NetworkId): KVNamespace { return n === "shelbynet" ? env.SHELBY_KV_MAINNET : env.SHELBY_KV_TESTNET; }
function nb(v: any, fb = 0): number { const x = Number(v ?? fb); return isNaN(x) ? fb : x; }

async function doGql(url: string, query: string): Promise<any> {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(12000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,100)}`);
  const j = JSON.parse(t);
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// ── Cursor pagination để đếm blobs ────────────────────────────────────────────
// decoded_key là u64 integer (từ debug4: "9999957", "2435063", v.v.)
// Dùng _gt với integer value, paginate 100 items/page
async function countBlobsViaCursor(
  indexerUrl: string,
  handle: string,
  maxMs = 20000 // stop after 20s
): Promise<{ totalBlobs: number; totalStorageUsedBytes: number; totalSlots: number; complete: boolean }> {
  const startTime = Date.now();
  let totalBlobs = 0;
  let totalStorageUsedBytes = 0;
  let totalSlots = 0;
  let lastKey = 0;
  let complete = false;

  function processSlot(dv: any): { blobs: number; size: number } {
    if (!dv) return { blobs: 0, size: 0 };
    let blobs = 0, size = 0;

    const rootEntries: any[] = dv?.root?.children?.entries ?? [];
    for (const e of rootEntries) {
      blobs++;
      size += nb(e?.value?.value?.blob_size ?? 0);
    }

    const nodeSlots: any[] = dv?.nodes?.slots?.vec ?? [];
    for (const ns of nodeSlots) {
      for (const e of (ns?.children?.entries ?? ns?.value?.children?.entries ?? [])) {
        blobs++;
        size += nb(e?.value?.value?.blob_size ?? 0);
      }
    }

    return { blobs: blobs || 1, size };
  }

  while (true) {
    if (Date.now() - startTime > maxMs) break;

    // Dùng numeric _gt cho decoded_key
    const data = await doGql(indexerUrl, `{
      current_table_items(
        where: {
          table_handle: { _eq: "${handle}" }
          decoded_key: { _gt: "${lastKey}" }
        }
        order_by: { decoded_key: asc }
        limit: 100
      ) { decoded_key decoded_value }
    }`);

    const items: any[] = data?.current_table_items ?? [];
    if (items.length === 0) { complete = true; break; }

    for (const item of items) {
      totalSlots++;
      const { blobs, size } = processSlot(item.decoded_value);
      totalBlobs += blobs;
      totalStorageUsedBytes += size;
    }

    lastKey = Number(items[items.length - 1].decoded_key);
    if (items.length < 100) { complete = true; break; }
  }

  return { totalBlobs, totalStorageUsedBytes, totalSlots, complete };
}

// ── Save blob stats to KV (fast read for /stats) ──────────────────────────────
async function saveBlobStatsToKV(kv: KVNamespace, stats: KVStats): Promise<void> {
  await kv.put("stats:blobs", JSON.stringify(stats), { expirationTtl: 7200 });
}

async function loadBlobStatsFromKV(kv: KVNamespace): Promise<KVStats | null> {
  try {
    const s = await kv.get("stats:blobs");
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

// ── Fetch on-chain stats (providers, PGs, slices) ─────────────────────────────
async function fetchOnChainStats(network: NetworkId): Promise<{ storageProviders: number; placementGroups: number; slices: number }> {
  const cfg = NETWORKS[network];
  let storageProviders = 0, placementGroups = 0, slices = 0;
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
  return { storageProviders, placementGroups, slices };
}

// ── geocode + sync helpers ─────────────────────────────────────────────────────
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
  const out: RawProvider[] = [];
  for (const z of (j?.data?.active_providers_by_az?.root?.children?.entries ?? []))
    for (const n of (z.value?.value ?? []))
      out.push({ address: n.addr, zone: z.key, state: "Active", health: n.status?.condition === 0 ? "Healthy" : "Faulty", bls_key: "", net_address: "", capacity: n.status?.quota?.value });
  return out;
}

async function syncProviders(network: NetworkId, env: Env, ctx: ExecutionContext): Promise<{ synced: number; errors: string[] }> {
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
  return { synced: records.length, errors };
}

async function syncBlobStats(network: NetworkId, env: Env, ctx: ExecutionContext): Promise<void> {
  const cfg = NETWORKS[network];
  const kv = getKV(env, network);
  const handle = (cfg as any).blobTableHandle as string;
  if (!handle) return;

  const nodeInfo = await fetchOnChainStats(network);
  let blockHeight = 0;
  try { const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(4000) }); if (r.ok) { const d: any = await r.json(); blockHeight = nb(d.block_height); } } catch {}

  const result = await countBlobsViaCursor(cfg.indexerUrl, handle, 25000);
  console.log(`[syncBlobs] ${network} blobs=${result.totalBlobs} slots=${result.totalSlots} complete=${result.complete}`);

  if (result.totalBlobs > 0) {
    // Save to KV for fast /stats reads
    const kvStats: KVStats = {
      totalBlobs:            result.totalBlobs,
      totalStorageUsedBytes: result.totalStorageUsedBytes,
      totalBlobEvents:       0,
      updatedAt:             new Date().toISOString(),
    };
    await saveBlobStatsToKV(kv, kvStats);

    // Save to R2 snapshot
    const now = new Date();
    const key = `snapshots/${network}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${String(now.getUTCDate()).padStart(2,"0")}/${String(now.getUTCHours()).padStart(2,"0")}.json`;
    const snap: StatsSnapshot = {
      network, ts: now.toISOString(), blockHeight,
      totalBlobs:            result.totalBlobs,
      totalStorageUsedBytes: result.totalStorageUsedBytes,
      storageProviders:      nodeInfo.storageProviders,
      placementGroups:       nodeInfo.placementGroups,
      slices:                nodeInfo.slices,
      totalBlobEvents:       0,
    };
    ctx.waitUntil(env.SHELBY_R2.put(key, JSON.stringify(snap), { httpMetadata: { contentType: "application/json" } }));
    console.log(`[r2] ${key} blobs=${snap.totalBlobs}`);
  }
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
  const kv = getKV(env, network);

  let node = null;
  try { const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5000) }); if (r.ok) { const d: any = await r.json(); node = { blockHeight: nb(d.block_height), ledgerVersion: nb(d.ledger_version), chainId: nb(d.chain_id) }; } } catch {}

  // Fresh on-chain stats
  const onChain = await fetchOnChainStats(network);

  // Blob stats from KV (set by /count or CRON)
  const kvStats = await loadBlobStatsFromKV(kv);

  const stats = {
    totalBlobs:            kvStats?.totalBlobs ?? null,
    totalStorageUsedBytes: kvStats?.totalStorageUsedBytes ?? null,
    totalBlobEvents:       kvStats?.totalBlobEvents ?? null,
    storageProviders:      onChain.storageProviders || null,
    placementGroups:       onChain.placementGroups  || null,
    slices:                onChain.slices           || null,
  };

  const source = kvStats ? "kv-blob-stats" : "on-chain";
  return Response.json({
    ok: true,
    data: { node, stats, network, statsSource: `worker-${source}`, blobStatsUpdatedAt: kvStats?.updatedAt ?? null },
    fetchedAt: new Date().toISOString(),
  }, { headers: { ...CORS, "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}

// /count — trigger blob count ngay, lưu vào KV. Chạy async trong ctx.waitUntil.
// Trả response ngay, count chạy background.
async function handleCount(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.SYNC_SECRET) {
    const s = url.searchParams.get("secret") ?? "";
    if (s !== env.SYNC_SECRET) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (!NETWORKS[network]) return Response.json({ ok: false, error: "Unknown network" }, { status: 400, headers: CORS });

  // Chạy count async — không block response
  ctx.waitUntil(syncBlobStats(network, env, ctx));

  return Response.json({
    ok: true,
    message: `Blob count started for ${network} in background. Check /stats in ~60s.`,
    network,
    ts: new Date().toISOString(),
  }, { headers: CORS });
}

async function handleSync(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.SYNC_SECRET) { const s = url.searchParams.get("secret") ?? ""; if (s !== env.SYNC_SECRET) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS }); }
  const n = (url.searchParams.get("network") ?? "both") as NetworkId | "both";
  const networks: NetworkId[] = n === "both" ? ["shelbynet", "testnet"] : [n as NetworkId];

  // Providers sync + blob count in background
  const results: Record<string, any> = {};
  for (const net of networks) {
    results[net] = await syncProviders(net, env, ctx);
    ctx.waitUntil(syncBlobStats(net, env, ctx));
  }

  return Response.json({ ok: true, message: "Sync started (blob count in background)", results, syncedAt: new Date().toISOString() }, { headers: CORS });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/health")    return Response.json({ ok: true, worker: "shelby-geo-sync", version: "3.0.0", ts: new Date().toISOString() }, { headers: CORS });
    if (url.pathname === "/nodes"     && request.method === "GET")  return handleNodes(url, env);
    if (url.pathname === "/snapshots" && request.method === "GET")  return handleSnapshots(url, env);
    if (url.pathname === "/stats"     && request.method === "GET")  return handleStats(url, env);
    if (url.pathname === "/count"     && request.method === "POST") return handleCount(url, env, ctx);
    if (url.pathname === "/sync"      && request.method === "POST") return handleSync(url, env, ctx);
    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: CORS });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[cron] ${new Date().toISOString()}`);
    ctx.waitUntil(Promise.allSettled([
      syncProviders("shelbynet", env, ctx).then(() => syncBlobStats("shelbynet", env, ctx)),
      syncProviders("testnet",   env, ctx).then(() => syncBlobStats("testnet",   env, ctx)),
    ]));
  },
};