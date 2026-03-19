import { NextResponse } from "next/server";

export const runtime = "edge";

const NODE        = "https://api.shelbynet.shelby.xyz/v1";
const EXPLORER    = "https://explorer.shelby.xyz";

type CheckResult = { ok: boolean; latencyMs: number; detail?: string };

async function checkEndpoint(url: string, opts?: RequestInit): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(5000) });
    return { ok: r.ok, latencyMs: Date.now() - t0, detail: `HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - t0, detail: e.message };
  }
}

async function getNetworkStats() {
  // Shelby Explorer public API
  const stats = { totalBlobs: 0, totalStorageGB: 0, storageProviders: 0, placementGroups: 0, totalEvents: 0 };
  try {
    // Try explorer API endpoints
    const r = await fetch(`${EXPLORER}/api/stats`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      stats.totalBlobs       = Number(d?.total_blobs ?? d?.totalBlobs ?? 0);
      stats.totalStorageGB   = Number(d?.total_storage_used ?? d?.totalStorageUsed ?? 0) / 1e9;
      stats.storageProviders = Number(d?.storage_providers ?? d?.storageProviders ?? 0);
      stats.placementGroups  = Number(d?.placement_groups ?? d?.placementGroups ?? 0);
      stats.totalEvents      = Number(d?.total_blob_events ?? d?.totalBlobEvents ?? 0);
      return stats;
    }
  } catch {}

  // Fallback: scrape from public explorer page data
  try {
    const r = await fetch(`${EXPLORER}/api/network`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      stats.totalBlobs       = Number(d?.blobs ?? 0);
      stats.storageProviders = Number(d?.providers ?? 0);
    }
  } catch {}

  return stats;
}

export async function GET() {
  const [nodeCheck, ledgerCheck, networkStats] = await Promise.all([
    checkEndpoint(`${NODE}/`),
    checkEndpoint(`${NODE}/blocks/by_height/1`),
    getNetworkStats(),
  ]);

  let blockHeight   = 0;
  let ledgerVersion = 0;
  let chainId       = 0;
  try {
    const r = await fetch(`${NODE}/`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const d    = await r.json();
      blockHeight   = Number(d?.block_height   ?? 0);
      ledgerVersion = Number(d?.ledger_version ?? 0);
      chainId       = Number(d?.chain_id       ?? 0);
    }
  } catch {}

  const allOk = nodeCheck.ok && ledgerCheck.ok;

  return NextResponse.json({
    status: allOk ? "healthy" : nodeCheck.ok ? "degraded" : "down",
    checks: {
      node:   { ...nodeCheck,   name: "Fullnode"      },
      ledger: { ...ledgerCheck, name: "Ledger"        },
    },
    network: {
      blockHeight,
      ledgerVersion,
      chainId,
      name: "Shelbynet",
      ...networkStats,
    },
    checkedAt: new Date().toISOString(),
  });
}