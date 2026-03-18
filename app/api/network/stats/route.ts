// app/api/network/stats/route.ts — v2.0
// Cung cấp network metrics cho sidebar + dashboard
// Hỗ trợ ?network=shelbynet|testnet
// Giữ nguyên logic fallback từ v1 (Explorer → On-chain)

import { NextRequest, NextResponse } from "next/server";
import type { NetworkStats, ApiResult } from "@/lib/types";

export const revalidate = 15;

// ── Network config ─────────────────────────────────────────────────────────────
const NETWORK_CONFIG: Record<string, {
  coreAddress: string;
  nodeUrl:     string;
  explorerApi: string;
}> = {
  shelbynet: {
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    explorerApi: "https://explorer.shelby.xyz/api/stats",
  },
  testnet: {
    coreAddress: "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    explorerApi: "https://explorer.shelby.xyz/api/stats?network=testnet",
  },
};

async function getNodeInfo(nodeUrl: string) {
  const r = await fetch(`${nodeUrl}/`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Node HTTP ${r.status}`);
  return r.json();
}

export async function GET(req: NextRequest) {
  const fetchedAt    = new Date().toISOString();
  const networkParam = new URL(req.url).searchParams.get("network") || "shelbynet";
  const cfg          = NETWORK_CONFIG[networkParam] ?? NETWORK_CONFIG.shelbynet;

  let nodeInfo: any  = null;
  let nodeError:  string | null = null;
  let statsError: string | null = null;

  let stats: NetworkStats = {
    totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null,
    slices: null, placementGroups: null, storageProviders: null,
  };

  // Fetch node info
  try { nodeInfo = await getNodeInfo(cfg.nodeUrl); }
  catch (err: any) { nodeError = err.message; }

  // 1. Explorer API (preferred)
  try {
    const res = await fetch(cfg.explorerApi, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error("Explorer API down");
    const d = await res.json();
    stats.totalBlobs            = Number(d?.total_blobs || 0);
    stats.totalStorageUsedBytes = Number(d?.total_storage_used || 0);
    stats.totalBlobEvents       = Number(d?.total_blob_events || 0);
    stats.storageProviders      = Number(d?.storage_providers || 0);
    stats.placementGroups       = Number(d?.placement_groups || 0);
    stats.slices                = Number(d?.slices || 0);
  }
  // 2. Fallback: On-chain read
  catch (err: any) {
    statsError = "Using On-chain Fallback Data";
    const NODE = cfg.nodeUrl;
    const CORE = cfg.coreAddress;

    try {
      // Placement groups
      const pgRes = await fetch(`${NODE}/accounts/${CORE}/resource/${CORE}::placement_group_registry::PlacementGroups`);
      if (pgRes.ok) {
        const d = await pgRes.json();
        stats.placementGroups = Number(d?.data?.next_unassigned_placement_group_index ?? 0);
      }

      // Storage providers
      const spRes = await fetch(`${NODE}/accounts/${CORE}/resource/${CORE}::storage_provider_registry::StorageProviders`);
      if (spRes.ok) {
        const d = await spRes.json();
        const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? [];
        let count = 0;
        zones.forEach((z: any) => { count += (z.value?.value ?? []).length; });
        stats.storageProviders = count;
      }

      // Slices → heuristic blobs
      const sliceRes = await fetch(`${NODE}/accounts/${CORE}/resource/${CORE}::slice_registry::SliceRegistry`);
      if (sliceRes.ok) {
        const d = await sliceRes.json();
        const bigEnd    = Number(d?.data?.slices?.big_vec?.vec?.[0]?.end_index || 0);
        const inlineLen = Number(d?.data?.slices?.inline_vec?.length || 0);
        const total     = bigEnd + inlineLen;
        stats.slices = total;
        if (total > 0) {
          stats.totalBlobs            = Math.ceil(total / 16);
          stats.totalStorageUsedBytes = stats.totalBlobs * 2 * 1024 * 1024;
          stats.totalBlobEvents       = stats.totalBlobs * 3;
        } else {
          stats.totalBlobs = stats.totalStorageUsedBytes = stats.totalBlobEvents = 0;
        }
      }
    } catch { statsError = "Both Explorer and On-chain fallback failed."; }
  }

  const body: ApiResult<any> = {
    ok: true,
    data: {
      node: nodeInfo ? {
        blockHeight:   Number(nodeInfo.block_height   ?? 0),
        ledgerVersion: Number(nodeInfo.ledger_version ?? 0),
        chainId:       Number(nodeInfo.chain_id       ?? 0),
      } : null,
      stats,
      network: networkParam,
      errors: {
        ...(nodeError  ? { node:  nodeError  } : {}),
        ...(statsError ? { stats: statsError } : {}),
      },
    },
    fetchedAt,
  };

  return NextResponse.json(body);
}