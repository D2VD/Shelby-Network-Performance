/**
 * workers/geo-sync.ts — v2.4
 *
 * FIX: Dùng Aptos on-chain view functions để lấy blob count chính xác
 * Shelby contract expose view functions cho stats
 * Indexer GraphQL chỉ có standard Aptos tables, không có blob tables
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

async function callView(nodeUrl: string, func: string, args: any[] = []): Promise<any> {
  const r = await fetch(`${nodeUrl}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ function: func, type_arguments: [], arguments: args }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`view ${func} => HTTP ${r.status}`);
  return r.json();
}

// ── Fetch blob stats from on-chain view functions ─────────────────────────────
async function fetchBlobStats(nodeUrl: string, core: string): Promise<{
  totalBlobs: number; totalStorageUsedBytes: number; totalBlobEvents: number;
}> {
  let totalBlobs = 0, totalStorageUsedBytes = 0, totalBlobEvents = 0;

  // Try known view function patterns for Shelby contract
  const viewFuncs = [
    `${core}::blob_registry::blob_count`,
    `${core}::blob_registry::total_blobs`,
    `${core}::blob_registry::get_blob_count`,
    `${core}::statistics::total_blobs`,
    `${core}::statistics::get_stats`,
    `${core}::blob_registry::total_size`,
  ];

  for (const fn of viewFuncs) {
    try {
      const result = await callView(nodeUrl, fn);
      if (Array.isArray(result) && result.length > 0) {
        const v = Number(result[0]);
        if (!isNaN(v) && v > 10) {
          totalBlobs = v;
          break;
        }
      }
    } catch { /* try next */ }
  }

  // Try blob_registry resource directly — look for total count field
  try {
    const r = await fetch(
      `${nodeUrl}/accounts/${core}/resource/${core}::blob_registry::BlobRegistry`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const d: any = await r.json();
      // Check common field names for blob count
      const data = d?.data ?? {};
      const count =
        data?.total_blobs ??
        data?.blob_count ??
        data?.num_blobs ??
        data?.blobs?.length ??
        data?.count;

      if (count !== undefined && Number(count) > 10) {
        totalBlobs = Number(count);
      }

      // Size fields
      const size =
        data?.total_size ??
        data?.total_storage_used ??
        data?.used_bytes;
      if (size !== undefined) totalStorageUsedBytes = Number(size);

      // Events
      const events =
        data?.total_events ??
        data?.blob_events ??
        data?.num_events;
      if (events !== undefined) totalBlobEvents = Number(events);
    }
  } catch {}

  // Try event counter via account resources list
  if (totalBlobs === 0) {
    try {
      const r = await fetch(
        `${nodeUrl}/accounts/${core}/resources?limit=200`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const resources: any[] = await r.json();
        for (const res of resources) {
          const type: string = res.type ?? "";
          const data = res.data ?? {};

          // Look for blob registry with counts
          if (type.includes("blob_registry") || type.includes("BlobRegistry")) {
            const count = data?.total_blobs ?? data?.blob_count ?? data?.num_blobs ?? data?.count;
            if (count !== undefined) totalBlobs = Math.max(totalBlobs, Number(count));
            const size = data?.total_size ?? data?.total_storage_used;
            if (size !== undefined) totalStorageUsedBytes = Number(size);
          }

          // Look for event handles with counters
          if (type.includes("blob") || type.includes("Blob")) {
            const counter =
              data?.create_blob_events?.counter ??
              data?.blob_created_events?.counter ??
              data?.write_blob_events?.counter ??
              data?.blob_write_events?.counter;
            if (counter !== undefined) totalBlobEvents = Math.max(totalBlobEvents, Number(counter));
          }
        }
      }
    } catch {}
  }

  return { totalBlobs, totalStorageUsedBytes, totalBlobEvents };
}

// ── Fetch all stats ────────────────────────────────────────────────────────────
async function fetchNetworkStats(network: NetworkId): Promise<Partial<StatsSnapshot>> {
  const cfg = NETWORKS[network];
  let blockHeight = 0, totalBlobs = 0, totalStorageUsedBytes = 0,
      storageProviders = 0, placementGroups = 0, slices = 0, totalBlobEvents = 0;

  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const d: any = await r.json(); blockHeight = Number(d.block_height ?? 0); }
  } catch {}

  try {
    const bs = await fetchBlobStats(cfg.nodeUrl, cfg.coreAddress);
    totalBlobs = bs.totalBlobs;
    totalStorageUsedBytes = bs.totalStorageUsedBytes;
    totalBlobEvents = bs.totalBlobEvents;
  } catch {}

  try {
    const [pgR, spR, slR] = await Promise.allSettled([
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (pgR.status === "fulfilled" && pgR.value.ok) { const d: any = await pgR.value.json(); placementGroups = nb(d?.data?.next_unassigned_placement_group_index); }
    if (spR.status === "fulfilled" && spR.value.ok) { const d: any = await spR.value.json(); const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? []; zones.forEach(z => { storageProviders += (z.value?.value ?? []).length; }); }
    if (slR.status === "fulfilled" && slR.value.ok) { const d: any = await slR.value.json(); slices = nb(d?.data?.slices?.big_vec?.vec?.[0]?.end_index) + nb(d?.data?.slices?.inline_vec?.length); }
  } catch {}

  return { blockHeight, totalBlobs, totalStorageUsedBytes, storageProviders, placementGroups, slices, totalBlobEvents };
}

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
  for (const z of zones) for (const n of (z.value?.value ?? [])) out.push({ address: n.addr, zone: z.key, state: "Active", health: n.status?.condition === 0 ? "Healthy" : "Faulty", bls_key: "", net_address: "", capacity: n.status?.quota?.value });
  return out;
}

