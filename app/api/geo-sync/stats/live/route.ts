// app/api/geo-sync/stats/live/route.ts — v3.0
//
// This route is used by Charts page for testnet stats.
// Now fetches DIRECTLY from Aptos Node REST (not VPS proxy).
// Same logic as /api/network/stats/live but returned in TestnetSnapshot shape.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const CONFIGS = {
  shelbynet: {
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    apiKeyEnv:   "SHELBY_API_KEY",
  },
  testnet: {
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    apiKeyEnv:   "SHELBY_TESTNET_API_KEY",
  },
} as const;
type NetworkId = keyof typeof CONFIGS;

function nb(v: unknown, fb = 0): number { const x = Number(v ?? fb); return isNaN(x) ? fb : x; }

function apiHeaders(network: NetworkId): Record<string, string> {
  const key = process.env[CONFIGS[network].apiKeyEnv] ?? "";
  return key ? { "Authorization": `Bearer ${key}` } : {};
}

type BTreeEntry = { key: string; value: Record<string, unknown> };
function extractBTreeEntries(map: unknown): BTreeEntry[] {
  if (!map || typeof map !== "object") return [];
  const m = map as Record<string, unknown>;
  const viaRoot = ((m.root as Record<string, unknown>)?.children as Record<string, unknown>)?.entries;
  if (Array.isArray(viaRoot)) return viaRoot as BTreeEntry[];
  if (Array.isArray(m.entries)) return m.entries as BTreeEntry[];
  if (Array.isArray(m.data))    return m.data    as BTreeEntry[];
  return [];
}

export async function GET(req: NextRequest) {
  const network = (req.nextUrl.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (network !== "shelbynet" && network !== "testnet") {
    return NextResponse.json({ ok: false, error: "Invalid network" }, { status: 400 });
  }

  const cfg  = CONFIGS[network];
  const core = cfg.coreAddress;
  const hdrs = apiHeaders(network);
  const now  = Date.now();

  // Fetch node + epoch in parallel
  const [nodeR, epochR] = await Promise.allSettled([
    fetch(`${cfg.nodeUrl}/`, { headers: hdrs, signal: AbortSignal.timeout(6_000) }),
    fetch(`${cfg.nodeUrl}/accounts/${core}/resource/${core}::epoch::Epoch`, { headers: hdrs, signal: AbortSignal.timeout(8_000) }),
  ]);

  let blockHeight = 0, ledgerVersion = 0, chainId = network === "testnet" ? 2 : 1;
  let storageProviders = 0, waitlistedProviders = 0, placementGroups = 0, slices = 0;

  if (nodeR.status === "fulfilled" && nodeR.value.ok) {
    const d = await nodeR.value.json() as Record<string, unknown>;
    blockHeight   = nb(d.block_height);
    ledgerVersion = nb(d.ledger_version);
    chainId       = nb(d.chain_id) || chainId;
  }

  if (epochR.status === "fulfilled" && epochR.value.ok) {
    const d    = await epochR.value.json() as Record<string, unknown>;
    const data = (d.data ?? d) as Record<string, unknown>;
    const active     = extractBTreeEntries(data.active_providers     ?? data.active_operators);
    const waitlisted = extractBTreeEntries(data.waitlisted_providers  ?? data.waitlisted_operators);
    storageProviders    = active.length;
    waitlistedProviders = waitlisted.length;
    const pgD = data.placement_groups ?? data.placement_group_count;
    const slD = data.slices           ?? data.slice_count;
    if (typeof pgD === "number") placementGroups = Math.round(pgD);
    if (typeof slD === "number") slices           = Math.round(slD);
  } else {
    // Epoch failed → try StorageProviders registry
    try {
      const r = await fetch(
        `${cfg.nodeUrl}/accounts/${core}/resource/${core}::storage_provider_registry::StorageProviders`,
        { headers: hdrs, signal: AbortSignal.timeout(6_000) }
      );
      if (r.ok) {
        const d     = await r.json() as Record<string, unknown>;
        const data  = (d.data ?? d) as Record<string, unknown>;
        const zones = extractBTreeEntries(data.active_providers_by_az ?? data.active_providers);
        storageProviders = zones.reduce((sum, z) => {
          const arr = (z.value as Record<string, unknown>)?.value;
          return sum + (Array.isArray(arr) ? arr.length : 0);
        }, 0);
      }
    } catch { /* silent */ }
  }

  // Try VPS for blob metrics (optional)
  let activeBlobs = 0, totalStorageBytes = 0, totalStorageGB = 0;
  let totalStorageGiB = 0, totalBlobEvents = 0;
  let pendingOrFailed = 0, pendingBlobs = 0, deletedBlobs = 0, failedBlobs = 0, emptyRecords = 0;
  let indexerStatus = "unavailable";

  const vpsUrl = process.env.SHELBY_API_URL ?? "";
  if (vpsUrl && blockHeight > 0) {
    try {
      const r = await fetch(`${vpsUrl}/api/geo-sync/stats/live?network=${network}`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (r.ok) {
        const j = await r.json() as Record<string, unknown>;
        const d = (j.data ?? {}) as Record<string, unknown>;
        activeBlobs      = nb(d.activeBlobs);
        totalStorageBytes = nb(d.totalStorageBytes);
        totalStorageGB    = nb(d.totalStorageGB);
        totalStorageGiB   = nb(d.totalStorageGiB);
        totalBlobEvents   = nb(d.totalBlobEvents);
        pendingOrFailed   = nb(d.pendingOrFailed);
        pendingBlobs      = nb(d.pendingBlobs);
        deletedBlobs      = nb(d.deletedBlobs);
        failedBlobs       = nb(d.failedBlobs);
        emptyRecords      = nb(d.emptyRecords);
        indexerStatus     = "live";
      }
    } catch { /* VPS down, blob metrics stay 0 */ }
  }

  const data = {
    ts:               new Date(now).toISOString(),
    tsMs:             now,
    network,
    // Chain (always from Node REST)
    blockHeight,
    ledgerVersion,
    chainId,
    // Network topology (from epoch::Epoch)
    storageProviders,
    waitlistedProviders,
    placementGroups,
    slices,
    // Blob metrics (from VPS/Indexer, best-effort)
    activeBlobs,
    totalStorageBytes,
    totalStorageGB,
    totalStorageGiB,
    totalBlobEvents,
    pendingOrFailed,
    pendingBlobs,
    deletedBlobs,
    failedBlobs,
    emptyRecords,
    // Meta
    indexerStatus,
    method:     `node-rest-direct${vpsUrl ? "+vps-blobs" : ""}`,
    cacheAge:   0,
    dataSource: "aptos-node-rest-direct",
  };

  return NextResponse.json(
    { ok: true, data, cached: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}