/**
 * workers/geo-sync.ts — v2.1
 * THÊM MỚI: GET /stats?network= endpoint
 *   → Gọi Explorer API (chạy trong CF Worker context → không bị block)
 *   → Trả JSON stats giống Explorer
 *   → Pages stats route sẽ gọi Worker này thay vì gọi Explorer trực tiếp
 */

interface Env {
  SHELBY_KV_MAINNET: KVNamespace;
  SHELBY_KV_TESTNET: KVNamespace;
  SHELBY_R2:         R2Bucket;
  SYNC_SECRET?:      string;
}

const NETWORKS = {
  shelbynet: {
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    indexerUrl:  "https://api.shelbynet.shelby.xyz/v1/graphql",
    explorerApi: "https://explorer.shelby.xyz/api/stats",
  },
  testnet: {
    coreAddress: "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    indexerUrl:  "https://api.testnet.aptoslabs.com/v1/graphql",
    explorerApi: "https://explorer.shelby.xyz/api/stats?network=testnet",
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

interface RawProvider {
  address:      string;
  zone:         string;
  state:        string;
  health:       string;
  bls_key?:     string;
  capacity?:    string;
  net_address?: string;
}

interface GeoResult {
  lat: number; lng: number;
  city?: string; region?: string;
  country?: string; countryCode?: string; isp?: string;
  source: "geo-ip" | "zone-fallback";
  geocodedAt: string;
}

interface NodeRecord {
  address: string; addressShort: string;
  availabilityZone: string; state: string; health: string;
  blsKey: string; fullBlsKey?: string;
  capacityTiB?: number; netAddress?: string;
  geo: GeoResult; updatedAt: string;
}

interface StatsSnapshot {
  network: string; ts: string; blockHeight: number;
  totalBlobs: number; totalStorageUsedBytes: number;
  storageProviders: number; placementGroups: number;
  slices: number; totalBlobEvents: number;
}

function trunc(addr: string, f = 6, b = 4) {
  if (!addr || addr.length <= f + b + 3) return addr;
  return `${addr.slice(0, f)}...${addr.slice(-b)}`;
}

function getKV(env: Env, n: NetworkId): KVNamespace {
  return n === "shelbynet" ? env.SHELBY_KV_MAINNET : env.SHELBY_KV_TESTNET;
}

async function geocodeIP(ip: string, zone: string): Promise<GeoResult> {
  const now = new Date().toISOString();
  const fb  = ZONE_COORDS[zone] ?? { lat: 0, lng: 0, city: "Unknown", country: "??" };
  if (!ip || /^(10\.|192\.168\.|127\.|0\.0\.0\.0)/.test(ip)) {
    return { ...fb, source: "zone-fallback", geocodedAt: now };
  }
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,city,regionName,country,countryCode,isp`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error("ip-api error");
    const d: any = await r.json();
    if (d.status !== "success") throw new Error("ip-api fail");
    return { lat: d.lat, lng: d.lon, city: d.city, region: d.regionName, country: d.country, countryCode: d.countryCode, isp: d.isp, source: "geo-ip", geocodedAt: now };
  } catch {
    return { ...fb, source: "zone-fallback", geocodedAt: now };
  }
}

async function fetchIndexer(url: string): Promise<RawProvider[]> {
  const q = `query { current_storage_providers { address zone state health bls_key capacity net_address } }`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Indexer ${r.status}`);
  const j: any = await r.json();
  const sps = j.data?.current_storage_providers;
  if (!sps?.length) throw new Error("Empty indexer");
  return sps;
}

async function fetchRPC(nodeUrl: string, core: string): Promise<RawProvider[]> {
  const r = await fetch(`${nodeUrl}/accounts/${core}/resource/${core}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  const j: any = await r.json();
  const zones: any[] = j?.data?.active_providers_by_az?.root?.children?.entries ?? [];
  const out: RawProvider[] = [];
  for (const z of zones) {
    for (const n of (z.value?.value ?? [])) {
      out.push({ address: n.addr, zone: z.key, state: "Active", health: n.status?.condition === 0 ? "Healthy" : "Faulty", bls_key: "", net_address: "", capacity: n.status?.quota?.value });
    }
  }
  return out;
}

// ── MỚI: Fetch stats từ Explorer API (Worker có thể gọi OK) ───────────────────
async function fetchExplorerStats(network: NetworkId): Promise<Partial<StatsSnapshot>> {
  const cfg = NETWORKS[network];
  let blockHeight = 0, totalBlobs = 0, totalStorageUsedBytes = 0,
      storageProviders = 0, placementGroups = 0, slices = 0, totalBlobEvents = 0;

  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const d: any = await r.json(); blockHeight = Number(d.block_height ?? 0); }
  } catch {}

  try {
    const r = await fetch(cfg.explorerApi, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d: any = await r.json();
      totalBlobs            = Number(d.total_blobs ?? d.totalBlobs ?? 0);
      totalStorageUsedBytes = Number(d.total_storage_used ?? d.totalStorageUsed ?? 0);
      storageProviders      = Number(d.storage_providers ?? d.storageProviders ?? 0);
      placementGroups       = Number(d.placement_groups ?? d.placementGroups ?? 0);
      slices                = Number(d.slices ?? 0);
      totalBlobEvents       = Number(d.total_blob_events ?? d.totalBlobEvents ?? 0);
    }
  } catch {}

  // Fallback: on-chain nếu Explorer lỗi
  if (totalBlobs === 0) {
    try {
      const [pgR, spR, slR] = await Promise.allSettled([
        fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(5000) }),
      ]);
      if (pgR.status === "fulfilled" && pgR.value.ok) {
        const d: any = await pgR.value.json();
        placementGroups = Number(d?.data?.next_unassigned_placement_group_index ?? 0);
      }
      if (spR.status === "fulfilled" && spR.value.ok) {
        const d: any = await spR.value.json();
        const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? [];
        zones.forEach(z => { storageProviders += (z.value?.value ?? []).length; });
      }
      if (slR.status === "fulfilled" && slR.value.ok) {
        const d: any = await slR.value.json();
        slices = Number(d?.data?.slices?.big_vec?.vec?.[0]?.end_index ?? 0)
               + Number(d?.data?.slices?.inline_vec?.length ?? 0);
        totalBlobs = slices > 0 ? Math.ceil(slices / 16) : 0;
      }
    } catch {}
  }

  return { blockHeight, totalBlobs, totalStorageUsedBytes, storageProviders, placementGroups, slices, totalBlobEvents };
}

async function writeR2Snapshot(env: Env, network: NetworkId, ctx: ExecutionContext) {
  try {
    const stats  = await fetchExplorerStats(network);
    const now    = new Date();
    const key    = `snapshots/${network}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCHours()).padStart(2, "0")}.json`;
    const snapshot: StatsSnapshot = {
      network, ts: now.toISOString(),
      blockHeight: stats.blockHeight ?? 0,
      totalBlobs: stats.totalBlobs ?? 0,
      totalStorageUsedBytes: stats.totalStorageUsedBytes ?? 0,
      storageProviders: stats.storageProviders ?? 0,
      placementGroups: stats.placementGroups ?? 0,
      slices: stats.slices ?? 0,
      totalBlobEvents: stats.totalBlobEvents ?? 0,
    };
    ctx.waitUntil(env.SHELBY_R2.put(key, JSON.stringify(snapshot), { httpMetadata: { contentType: "application/json" }, customMetadata: { network, hour: String(now.getUTCHours()) } }));
  } catch (e) { console.error("[r2] Snapshot failed:", e); }
}

async function syncNetwork(network: NetworkId, env: Env, ctx: ExecutionContext): Promise<{ synced: number; errors: string[] }> {
  const cfg = NETWORKS[network];
  const kv  = getKV(env, network);
  const errors: string[] = [];
  let raw: RawProvider[] = [];

  try { raw = await fetchIndexer(cfg.indexerUrl); }
  catch (e1: any) {
    try { raw = await fetchRPC(cfg.nodeUrl, cfg.coreAddress); }
    catch (e2: any) { errors.push(e2.message); return { synced: 0, errors }; }
  }

  if (!raw.length) return { synced: 0, errors: ["No providers found"] };

  const records: NodeRecord[] = [];
  const addrs: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    if (i > 0 && i % 10 === 0) await new Promise(r => setTimeout(r, 1000));
    const p   = raw[i];
    const geo = await geocodeIP(p.net_address ?? "", p.zone ?? "");
    records.push({ address: p.address, addressShort: trunc(p.address), availabilityZone: p.zone ?? "unknown", state: p.state ?? "Active", health: p.health ?? "Healthy", blsKey: p.bls_key ? trunc(p.bls_key, 8, 8) : "", fullBlsKey: p.bls_key ?? "", capacityTiB: p.capacity ? Number(p.capacity) / (1024 ** 4) : undefined, netAddress: p.net_address, geo, updatedAt: new Date().toISOString() });
    addrs.push(p.address);
  }

  const writes = records.map(r => kv.put(`node:${r.address}`, JSON.stringify(r), { expirationTtl: 7200 }));
  writes.push(kv.put("index:providers", JSON.stringify({ addresses: addrs, updatedAt: new Date().toISOString(), network, count: addrs.length }), { expirationTtl: 7200 }));
  ctx.waitUntil(Promise.allSettled(writes));

  await writeR2Snapshot(env, network, ctx);
  return { synced: records.length, errors };
}

// ── HTTP handlers ──────────────────────────────────────────────────────────────
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

async function handleNodes(url: URL, env: Env): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (!NETWORKS[network]) return Response.json({ ok: false, error: "Unknown network" }, { status: 400 });
  const kv = getKV(env, network);
  try {
    const indexStr = await kv.get("index:providers");
    if (!indexStr) return Response.json({ ok: false, error: "KV not populated", data: { providers: [], count: 0 } });
    const index: { addresses: string[] } = JSON.parse(indexStr);
    const nodeStrs = await Promise.all(index.addresses.map(a => kv.get(`node:${a}`)));
    const providers = nodeStrs.filter(Boolean).map(s => {
      const r: NodeRecord = JSON.parse(s!);
      return { ...r, coordinates: [r.geo.lng, r.geo.lat] as [number, number] };
    });
    return Response.json({ ok: true, network, source: "kv", data: { providers, count: providers.length }, fetchedAt: new Date().toISOString() }, { headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message, data: { providers: [], count: 0 } }, { status: 500 });
  }
}

async function handleSnapshots(url: URL, env: Env): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const limit   = Math.min(168, Number(url.searchParams.get("limit") ?? "24"));
  try {
    const prefix = `snapshots/${network}/`;
    const list   = await env.SHELBY_R2.list({ prefix, limit: limit + 5 });
    const keys   = list.objects.map(o => o.key).sort((a, b) => b.localeCompare(a)).slice(0, limit);
    const snapshots = await Promise.all(keys.map(async (key) => { const obj = await env.SHELBY_R2.get(key); if (!obj) return null; return JSON.parse(await obj.text()); }));
    const data = snapshots.filter(Boolean).sort((a, b) => new Date(a!.ts).getTime() - new Date(b!.ts).getTime()) as StatsSnapshot[];
    return Response.json({ ok: true, network, data: { snapshots: data, count: data.length }, fetchedAt: new Date().toISOString() }, { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message, data: { snapshots: [], count: 0 } }, { status: 500 });
  }
}

// ── MỚI: GET /stats — trả số liệu từ Explorer API (Worker gọi được) ──────────
async function handleStats(url: URL): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (!NETWORKS[network]) return Response.json({ ok: false, error: "Unknown network" }, { status: 400 });

  const cfg = NETWORKS[network];

  // Node info
  let nodeInfo: any = null;
  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) nodeInfo = await r.json();
  } catch {}

  const node = nodeInfo ? {
    blockHeight:   Number(nodeInfo.block_height   ?? 0),
    ledgerVersion: Number(nodeInfo.ledger_version ?? 0),
    chainId:       Number(nodeInfo.chain_id       ?? 0),
  } : null;

  const statsData = await fetchExplorerStats(network);

  return Response.json({
    ok: true,
    data: {
      node,
      stats: {
        totalBlobs:            statsData.totalBlobs            ?? null,
        totalStorageUsedBytes: statsData.totalStorageUsedBytes ?? null,
        totalBlobEvents:       statsData.totalBlobEvents       ?? null,
        storageProviders:      statsData.storageProviders      ?? null,
        placementGroups:       statsData.placementGroups       ?? null,
        slices:                statsData.slices                ?? null,
      },
      network,
      statsSource: "worker-explorer",
    },
    fetchedAt: new Date().toISOString(),
  }, { headers: { ...CORS, "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url  = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (path === "/health")     return Response.json({ ok: true, ts: new Date().toISOString() }, { headers: CORS });
    if (path === "/nodes")      return handleNodes(url, env);
    if (path === "/snapshots")  return handleSnapshots(url, env);
    if (path === "/stats")      return handleStats(url);          // ← MỚI

    if (path === "/sync" && req.method === "POST") {
      const secret = url.searchParams.get("secret");
      if (env.SYNC_SECRET && secret !== env.SYNC_SECRET) return new Response("Unauthorized", { status: 401 });
      const networkParam = url.searchParams.get("network") ?? "shelbynet";
      const nets: NetworkId[] = networkParam === "both" ? ["shelbynet", "testnet"] : [networkParam as NetworkId];
      ctx.waitUntil(Promise.all(nets.map(n => syncNetwork(n, env, ctx))));
      return Response.json({ ok: true, message: `Syncing ${nets.join(", ")}` }, { headers: CORS });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      syncNetwork("shelbynet", env, ctx),
      syncNetwork("testnet",   env, ctx),
    ]));
  },
};