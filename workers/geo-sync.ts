/**
 * workers/geo-sync.ts — v2.3
 *
 * FIX: Dùng đúng Shelby Indexer GraphQL để lấy blob stats
 * Shelby Indexer có custom tables: current_blobs, blob_activities, v.v.
 * Worker có thể gọi Indexer (không bị block như Explorer)
 *
 * THÊM: /debug endpoint → probe GraphQL schema từ Worker context
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
  },
  testnet: {
    coreAddress: "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    indexerUrl:  "https://api.testnet.aptoslabs.com/v1/graphql",
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

async function geocodeIP(ip: string, zone: string): Promise<GeoResult> {
  const now = new Date().toISOString();
  const fb = ZONE_COORDS[zone] ?? { lat: 0, lng: 0, city: "Unknown", country: "??" };
  if (!ip || /^(10\.|192\.168\.|127\.|0\.0\.0\.0)/.test(ip)) return { ...fb, source: "zone-fallback", geocodedAt: now };
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,city,regionName,country,countryCode,isp`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error("ip-api");
    const d: any = await r.json();
    if (d.status !== "success") throw new Error("fail");
    return { lat: d.lat, lng: d.lon, city: d.city, region: d.regionName, country: d.country, countryCode: d.countryCode, isp: d.isp, source: "geo-ip", geocodedAt: now };
  } catch { return { ...fb, source: "zone-fallback", geocodedAt: now }; }
}

// ── GraphQL helpers ────────────────────────────────────────────────────────────
async function gql(url: string, query: string, variables?: any): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}`);
  const j: any = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// ── Fetch blob stats from Shelby Indexer ─────────────────────────────────────
// Shelby dùng Aptos Indexer với custom tables
// Từ SDK source: getBlobsCount → query current_blobs aggregate
// getTotalBlobsSize → sum of size field
// getBlobActivitiesCount → current_blob_activities aggregate
async function fetchBlobStatsFromIndexer(indexerUrl: string): Promise<{
  totalBlobs: number; totalStorageUsedBytes: number; totalBlobEvents: number;
} | null> {
  // Thử nhiều query patterns khác nhau
  const queries = [
    // Pattern 1: SDK standard (current_blobs table)
    `query BlobStats {
      current_blobs_aggregate { aggregate { count sum { size } } }
      current_blob_activities_aggregate { aggregate { count } }
    }`,
    // Pattern 2: blobs table (không có "current_" prefix)
    `query BlobStats {
      blobs_aggregate { aggregate { count sum { size } } }
      blob_activities_aggregate { aggregate { count } }
    }`,
    // Pattern 3: Shelby custom naming
    `query BlobStats {
      shelby_blobs_aggregate { aggregate { count sum { size } } }
    }`,
    // Pattern 4: Count via simple query
    `query BlobStats {
      current_blobs_aggregate { aggregate { count } }
    }`,
  ];

  for (const q of queries) {
    try {
      const data = await gql(indexerUrl, q);

      // Extract from pattern 1
      const agg1 = data?.current_blobs_aggregate?.aggregate;
      if (agg1?.count > 0) {
        return {
          totalBlobs:            nb(agg1.count),
          totalStorageUsedBytes: nb(agg1.sum?.size),
          totalBlobEvents:       nb(data?.current_blob_activities_aggregate?.aggregate?.count),
        };
      }

      // Extract from pattern 2
      const agg2 = data?.blobs_aggregate?.aggregate;
      if (agg2?.count > 0) {
        return {
          totalBlobs:            nb(agg2.count),
          totalStorageUsedBytes: nb(agg2.sum?.size),
          totalBlobEvents:       nb(data?.blob_activities_aggregate?.aggregate?.count),
        };
      }

      // Pattern 3
      const agg3 = data?.shelby_blobs_aggregate?.aggregate;
      if (agg3?.count > 0) {
        return { totalBlobs: nb(agg3.count), totalStorageUsedBytes: 0, totalBlobEvents: 0 };
      }

    } catch { /* try next pattern */ }
  }

  return null;
}