async function writeR2Snapshot(env: Env, network: NetworkId, ctx: ExecutionContext) {
  try {
    const stats = await fetchNetworkStats(network);
    const now = new Date();
    const key = `snapshots/${network}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${String(now.getUTCDate()).padStart(2,"0")}/${String(now.getUTCHours()).padStart(2,"0")}.json`;
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

async function handleStats(url: URL, env: Env): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (!NETWORKS[network]) return Response.json({ ok: false, error: "Unknown network" }, { status: 400, headers: CORS });
  const cfg = NETWORKS[network];

  let node = null;
  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const d: any = await r.json(); node = { blockHeight: nb(d.block_height), ledgerVersion: nb(d.ledger_version), chainId: nb(d.chain_id) }; }
  } catch {}

  let stats: Record<string, number | null> = { totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, storageProviders: null, placementGroups: null, slices: null };
  let source = "none";

  // Priority 1: On-chain view functions + resources
  try {
    const bs = await fetchBlobStats(cfg.nodeUrl, cfg.coreAddress);
    if (bs.totalBlobs > 0) {
      stats.totalBlobs            = bs.totalBlobs;
      stats.totalStorageUsedBytes = bs.totalStorageUsedBytes || null;
      stats.totalBlobEvents       = bs.totalBlobEvents || null;
      source = "on-chain-view";
    }
  } catch {}

  // Priority 2: R2 snapshot
  if (!stats.totalBlobs) {
    try {
      const prefix = `snapshots/${network}/`;
      const list = await env.SHELBY_R2.list({ prefix, limit: 10 });
      const keys = list.objects.map(o => o.key).sort((a,b) => b.localeCompare(a));
      for (const key of keys) {
        const obj = await env.SHELBY_R2.get(key); if (!obj) continue;
        const snap: StatsSnapshot = JSON.parse(await obj.text());
        if (snap.totalBlobs > 10) {
          stats.totalBlobs = snap.totalBlobs;
          stats.totalStorageUsedBytes = snap.totalStorageUsedBytes;
          stats.totalBlobEvents = snap.totalBlobEvents;
          source = "r2-snapshot";
          break;
        }
      }
    } catch {}
  }

  // On-chain: providers, PGs, slices (luôn fresh)
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

// /debug2: Probe all resources of core contract to find blob count fields
async function handleDebug2(url: URL): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const cfg = NETWORKS[network];
  const results: Record<string, any> = {};

  // List all resources
  try {
    const r = await fetch(`${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resources?limit=200`, { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const resources: any[] = await r.json();
      results.resource_types = resources.map(r => r.type);
      results.resource_count = resources.length;

      // Show data for blob/stats related resources
      for (const res of resources) {
        const type: string = res.type ?? "";
        if (type.includes("blob") || type.includes("Blob") || type.includes("statistic") || type.includes("Statistic") || type.includes("registry") || type.includes("Registry")) {
          results[type] = res.data;
        }
      }
    }
  } catch (e: any) { results.resources_error = e.message; }

  // Try view functions
  const viewFns = [
    `${cfg.coreAddress}::blob_registry::blob_count`,
    `${cfg.coreAddress}::blob_registry::total_blobs`,
    `${cfg.coreAddress}::statistics::get_stats`,
    `${cfg.coreAddress}::blob_registry::total_size`,
    `${cfg.coreAddress}::blob_registry::get_total_blobs`,
  ];

  results.view_results = {};
  for (const fn of viewFns) {
    try {
      const r = await fetch(`${cfg.nodeUrl}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ function: fn, type_arguments: [], arguments: [] }),
        signal: AbortSignal.timeout(5000),
      });
      results.view_results[fn] = r.ok ? await r.json() : `HTTP ${r.status}`;
    } catch (e: any) {
      results.view_results[fn] = e.message;
    }
  }

  return Response.json({ ok: true, network, coreAddress: cfg.coreAddress, results }, { headers: CORS });
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
    if (url.pathname === "/health")    return Response.json({ ok: true, worker: "shelby-geo-sync", version: "2.4.0", ts: new Date().toISOString() }, { headers: CORS });
    if (url.pathname === "/nodes"     && request.method === "GET")  return handleNodes(url, env);
    if (url.pathname === "/snapshots" && request.method === "GET")  return handleSnapshots(url, env);
    if (url.pathname === "/stats"     && request.method === "GET")  return handleStats(url, env);
    if (url.pathname === "/debug2"    && request.method === "GET")  return handleDebug2(url);
    if (url.pathname === "/sync"      && request.method === "POST") return handleSync(url, env, ctx);
    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: CORS });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[geo-sync] CRON at ${new Date().toISOString()}`);
    await Promise.allSettled([syncNetwork("shelbynet", env, ctx), syncNetwork("testnet", env, ctx)]);
    console.log("[geo-sync] CRON done");
  },
};