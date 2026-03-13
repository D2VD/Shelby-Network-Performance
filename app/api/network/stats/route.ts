// app/api/network/stats/route.ts
// Fetches aggregate network statistics: total blobs, storage used, blob events, etc.
// These are the same numbers shown in the Shelby Explorer dashboard.

import { NextResponse } from "next/server";
import type { NetworkStats, ApiResult } from "@/lib/types";

const RPC  = "https://api.shelbynet.shelby.xyz/shelby";
const NODE = "https://api.shelbynet.shelby.xyz/v1";

async function rpcPost(method: string, params: unknown[] = []) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 15 },
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function getNodeInfo() {
  const r = await fetch(`${NODE}/`, {
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 10 },
  });
  if (!r.ok) throw new Error(`Node HTTP ${r.status}`);
  return r.json();
}

export async function GET() {
  const fetchedAt = new Date().toISOString();

  // Fetch node info (for block height, chain id)
  let nodeInfo: any = null;
  let nodeError: string | null = null;
  try {
    nodeInfo = await getNodeInfo();
  } catch (err: any) {
    nodeError = err.message;
  }

  // Fetch network stats via RPC — try multiple method names
  let stats: NetworkStats = {
    totalBlobs:            null,
    totalStorageUsedBytes: null,
    totalBlobEvents:       null,
    slices:                null,
    placementGroups:       null,
    storageProviders:      null,
  };
  let statsError: string | null = null;

  const methodsToTry = [
    "shelby_getNetworkStats",
    "shelby_networkStats",
    "shelby_getStats",
    "shelby_stats",
  ];

  for (const method of methodsToTry) {
    try {
      const result = await rpcPost(method, []);
      if (result && typeof result === "object") {
        // Normalize field names — the API may use snake_case or camelCase
        stats = {
          totalBlobs:            Number(result.total_blobs            ?? result.totalBlobs            ?? result.blob_count      ?? 0) || null,
          totalStorageUsedBytes: Number(result.total_storage_used     ?? result.totalStorageUsed      ?? result.storage_used    ?? 0) || null,
          totalBlobEvents:       Number(result.total_blob_events      ?? result.totalBlobEvents       ?? result.event_count     ?? 0) || null,
          slices:                Number(result.slices                 ?? result.slice_count           ?? 0) || null,
          placementGroups:       Number(result.placement_groups       ?? result.placementGroups       ?? result.pg_count        ?? 0) || null,
          storageProviders:      Number(result.storage_providers      ?? result.storageProviders      ?? result.provider_count  ?? 0) || null,
        };
        statsError = null;
        break;
      }
    } catch (err: any) {
      statsError = `${method}: ${err.message}`;
      // continue to next method
    }
  }

  // If node is also down, return error
  if (!nodeInfo && !stats.totalBlobs) {
    const body: ApiResult<never> = {
      ok: false,
      error: `Node unreachable${statsError ? ` | Stats: ${statsError}` : ""}${nodeError ? ` | Node: ${nodeError}` : ""}`,
      fetchedAt,
    };
    return NextResponse.json(body, { status: 503 });
  }

  const body: ApiResult<{
    node: { blockHeight: number; ledgerVersion: number; chainId: number } | null;
    stats: NetworkStats;
    errors: Record<string, string>;
  }> = {
    ok: true,
    data: {
      node: nodeInfo ? {
        blockHeight:   Number(nodeInfo.block_height   ?? 0),
        ledgerVersion: Number(nodeInfo.ledger_version ?? 0),
        chainId:       Number(nodeInfo.chain_id       ?? 0),
      } : null,
      stats,
      errors: {
        ...(nodeError  ? { node: nodeError }  : {}),
        ...(statsError ? { stats: statsError } : {}),
      },
    },
    fetchedAt,
  };

  return NextResponse.json(body);
}