// app/api/network/stats/live/route.ts — v4.0
//
// ARCHITECTURE CHANGE (Fix 503):
// BEFORE: Frontend → VPS proxy → Aptos Node  (VPS single point of failure → 503)
// AFTER:  Frontend → Aptos Node REST directly  (no VPS dependency for live stats)
//
// Strategy (per guide):
//   Tier 1 — Node REST: GET /v1/ → blockHeight, ledgerVersion, chainId
//   Tier 1 — Epoch Registry: GET /accounts/{core}/resource/{core}::epoch::Epoch
//             → BPlusTreeMap active_providers → SP count, waitlisted count
//   Auth: Bearer API key — shelbynet key ≠ testnet key (separate env vars)
//
// VPS is only used as fallback for blob metrics (from Dedicated Indexer).
// If VPS is down, we still return node + epoch data (most important metrics).

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// ─── Network configs ──────────────────────────────────────────────────────────
const CONFIGS = {
  shelbynet: {
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    apiKeyEnv:   "SHELBY_API_KEY",          // Gemoi key for shelbynet
  },
  testnet: {
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    apiKeyEnv:   "SHELBY_TESTNET_API_KEY",  // Gemoi key for testnet (DIFFERENT key)
  },
} as const;

type NetworkId = keyof typeof CONFIGS;

// ─── Helper ───────────────────────────────────────────────────────────────────
function nb(v: unknown, fb = 0): number {
  const x = Number(v ?? fb);
  return isNaN(x) ? fb : x;
}

function getApiKey(network: NetworkId): Record<string, string> {
  const envKey = CONFIGS[network].apiKeyEnv;
  const key    = process.env[envKey] ?? "";
  return key ? { "Authorization": `Bearer ${key}` } : {};
}

// ─── Tier 1: Node ledger info ─────────────────────────────────────────────────
async function fetchNodeInfo(network: NetworkId) {
  const cfg = CONFIGS[network];
  const r   = await fetch(`${cfg.nodeUrl}/`, {
    headers: getApiKey(network),
    signal:  AbortSignal.timeout(6_000),
  });
  if (!r.ok) throw new Error(`Node HTTP ${r.status}`);
  const d = await r.json() as Record<string, unknown>;
  return {
    blockHeight:   nb(d.block_height),
    ledgerVersion: nb(d.ledger_version),
    chainId:       nb(d.chain_id),
  };
}

// ─── Tier 1: Epoch Registry (BPlusTreeMap → SP list) ─────────────────────────
// Per guide: epoch::Epoch resource contains active_providers and waitlisted_providers
// Both are BPlusTreeMap structures: root → children → entries[] → { key: operator_addr }
type BTreeEntry = { key: string; value: Record<string, unknown> };

function extractBTreeEntries(map: unknown): BTreeEntry[] {
  if (!map || typeof map !== "object") return [];
  const m = map as Record<string, unknown>;
  // BPlusTreeMap: .root.children.entries[]
  const viaRoot = (
    (m.root as Record<string, unknown>)?.children as Record<string, unknown>
  )?.entries;
  if (Array.isArray(viaRoot)) return viaRoot as BTreeEntry[];
  if (Array.isArray(m.entries)) return m.entries as BTreeEntry[];
  if (Array.isArray(m.data))    return m.data    as BTreeEntry[];
  return [];
}

async function fetchEpochRegistry(network: NetworkId) {
  const cfg  = CONFIGS[network];
  const core = cfg.coreAddress;

  // Primary: epoch::Epoch resource (per guide step 3)
  try {
    const r = await fetch(
      `${cfg.nodeUrl}/accounts/${core}/resource/${core}::epoch::Epoch`,
      { headers: getApiKey(network), signal: AbortSignal.timeout(8_000) }
    );
    if (r.ok) {
      const d    = await r.json() as Record<string, unknown>;
      const data = (d.data ?? d) as Record<string, unknown>;

      const activeField     = data.active_providers     ?? data.active_operators;
      const waitlistedField = data.waitlisted_providers  ?? data.waitlisted_operators;

      const activeEntries     = extractBTreeEntries(activeField);
      const waitlistedEntries = extractBTreeEntries(waitlistedField);

      // Count placement groups and slices from epoch data
      const pgData  = data.placement_groups ?? data.placement_group_count;
      const slData  = data.slices           ?? data.slice_count;
      const pgCount = typeof pgData === "number" ? Math.round(pgData) :
                      pgData && typeof (pgData as Record<string, unknown>).length === "number"
                        ? (pgData as Record<string, unknown>).length as number : 0;
      const slCount = typeof slData === "number" ? Math.round(slData) :
                      slData && typeof (slData as Record<string, unknown>).length === "number"
                        ? (slData as Record<string, unknown>).length as number : 0;

      return {
        activeOperators:     activeEntries.map((e: BTreeEntry) => String(e.key ?? "")).filter(Boolean),
        waitlistedOperators: waitlistedEntries.map((e: BTreeEntry) => String(e.key ?? "")).filter(Boolean),
        placementGroups:     pgCount,
        slices:              slCount,
        source:              "epoch::Epoch",
      };
    }
  } catch (e) {
    console.warn(`[stats/live] epoch::Epoch failed for ${network}:`, (e as Error).message);
  }

  // Fallback: storage_provider_registry::StorageProviders (by-zone structure)
  try {
    const r = await fetch(
      `${cfg.nodeUrl}/accounts/${core}/resource/${core}::storage_provider_registry::StorageProviders`,
      { headers: getApiKey(network), signal: AbortSignal.timeout(8_000) }
    );
    if (r.ok) {
      const d    = await r.json() as Record<string, unknown>;
      const data = (d.data ?? d) as Record<string, unknown>;
      const zones = extractBTreeEntries(
        data.active_providers_by_az ?? data.active_providers
      );
      const operators: string[] = [];
      zones.forEach(z => {
        const spArr = (z.value as Record<string, unknown>)?.value;
        if (Array.isArray(spArr)) {
          spArr.forEach((sp: unknown) => {
            const addr = String((sp as Record<string, unknown>).addr ?? (sp as Record<string, unknown>).address ?? "");
            if (addr) operators.push(addr);
          });
        }
      });
      return { activeOperators: operators, waitlistedOperators: [], placementGroups: 0, slices: 0, source: "StorageProviders" };
    }
  } catch (e) {
    console.warn(`[stats/live] StorageProviders fallback failed:`, (e as Error).message);
  }

  return { activeOperators: [], waitlistedOperators: [], placementGroups: 0, slices: 0, source: "none" };
}