// ── Fetch all stats ────────────────────────────────────────────────────────────
async function fetchNetworkStats(network: NetworkId): Promise<Partial<StatsSnapshot>> {
  const cfg = NETWORKS[network];
  let blockHeight = 0, totalBlobs = 0, totalStorageUsedBytes = 0,
      storageProviders = 0, placementGroups = 0, slices = 0, totalBlobEvents = 0;

  // Node info
  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const d: any = await r.json(); blockHeight = Number(d.block_height ?? 0); }
  } catch {}

  // Blob stats từ Indexer GraphQL
  try {
    const blobStats = await fetchBlobStatsFromIndexer(cfg.indexerUrl);
    if (blobStats) {
      totalBlobs            = blobStats.totalBlobs;
      totalStorageUsedBytes = blobStats.totalStorageUsedBytes;
      totalBlobEvents       = blobStats.totalBlobEvents;
    }
  } catch {}

  // Providers, PGs, Slices từ on-chain RPC
  try {
    const [pgR, spR, slR] = await Promise.allSettled([
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (pgR.status === "fulfilled" && pgR.value.ok) {
      const d: any = await pgR.value.json();
      placementGroups = nb(d?.data?.next_unassigned_placement_group_index);
    }
    if (spR.status === "fulfilled" && spR.value.ok) {
      const d: any = await spR.value.json();
      const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? [];
      zones.forEach(z => { storageProviders += (z.value?.value ?? []).length; });
    }
    if (slR.status === "fulfilled" && slR.value.ok) {
      const d: any = await slR.value.json();
      slices = nb(d?.data?.slices?.big_vec?.vec?.[0]?.end_index) + nb(d?.data?.slices?.inline_vec?.length);
    }
  } catch {}

  return { blockHeight, totalBlobs, totalStorageUsedBytes, storageProviders, placementGroups, slices, totalBlobEvents };
}

async function fetchIndexer(url: string): Promise<RawProvider[]> {
  const data = await gql(url, `query { current_storage_providers { address zone state health bls_key capacity net_address } }`);
  const sps = data?.current_storage_providers;
  if (!sps?.length) throw new Error("Empty indexer");
  return sps;
}

async function fetchRPC(nodeUrl: string, core: string): Promise<RawProvider[]> {
  const r = await fetch(`${nodeUrl}/accounts/${core}/resource/${core}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  const j: any = await r.json();
  const zones: any[] = j?.data?.active_providers_by_az?.root?.children?.entries ?? [];
  const out: RawProvider[] = [];
  for (const z of zones)
    for (const n of (z.value?.value ?? []))
      out.push({ address: n.addr, zone: z.key, state: "Active", health: n.status?.condition === 0 ? "Healthy" : "Faulty", bls_key: "", net_address: "", capacity: n.status?.quota?.value });
  return out;
}

async function writeR2Snapshot(env: Env, network: NetworkId, ctx: ExecutionContext) {
  try {
    const stats = await fetchNetworkStats(network);
    const now   = new Date();
    const key   = `snapshots/${network}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${String(now.getUTCDate()).padStart(2,"0")}/${String(now.getUTCHours()).padStart(2,"0")}.json`;
    const snap: StatsSnapshot = { network, ts: now.toISOString(), blockHeight: stats.blockHeight??0, totalBlobs: stats.totalBlobs??0, totalStorageUsedBytes: stats.totalStorageUsedBytes??0, storageProviders: stats.storageProviders??0, placementGroups: stats.placementGroups??0, slices: stats.slices??0, totalBlobEvents: stats.totalBlobEvents??0 };
    ctx.waitUntil(env.SHELBY_R2.put(key, JSON.stringify(snap), { httpMetadata: { contentType: "application/json" } }));
    console.log(`[r2] ${key} blobs=${snap.totalBlobs}`);
  } catch (e) { console.error("[r2] failed:", e); }
}

async function syncNetwork(network: NetworkId, env: Env, ctx: ExecutionContext): Promise<{ synced: number; errors: string[] }> {
  const cfg = NETWORKS[network]; const kv = getKV(env, network); const errors: string[] = [];
  let raw: RawProvider[] = [];
  try { raw = await fetchIndexer(cfg.indexerUrl); }
  catch (e1: any) { try { raw = await fetchRPC(cfg.nodeUrl, cfg.coreAddress); } catch (e2: any) { errors.push(e2.message); return { synced: 0, errors }; } }
  if (!raw.length) return { synced: 0, errors: ["No providers"] };

  const records: NodeRecord[] = []; const addrs: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (i > 0 && i % 10 === 0) await new Promise(r => setTimeout(r, 1000));
    const p = raw[i]; const geo = await geocodeIP(p.net_address ?? "", p.zone ?? "");
    records.push({ address: p.address, addressShort: trunc(p.address), availabilityZone: p.zone??"unknown", state: p.state??"Active", health: p.health??"Healthy", blsKey: p.bls_key ? trunc(p.bls_key,8,8) : "", fullBlsKey: p.bls_key??"", capacityTiB: p.capacity ? Number(p.capacity)/(1024**4) : undefined, netAddress: p.net_address, geo, updatedAt: new Date().toISOString() });
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
  if (!NETWORKS[network]) return Response.json({ ok: false, error: "Unknown network" }, { status: 400, headers: CORS });
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
    const prefix = `snapshots/${network}/`; const list = await env.SHELBY_R2.list({ prefix, limit: limit+5 });
    const keys = list.objects.map(o => o.key).sort((a,b) => b.localeCompare(a)).slice(0, limit);
    const snaps = (await Promise.all(keys.map(async k => { const obj = await env.SHELBY_R2.get(k); if (!obj) return null; return JSON.parse(await obj.text()) as StatsSnapshot; }))).filter(Boolean).sort((a,b) => new Date(a!.ts).getTime()-new Date(b!.ts).getTime()) as StatsSnapshot[];
    return Response.json({ ok: true, network, data: { snapshots: snaps, count: snaps.length }, fetchedAt: new Date().toISOString() }, { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
  } catch (e: any) { return Response.json({ ok: false, error: e.message, data: { snapshots: [], count: 0 } }, { status: 500, headers: CORS }); }
}

// /stats: Fresh data từ Indexer GraphQL + on-chain RPC
async function handleStats(url: URL, env: Env): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (!NETWORKS[network]) return Response.json({ ok: false, error: "Unknown network" }, { status: 400, headers: CORS });

  const cfg = NETWORKS[network];
  let node = null;
  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const d: any = await r.json(); node = { blockHeight: nb(d.block_height), ledgerVersion: nb(d.ledger_version), chainId: nb(d.chain_id) }; }
  } catch {}

  // Lấy stats: ưu tiên Indexer GraphQL, fallback R2 snapshot, fallback on-chain
  let stats: Record<string, number | null> = { totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, storageProviders: null, placementGroups: null, slices: null };
  let source = "none";

  // Priority 1: Indexer GraphQL (trực tiếp, no block issue)
  try {
    const blobStats = await fetchBlobStatsFromIndexer(cfg.indexerUrl);
    if (blobStats && blobStats.totalBlobs > 0) {
      stats.totalBlobs            = blobStats.totalBlobs;
      stats.totalStorageUsedBytes = blobStats.totalStorageUsedBytes;
      stats.totalBlobEvents       = blobStats.totalBlobEvents;
      source = "graphql";
    }
  } catch {}

  // Priority 2: R2 snapshot (nếu GraphQL không có blob data)
  if (!stats.totalBlobs) {
    try {
      const prefix = `snapshots/${network}/`;
      const list   = await env.SHELBY_R2.list({ prefix, limit: 10 });
      const keys   = list.objects.map(o => o.key).sort((a,b) => b.localeCompare(a));
      for (const key of keys) {
        const obj = await env.SHELBY_R2.get(key); if (!obj) continue;
        const snap: StatsSnapshot = JSON.parse(await obj.text());
        if (snap.totalBlobs > 10) {
          stats.totalBlobs            = snap.totalBlobs;
          stats.totalStorageUsedBytes = snap.totalStorageUsedBytes;
          stats.totalBlobEvents       = snap.totalBlobEvents;
          source = "r2-snapshot";
          break;
        }
      }
    } catch {}
  }

  // On-chain: storageProviders, placementGroups, slices (luôn lấy fresh)
  try {
    const [pgR, spR, slR] = await Promise.allSettled([
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (pgR.status === "fulfilled" && pgR.value.ok) { const d: any = await pgR.value.json(); stats.placementGroups = nb(d?.data?.next_unassigned_placement_group_index); }
    if (spR.status === "fulfilled" && spR.value.ok) { const d: any = await spR.value.json(); const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? []; let c = 0; zones.forEach(z => { c += (z.value?.value ?? []).length; }); stats.storageProviders = c; }
    if (slR.status === "fulfilled" && slR.value.ok) { const d: any = await slR.value.json(); stats.slices = nb(d?.data?.slices?.big_vec?.vec?.[0]?.end_index) + nb(d?.data?.slices?.inline_vec?.length); }
    if (source === "none") source = "on-chain";
  } catch {}

  return Response.json({ ok: true, data: { node, stats, network, statsSource: `worker-${source}` }, fetchedAt: new Date().toISOString() }, { headers: { ...CORS, "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}

// /debug: Probe GraphQL schema để tìm đúng tables
async function handleDebug(url: URL): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const cfg = NETWORKS[network];
  const results: Record<string, any> = {};

  // Probe schema
  try {
    const schemaData = await gql(cfg.indexerUrl, `{ __schema { queryType { fields { name } } } }`);
    results.schema_fields = schemaData?.__schema?.queryType?.fields?.map((f: any) => f.name) ?? [];
  } catch (e: any) { results.schema_error = e.message; }

  // Try blob-related queries
  const testQueries: Record<string, string> = {
    current_blobs:            `{ current_blobs_aggregate { aggregate { count } } }`,
    blobs:                    `{ blobs_aggregate { aggregate { count } } }`,
    current_blob_activities:  `{ current_blob_activities_aggregate { aggregate { count } } }`,
    blob_activities:          `{ blob_activities_aggregate { aggregate { count } } }`,
    current_storage_providers:`{ current_storage_providers_aggregate { aggregate { count } } }`,
  };

  for (const [name, q] of Object.entries(testQueries)) {
    try {
      const d = await gql(cfg.indexerUrl, q);
      results[name] = d;
    } catch (e: any) {
      results[name] = { error: e.message };
    }
  }

  return Response.json({ ok: true, network, indexerUrl: cfg.indexerUrl, results }, { headers: CORS });
}

async function handleSync(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.SYNC_SECRET) { const s = url.searchParams.get("secret") ?? ""; if (s !== env.SYNC_SECRET) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS }); }
  const n = (url.searchParams.get("network") ?? "both") as NetworkId | "both";
  const results: Record<string, any> = {};
  if (n === "both" || n === "shelbynet") results.shelbynet = await syncNetwork("shelbynet", env, ctx);
  if (n === "both" || n === "testnet")   results.testnet   = await syncNetwork("testnet",   env, ctx);
  return Response.json({ ok: true, message: "Sync completed", results, syncedAt: new Date().toISOString() }, { headers: CORS });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/health")    return Response.json({ ok: true, worker: "shelby-geo-sync", version: "2.3.0", ts: new Date().toISOString() }, { headers: CORS });
    if (url.pathname === "/nodes"     && request.method === "GET")  return handleNodes(url, env);
    if (url.pathname === "/snapshots" && request.method === "GET")  return handleSnapshots(url, env);
    if (url.pathname === "/stats"     && request.method === "GET")  return handleStats(url, env);
    if (url.pathname === "/debug"     && request.method === "GET")  return handleDebug(url);
    if (url.pathname === "/sync"      && request.method === "POST") return handleSync(url, env, ctx);
    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: CORS });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[geo-sync] CRON at ${new Date().toISOString()}`);
    await Promise.allSettled([syncNetwork("shelbynet", env, ctx), syncNetwork("testnet", env, ctx)]);
    console.log("[geo-sync] CRON done");
  },
};