// app/api/benchmark/health/route.ts
// FIX: thêm `as any` vào tất cả r.json() calls → tránh TS2339 strict mode error
// Rule chung: r.json() trong edge routes LUÔN cần `as any` hoặc typed interface

import { NextResponse } from "next/server";

export const runtime = "edge";

const NODE     = "https://api.shelbynet.shelby.xyz/v1";
const EXPLORER = "https://explorer.shelby.xyz";

type CheckResult = { ok: boolean; latencyMs: number; detail?: string };

async function checkEndpoint(url: string, opts?: RequestInit): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(5_000) });
    return { ok: r.ok, latencyMs: Date.now() - t0, detail: `HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - t0, detail: e.message };
  }
}

async function getNetworkStats() {
  const stats = { totalBlobs: 0, totalStorageGB: 0, storageProviders: 0, placementGroups: 0, totalEvents: 0 };
  try {
    const r = await fetch(`${EXPLORER}/api/stats`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const d = await r.json() as any; // FIX: as any
      stats.totalBlobs       = Number(d?.total_blobs      ?? d?.totalBlobs       ?? 0);
      stats.totalStorageGB   = Number(d?.total_storage_used ?? d?.totalStorageUsed ?? 0) / 1e9;
      stats.storageProviders = Number(d?.storage_providers ?? d?.storageProviders  ?? 0);
      stats.placementGroups  = Number(d?.placement_groups  ?? d?.placementGroups   ?? 0);
      stats.totalEvents      = Number(d?.total_blob_events ?? d?.totalBlobEvents    ?? 0);
      return stats;
    }
  } catch {}
  try {
    const r = await fetch(`${EXPLORER}/api/network`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const d = await r.json() as any; // FIX: as any
      stats.totalBlobs       = Number(d?.blobs     ?? 0);
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

  let blockHeight = 0, ledgerVersion = 0, chainId = 0;
  try {
    const r = await fetch(`${NODE}/`, { signal: AbortSignal.timeout(4_000) });
    if (r.ok) {
      const d = await r.json() as any; // FIX: as any
      blockHeight   = Number(d?.block_height   ?? 0);
      ledgerVersion = Number(d?.ledger_version ?? 0);
      chainId       = Number(d?.chain_id       ?? 0);
    }
  } catch {}

  const allOk = nodeCheck.ok && ledgerCheck.ok;
  return NextResponse.json({
    status: allOk ? "healthy" : nodeCheck.ok ? "degraded" : "down",
    checks: {
      node:   { ...nodeCheck,   name: "Fullnode" },
      ledger: { ...ledgerCheck, name: "Ledger"   },
    },
    network: { blockHeight, ledgerVersion, chainId, name: "Shelbynet", ...networkStats },
    checkedAt: new Date().toISOString(),
  });
}