// ─── VPS blob metrics (optional, best-effort) ─────────────────────────────────
// VPS has Dedicated Indexer access for blob counts. If VPS is down → return null.
async function fetchBlobMetricsFromVPS(network: NetworkId) {
  const vpsUrl = process.env.SHELBY_API_URL ?? "";
  if (!vpsUrl) return null;
  try {
    const r = await fetch(`${vpsUrl}/api/geo-sync/stats/live?network=${network}`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const j   = await r.json() as Record<string, unknown>;
    const d   = (j.data ?? {}) as Record<string, unknown>;
    return {
      activeBlobs:      nb(d.activeBlobs),
      totalStorageBytes: nb(d.totalStorageBytes),
      totalStorageGB:    nb(d.totalStorageGB),
      totalStorageGiB:   nb(d.totalStorageGiB),
      totalBlobEvents:   nb(d.totalBlobEvents),
      pendingOrFailed:   nb(d.pendingOrFailed),
      pendingBlobs:      nb(d.pendingBlobs),
      deletedBlobs:      nb(d.deletedBlobs),
      failedBlobs:       nb(d.failedBlobs),
      emptyRecords:      nb(d.emptyRecords),
    };
  } catch { return null; }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const network = (req.nextUrl.searchParams.get("network") ?? "shelbynet") as NetworkId;
  if (network !== "shelbynet" && network !== "testnet") {
    return NextResponse.json({ ok: false, error: "Invalid network" }, { status: 400 });
  }

  // Run node info + epoch registry in parallel (both go directly to Aptos Node REST)
  const [nodeResult, epochResult, blobResult] = await Promise.allSettled([
    fetchNodeInfo(network),
    fetchEpochRegistry(network),
    fetchBlobMetricsFromVPS(network),
  ]);

  // Node info — required for basic display
  if (nodeResult.status === "rejected") {
    return NextResponse.json({
      ok:    false,
      error: `Node API unreachable: ${(nodeResult.reason as Error).message}`,
      hint:  "Check network connectivity to Aptos Node",
    }, { status: 503 });
  }
  const node  = nodeResult.value;
  const epoch = epochResult.status === "fulfilled"
    ? epochResult.value
    : { activeOperators: [], waitlistedOperators: [], placementGroups: 0, slices: 0, source: "error" };
  const blobs = blobResult.status === "fulfilled" ? blobResult.value : null;

  const ts  = new Date().toISOString();
  const tsMs = Date.now();

  const snap = {
    ts,
    tsMs,
    network,
    // Chain info (from Node REST — always available)
    blockHeight:          node.blockHeight,
    ledgerVersion:        node.ledgerVersion,
    chainId:              node.chainId,
    // Network topology (from epoch::Epoch REST — always available)
    storageProviders:     epoch.activeOperators.length,
    waitlistedProviders:  epoch.waitlistedOperators.length,
    placementGroups:      epoch.placementGroups,
    slices:               epoch.slices,
    // Blob metrics (from VPS Dedicated Indexer — optional, best-effort)
    activeBlobs:          blobs?.activeBlobs      ?? 0,
    totalStorageBytes:    blobs?.totalStorageBytes ?? 0,
    totalStorageGB:       blobs?.totalStorageGB    ?? 0,
    totalStorageGiB:      blobs?.totalStorageGiB   ?? 0,
    totalBlobEvents:      blobs?.totalBlobEvents   ?? 0,
    pendingOrFailed:      blobs?.pendingOrFailed   ?? 0,
    pendingBlobs:         blobs?.pendingBlobs      ?? 0,
    deletedBlobs:         blobs?.deletedBlobs      ?? 0,
    failedBlobs:          blobs?.failedBlobs       ?? 0,
    emptyRecords:         blobs?.emptyRecords      ?? 0,
    // Meta
    method:     `node-rest+${epoch.source}${blobs ? "+vps-blobs" : ""}`,
    cacheAge:   0,
    dataSource: "aptos-node-rest-direct",
  };

  return NextResponse.json(
    { ok: true, data: snap, cached: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}