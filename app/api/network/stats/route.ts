// app/api/network/stats/route.ts — v4.0
//
// ARCHITECTURE CHANGE (Fix 503):
// Fetches network stats DIRECTLY from Aptos Node REST API.
// No VPS dependency for the primary data path.
// VPS is tried as optional source for blob metrics only.
//
// Per guide:
//   - Node API is the ground truth, extremely stable
//   - Two separate API keys: SHELBY_API_KEY (shelbynet) vs SHELBY_TESTNET_API_KEY (testnet)
//   - epoch::Epoch resource → active_providers (BPlusTreeMap) → SP list

import { type NextRequest, NextResponse } from "next/server";

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

function nb(v: unknown, fb = 0): number {
  const x = Number(v ?? fb);
  return isNaN(x) ? fb : x;
}

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

async function fetchAllStats(network: NetworkId) {
  const cfg  = CONFIGS[network];
  const core = cfg.coreAddress;
  const hdrs = apiHeaders(network);

  // Fetch node info, epoch registry, pg registry, slice registry in parallel
  const [nodeR, epochR, pgR, slR] = await Promise.allSettled([
    fetch(`${cfg.nodeUrl}/`, { headers: hdrs, signal: AbortSignal.timeout(6_000) }),
    fetch(`${cfg.nodeUrl}/accounts/${core}/resource/${core}::epoch::Epoch`, { headers: hdrs, signal: AbortSignal.timeout(8_000) }),
    fetch(`${cfg.nodeUrl}/accounts/${core}/resource/${core}::placement_group_registry::PlacementGroups`, { headers: hdrs, signal: AbortSignal.timeout(6_000) }),
    fetch(`${cfg.nodeUrl}/accounts/${core}/resource/${core}::slice_registry::SliceRegistry`, { headers: hdrs, signal: AbortSignal.timeout(6_000) }),
  ]);

  let blockHeight = 0, ledgerVersion = 0, chainId = 2;
  let storageProviders = 0, waitlistedProviders = 0, placementGroups = 0, slices = 0;

  // Node info
  if (nodeR.status === "fulfilled" && nodeR.value.ok) {
    const d = await nodeR.value.json() as Record<string, unknown>;
    blockHeight   = nb(d.block_height);
    ledgerVersion = nb(d.ledger_version);
    chainId       = nb(d.chain_id);
  }

  // Epoch registry → SP counts
  if (epochR.status === "fulfilled" && epochR.value.ok) {
    const d    = await epochR.value.json() as Record<string, unknown>;
    const data = (d.data ?? d) as Record<string, unknown>;
    const active     = extractBTreeEntries(data.active_providers     ?? data.active_operators);
    const waitlisted = extractBTreeEntries(data.waitlisted_providers  ?? data.waitlisted_operators);
    storageProviders    = active.length;
    waitlistedProviders = waitlisted.length;

    // PG and slice counts from epoch data if available
    const pgD = data.placement_groups ?? data.placement_group_count;
    const slD = data.slices           ?? data.slice_count;
    if (typeof pgD === "number") placementGroups = Math.round(pgD);
    if (typeof slD === "number") slices           = Math.round(slD);
  } else {
    // Fallback: StorageProviders by-zone registry
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

  // Placement groups (dedicated resource if not from epoch)
  if (placementGroups === 0 && pgR.status === "fulfilled" && pgR.value.ok) {
    const d = await pgR.value.json() as Record<string, unknown>;
    placementGroups = nb((d.data as Record<string, unknown>)?.next_unassigned_placement_group_index);
  }

  // Slices
  if (slices === 0 && slR.status === "fulfilled" && slR.value.ok) {
    const d     = await slR.value.json() as Record<string, unknown>;
    const slics = (d.data as Record<string, unknown>)?.slices as Record<string, unknown> | undefined;
    const bigVec = nb(((slics?.big_vec as Record<string, unknown>)
      ?.vec as Array<Record<string, unknown>>)?.[0]?.end_index);
    const inline  = nb((slics?.inline_vec as unknown[])?.length);
    slices = bigVec + inline;
  }

  return { blockHeight, ledgerVersion, chainId, storageProviders, waitlistedProviders, placementGroups, slices };
}

// Optional VPS blob metrics
async function tryVpsBlobMetrics(network: NetworkId) {
  const vpsUrl = process.env.SHELBY_API_URL ?? "";
  if (!vpsUrl) return null;
  try {
    const r = await fetch(`${vpsUrl}/api/geo-sync/stats?network=${network}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const j = await r.json() as Record<string, unknown>;
    const s = ((j.data as Record<string, unknown>)?.stats ?? {}) as Record<string, unknown>;
    return {
      totalBlobs:            nb(s.totalBlobs ?? s.activeBlobs),
      totalStorageUsedBytes: nb(s.totalStorageUsedBytes),
      totalBlobEvents:       nb(s.totalBlobEvents),
      statsMethod:           String(s.statsMethod ?? "vps-cache"),
    };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const network = (req.nextUrl.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (network !== "shelbynet" && network !== "testnet") {
    return NextResponse.json({ ok: false, error: "Invalid network" }, { status: 400 });
  }

  const [onChainResult, blobResult] = await Promise.allSettled([
    fetchAllStats(network),
    tryVpsBlobMetrics(network),
  ]);

  const node = onChainResult.status === "fulfilled"
    ? onChainResult.value
    : null;

  const blobs = blobResult.status === "fulfilled" ? blobResult.value : null;

  return NextResponse.json({
    ok: true,
    data: {
      node: node ? {
        blockHeight:   node.blockHeight,
        ledgerVersion: node.ledgerVersion,
        chainId:       node.chainId,
      } : null,
      stats: {
        totalBlobs:            blobs?.totalBlobs            ?? node?.storageProviders ?? null,
        activeBlobs:           null, // from live endpoint
        totalStorageUsedBytes: blobs?.totalStorageUsedBytes ?? null,
        totalBlobEvents:       blobs?.totalBlobEvents       ?? null,
        storageProviders:      node?.storageProviders       ?? null,
        waitlistedProviders:   node?.waitlistedProviders    ?? null,
        placementGroups:       node?.placementGroups        ?? null,
        slices:                node?.slices                 ?? null,
        statsMethod:           blobs?.statsMethod ?? "node-rest-direct",
        updatedAt:             new Date().toISOString(),
      },
      network,
      statsSource: node ? "node-rest-direct" : "error",
    },
    fetchedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" },
  });
}