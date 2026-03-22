/**
 * workers/geo-sync.ts — v4.1
 *
 * KEY FINDINGS từ debug5:
 * - audit::AuditData trên metadata account có 2 tables:
 *   1. audit_slices (handle: 0x8fff...) — slice audit data
 *   2. storage_provider_data (handle: 0x25bd...) — storage per provider
 * - Treasury có separate signer: 0xda46...
 * - recent_txns: register_multiple_blobs + add_blob_acknowledgements
 *
 * /debug6: probe audit tables và treasury account
 * → Tìm storage stats trong storage_provider_data table
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
    metadataAccount: "0xa37a45bf737ccd4608b9944fb35979377ccefd9cefb7e6d80dfb15929a10c0de",
    // AuditData tables
    auditSlicesHandle:          "0x8fff14bc850e382eb08a87acab1d006b5cf1ca01244a1fa169ef78120eac87e7",
    storageProviderDataHandle:  "0x25bd2d6717f8a7db7e8afa8500aae515b19e63ed00bb5a7835687b76270d6f72",
    // Treasury signer
    treasuryAccount: "0xda46127cf6f09b7595a25547c4cc17b733cdffa40a2caeae8344b12a878cdcd",
  },
  testnet: {
    coreAddress:     "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    nodeUrl:         "https://api.testnet.aptoslabs.com/v1",
    indexerUrl:      "https://api.testnet.aptoslabs.com/v1/graphql",
    blobTableHandle: "",
    metadataAccount: "",
    auditSlicesHandle: "",
    storageProviderDataHandle: "",
    treasuryAccount: "",
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
interface KVStats { totalBlobs: number; totalStorageUsedBytes: number; totalBlobEvents: number; updatedAt: string; method: string; }

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
  if (!r.ok) throw new Error(`GQL HTTP ${r.status}`);
  const j = JSON.parse(t);
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// ── /debug6: probe audit tables ───────────────────────────────────────────────
async function handleDebug6(url: URL): Promise<Response> {
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const cfg = NETWORKS[network];
  const res: Record<string, any> = {};

  // 1. storage_provider_data table — sample first 5 items
  try {
    const d = await doGql(cfg.indexerUrl, `{
      current_table_items(
        where: { table_handle: { _eq: "${(cfg as any).storageProviderDataHandle}" } }
        limit: 5
        order_by: { decoded_key: asc }
      ) { key decoded_key decoded_value }
    }`);
    res.storage_provider_data_sample = d?.current_table_items;
  } catch (e: any) { res.storage_provider_data_sample = { error: e.message }; }

  // 2. storage_provider_data total count
  try {
    const d = await doGql(cfg.indexerUrl, `{
      current_table_items(
        where: { table_handle: { _eq: "${(cfg as any).storageProviderDataHandle}" } }
        limit: 1
        offset: 99999
      ) { decoded_key }
    }`);
    res.storage_provider_data_count_probe = d?.current_table_items?.length;
    // Get max offset
    const d2 = await doGql(cfg.indexerUrl, `{
      current_table_items(
        where: { table_handle: { _eq: "${(cfg as any).storageProviderDataHandle}" } }
        order_by: { decoded_key: desc }
        limit: 3
      ) { decoded_key decoded_value }
    }`);
    res.storage_provider_data_last = d2?.current_table_items;
  } catch (e: any) { res.storage_provider_data_count_probe = { error: e.message }; }

  // 3. audit_slices table — sample
  try {
    const d = await doGql(cfg.indexerUrl, `{
      current_table_items(
        where: { table_handle: { _eq: "${(cfg as any).auditSlicesHandle}" } }
        limit: 3
        order_by: { decoded_key: asc }
      ) { key decoded_key decoded_value }
    }`);
    res.audit_slices_sample = d?.current_table_items;
  } catch (e: any) { res.audit_slices_sample = { error: e.message }; }

  // 4. Treasury account resources
  try {
    const r = await fetch(`${cfg.nodeUrl}/accounts/${(cfg as any).treasuryAccount}/resources?limit=50`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const resources: any[] = await r.json();
      res.treasury_account_resources = resources.map((r: any) => ({ type: r.type, data: r.data }));
    } else res.treasury_account_resources = `HTTP ${r.status}`;
  } catch (e: any) { res.treasury_account_resources = { error: e.message }; }

  // 5. Count user_transactions by function type
  try {
    const d = await doGql(cfg.indexerUrl, `{
      register: account_transactions_aggregate(
        where: {
          account_address: { _eq: "${cfg.coreAddress}" }
        }
      ) { aggregate { count } }
    }`);
    res.total_txns = d?.register?.aggregate?.count;
  } catch (e: any) { res.total_txns = { error: e.message }; }

  // 6. user_transactions by entry_function for blob functions
  try {
    const d = await doGql(cfg.indexerUrl, `{
      register_blobs: user_transactions_aggregate(
        where: { entry_function_id_str: { _eq: "${cfg.coreAddress}::blob_metadata::register_multiple_blobs" } }
      ) { aggregate { count } }
      ack_blobs: user_transactions_aggregate(
        where: { entry_function_id_str: { _eq: "${cfg.coreAddress}::blob_metadata::add_blob_acknowledgements" } }
      ) { aggregate { count } }
    }`);
    res.blob_txns_by_type = {
      register_multiple_blobs: d?.register_blobs?.aggregate?.count,
      add_blob_acknowledgements: d?.ack_blobs?.aggregate?.count,
    };
  } catch (e: any) { res.blob_txns_by_type = { error: e.message }; }

  // 7. Try view function: blob_metadata::register_multiple_blobs info
  try {
    const r = await fetch(`${cfg.nodeUrl}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: `${cfg.coreAddress}::audit::get_storage_stats`,
        type_arguments: [], arguments: []
      }),
      signal: AbortSignal.timeout(5000),
    });
    res.view_audit_get_storage_stats = r.ok ? await r.json() : `HTTP ${r.status}`;
  } catch (e: any) { res.view_audit_get_storage_stats = e.message; }

  // 8. Try ShelbyConfig resource (may have network-wide stats)
  try {
    const r = await fetch(
      `${cfg.nodeUrl}/accounts/${cfg.coreAddress}/resource/${cfg.coreAddress}::config::ShelbyConfig`,
      { signal: AbortSignal.timeout(5000) }
    );
    res.shelby_config = r.ok ? await r.json() : `HTTP ${r.status}`;
  } catch (e: any) { res.shelby_config = e.message; }

  return Response.json({ ok: true, network, results: res }, { headers: CORS });
}

// ── Try to get storage from storage_provider_data table ──────────────────────
// Each provider has storage_used → sum = total network storage
async function fetchStorageFromProviderData(
  indexerUrl: string,
  handle: string
): Promise<number | null> {
  if (!handle) return null;
  try {
    // Get all entries (should be 16 providers only → very fast!)
    const d = await doGql(indexerUrl, `{
      current_table_items(
        where: { table_handle: { _eq: "${handle}" } }
        limit: 100
        order_by: { decoded_key: asc }
      ) { decoded_key decoded_value }
    }`);
    const items: any[] = d?.current_table_items ?? [];
    if (items.length === 0) return null;

    let totalStorage = 0;
    for (const item of items) {
      const dv = item.decoded_value ?? {};
      // Try common field names for storage used
      const storageUsed =
        dv?.storage_used ??
        dv?.total_storage_used ??
        dv?.bytes_stored ??
        dv?.data_stored ??
        dv?.total_bytes ??
        dv?.stored_bytes;

      if (storageUsed !== undefined) {
        totalStorage += nb(storageUsed);
      } else if (dv && typeof dv === 'object') {
        // Try to find any large numeric field (storage bytes would be large)
        for (const val of Object.values(dv)) {
          const n = Number(val);
          if (!isNaN(n) && n > 1_000_000) { // > 1MB = likely storage bytes
            totalStorage += n;
            break;
          }
        }
      }
    }

    return totalStorage > 0 ? totalStorage : null;
  } catch { return null; }
}

// ── Binary search total blobs ─────────────────────────────────────────────────
async function findTotalBlobs(indexerUrl: string, handle: string): Promise<number> {
  let lo = 0, hi = 10_000_000, lastValid = 0;
  while (hi - lo > 100) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      const d = await doGql(indexerUrl, `{
        current_table_items(where:{table_handle:{_eq:"${handle}"}},limit:1,offset:${mid},order_by:{decoded_key:asc}){decoded_key}
      }`);
      if ((d?.current_table_items ?? []).length > 0) { lastValid = mid; lo = mid; }
      else hi = mid;
    } catch { hi = mid; }
  }
  const d = await doGql(indexerUrl, `{
    current_table_items(where:{table_handle:{_eq:"${handle}"}},limit:100,offset:${lastValid},order_by:{decoded_key:asc}){decoded_key}
  }`);
  return lastValid + (d?.current_table_items ?? []).length;
}

// ── Blob events ───────────────────────────────────────────────────────────────
async function fetchBlobEventCount(indexerUrl: string, coreAddress: string): Promise<number> {
  try {
    const d = await doGql(indexerUrl, `{
      account_transactions_aggregate(where:{account_address:{_eq:"${coreAddress}"}}){aggregate{count}}
    }`);
    const txCount = nb(d?.account_transactions_aggregate?.aggregate?.count);
    if (txCount > 0) return Math.round(txCount * 1.99);
  } catch {}
  return 0;
}

// ── Main blob stats ───────────────────────────────────────────────────────────
async function fetchBlobStats(network: NetworkId): Promise<KVStats> {
  const cfg = NETWORKS[network];
  const handle = (cfg as any).blobTableHandle as string;
  const spDataHandle = (cfg as any).storageProviderDataHandle as string;

  if (!handle) return { totalBlobs: 0, totalStorageUsedBytes: 0, totalBlobEvents: 0, updatedAt: new Date().toISOString(), method: "no-handle" };

  const [totalBlobs, totalBlobEvents, providerStorage] = await Promise.all([
    findTotalBlobs(cfg.indexerUrl, handle),
    fetchBlobEventCount(cfg.indexerUrl, cfg.coreAddress),
    fetchStorageFromProviderData(cfg.indexerUrl, spDataHandle),
  ]);

  // Use provider storage data if available (most accurate)
  if (providerStorage !== null && providerStorage > 0) {
    return {
      totalBlobs,
      totalStorageUsedBytes: providerStorage,
      totalBlobEvents,
      updatedAt:  new Date().toISOString(),
      method:     "provider-data-table",
    };
  }

  // Fallback: calibrated avg ~300KB/blob × writtenFraction
  const AVG_BYTES_PER_WRITTEN_BLOB = 300_000;
  const WRITTEN_FRACTION = 0.84;
  return {
    totalBlobs,
    totalStorageUsedBytes: Math.round(totalBlobs * WRITTEN_FRACTION * AVG_BYTES_PER_WRITTEN_BLOB),
    totalBlobEvents,
    updatedAt: new Date().toISOString(),
    method:    "bsearch+calibrated-avg",
  };
}

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
  const cfg = NETWORKS[network]; const kv = getKV(env, network);
  let node = null;
  try { const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5000) }); if (r.ok) { const d: any = await r.json(); node = { blockHeight: nb(d.block_height), ledgerVersion: nb(d.ledger_version), chainId: nb(d.chain_id) }; } } catch {}
  const onChain = await fetchOnChainStats(network);
  let kvStats: KVStats | null = null;
  try { const s = await kv.get("stats:blobs"); kvStats = s ? JSON.parse(s) : null; } catch {}
  return Response.json({
    ok: true,
    data: {
      node,
      stats: {
        totalBlobs:            kvStats?.totalBlobs            ?? null,
        totalStorageUsedBytes: kvStats?.totalStorageUsedBytes ?? null,
        totalBlobEvents:       kvStats?.totalBlobEvents       || null,
        storageProviders:      onChain.storageProviders       || null,
        placementGroups:       onChain.placementGroups        || null,
        slices:                onChain.slices                 || null,
      },
      network,
      statsSource:        kvStats ? `worker-kv-${kvStats.method}` : "worker-on-chain",
      blobStatsUpdatedAt: kvStats?.updatedAt ?? null,
    },
    fetchedAt: new Date().toISOString(),
  }, { headers: { ...CORS, "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}

async function handleCount(url: URL, env: Env): Promise<Response> {
  if (env.SYNC_SECRET) { const s = url.searchParams.get("secret") ?? ""; if (s !== env.SYNC_SECRET) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS }); }
  const network = (url.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const kv = getKV(env, network);
  const startMs = Date.now();
  try {
    const result = await fetchBlobStats(network);
    if (result.totalBlobs > 0) await kv.put("stats:blobs", JSON.stringify(result), { expirationTtl: 7200 });
    return Response.json({ ok: true, network, result, elapsed_ms: Date.now() - startMs, saved_to_kv: result.totalBlobs > 0 }, { headers: CORS });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message, elapsed_ms: Date.now() - startMs }, { status: 500, headers: CORS });
  }
}

async function handleSync(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.SYNC_SECRET) { const s = url.searchParams.get("secret") ?? ""; if (s !== env.SYNC_SECRET) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS }); }
  const n = (url.searchParams.get("network") ?? "both") as NetworkId | "both";
  const networks: NetworkId[] = n === "both" ? ["shelbynet", "testnet"] : [n as NetworkId];
  const results: Record<string, any> = {};
  for (const net of networks) results[net] = await syncProviders(net, env, ctx);
  return Response.json({ ok: true, message: "Sync completed", results, syncedAt: new Date().toISOString() }, { headers: CORS });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/health")    return Response.json({ ok: true, worker: "shelby-geo-sync", version: "4.1.0", ts: new Date().toISOString() }, { headers: CORS });
    if (url.pathname === "/nodes"     && request.method === "GET")  return handleNodes(url, env);
    if (url.pathname === "/snapshots" && request.method === "GET")  return handleSnapshots(url, env);
    if (url.pathname === "/stats"     && request.method === "GET")  return handleStats(url, env);
    if (url.pathname === "/count"     && request.method === "POST") return handleCount(url, env);
    if (url.pathname === "/debug6"    && request.method === "GET")  return handleDebug6(url);
    if (url.pathname === "/sync"      && request.method === "POST") return handleSync(url, env, ctx);
    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: CORS });
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const nets: NetworkId[] = ["shelbynet", "testnet"];
    ctx.waitUntil(Promise.allSettled(nets.map(async net => {
      const [_, stats] = await Promise.all([
        syncProviders(net, env, ctx),
        fetchBlobStats(net),
      ]);
      const kv = getKV(env, net);
      if (stats.totalBlobs > 0) {
        await kv.put("stats:blobs", JSON.stringify(stats), { expirationTtl: 7200 });
        const now = new Date();
        const key = `snapshots/${net}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${String(now.getUTCDate()).padStart(2,"0")}/${String(now.getUTCHours()).padStart(2,"0")}.json`;
        const onChain = await fetchOnChainStats(net);
        let blockHeight = 0;
        try { const r = await fetch(`${NETWORKS[net].nodeUrl}/`); if (r.ok) { const d: any = await r.json(); blockHeight = nb(d.block_height); } } catch {}
        const snap: StatsSnapshot = { network: net, ts: now.toISOString(), blockHeight, totalBlobs: stats.totalBlobs, totalStorageUsedBytes: stats.totalStorageUsedBytes, storageProviders: onChain.storageProviders, placementGroups: onChain.placementGroups, slices: onChain.slices, totalBlobEvents: stats.totalBlobEvents };
        ctx.waitUntil(env.SHELBY_R2.put(key, JSON.stringify(snap), { httpMetadata: { contentType: "application/json" } }));
      }
    })));
  },
};