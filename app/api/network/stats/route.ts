// app/api/network/stats/route.ts — v8
// FIX: Hardcode Worker URL (không phụ thuộc env var SHELBY_WORKER_URL)
// FIX: Trả error detail trong response để debug
// Worker URL: https://shelby-geo-sync.doanvandanh20000.workers.dev

import { NextRequest, NextResponse } from "next/server";

export const runtime    = "edge";
export const revalidate = 15;

// Worker URL hardcode — đổi nếu subdomain khác
// Hoặc set env var SHELBY_WORKER_URL để override
const WORKER_URL = process.env.SHELBY_WORKER_URL
  ?? "https://shelby-geo-sync.doanvandanh20000.workers.dev";

const CONFIGS = {
  shelbynet: {
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    explorerApi: "https://explorer.shelby.xyz/api/stats",
    core:        "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
  },
  testnet: {
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    explorerApi: "https://explorer.shelby.xyz/api/stats?network=testnet",
    core:        "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
  },
} as const;

type NetKey = keyof typeof CONFIGS;
const n = (v: any, fb = 0): number => { const x = Number(v ?? fb); return isNaN(x) ? fb : x; };

export async function GET(req: NextRequest) {
  const networkParam = (new URL(req.url).searchParams.get("network") ?? "shelbynet") as NetKey;
  const cfg          = CONFIGS[networkParam] ?? CONFIGS.shelbynet;
  const fetchedAt    = new Date().toISOString();
  const errors: string[] = [];

  // ── Node info ─────────────────────────────────────────────────────────────
  let node: any = null;
  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const d = await r.json() as any;
      node = {
        blockHeight:   n(d.block_height),
        ledgerVersion: n(d.ledger_version),
        chainId:       n(d.chain_id),
      };
    }
  } catch (e: any) { errors.push(`node: ${e.message}`); }

  // ── Priority 1: Worker /stats ─────────────────────────────────────────────
  try {
    const workerRes = await fetch(
      `${WORKER_URL}/stats?network=${networkParam}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { "Accept": "application/json" },
      }
    );

    if (workerRes.ok) {
      const data = await workerRes.json() as any;

      // Validate response có đủ data
      const s = data?.data?.stats;
      const hasRealData = s && (
        (s.totalBlobs != null && s.totalBlobs > 10) ||
        (s.storageProviders != null && s.storageProviders > 0) ||
        (s.totalBlobEvents != null && s.totalBlobEvents > 0)
      );

      if (hasRealData) {
        // Merge fresh node info
        if (node && data.data) data.data.node = node;
        return NextResponse.json(data, {
          headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" }
        });
      } else {
        errors.push(`worker: responded but no real data (blobs=${s?.totalBlobs})`);
      }
    } else {
      errors.push(`worker: HTTP ${workerRes.status}`);
    }
  } catch (e: any) {
    errors.push(`worker: ${e.message}`);
  }

  // ── Priority 2: Explorer API trực tiếp ───────────────────────────────────
  let stats: Record<string, number | null> = {
    totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null,
    storageProviders: null, placementGroups: null, slices: null,
  };
  let statsSource = "none";

  try {
    const r = await fetch(cfg.explorerApi, {
      signal: AbortSignal.timeout(7_000),
      headers: { "Accept": "application/json" },
    });
    if (r.ok) {
      const d = await r.json() as any;
      const blobs = n(d.total_blobs ?? d.totalBlobs);
      if (blobs > 0) {
        stats = {
          totalBlobs:            blobs,
          totalStorageUsedBytes: n(d.total_storage_used ?? d.totalStorageUsed),
          totalBlobEvents:       n(d.total_blob_events  ?? d.totalBlobEvents),
          storageProviders:      n(d.storage_providers  ?? d.storageProviders),
          placementGroups:       n(d.placement_groups   ?? d.placementGroups),
          slices:                n(d.slices),
        };
        statsSource = "explorer-direct";
      } else {
        errors.push(`explorer: blobs=0 (may be blocked)`);
      }
    } else {
      errors.push(`explorer: HTTP ${r.status}`);
    }
  } catch (e: any) {
    errors.push(`explorer: ${e.message}`);
  }

  // ── Priority 3: On-chain RPC ──────────────────────────────────────────────
  if (statsSource === "none") {
    try {
      const [pgR, spR, slR] = await Promise.allSettled([
        fetch(`${cfg.nodeUrl}/accounts/${cfg.core}/resource/${cfg.core}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(5_000) }),
        fetch(`${cfg.nodeUrl}/accounts/${cfg.core}/resource/${cfg.core}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(5_000) }),
        fetch(`${cfg.nodeUrl}/accounts/${cfg.core}/resource/${cfg.core}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(5_000) }),
      ]);
      if (pgR.status === "fulfilled" && pgR.value.ok) {
        const d = await pgR.value.json() as any;
        stats.placementGroups = n(d?.data?.next_unassigned_placement_group_index);
      }
      if (spR.status === "fulfilled" && spR.value.ok) {
        const d = await spR.value.json() as any;
        const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? [];
        let c = 0; zones.forEach(z => { c += (z.value?.value ?? []).length; });
        stats.storageProviders = c;
      }
      if (slR.status === "fulfilled" && slR.value.ok) {
        const d = await slR.value.json() as any;
        const sl = n(d?.data?.slices?.big_vec?.vec?.[0]?.end_index)
                 + n(d?.data?.slices?.inline_vec?.length);
        stats.slices     = sl;
        stats.totalBlobs = sl > 0 ? Math.ceil(sl / 16) : null;
      }
      statsSource = "on-chain-rpc";
    } catch (e: any) {
      errors.push(`rpc: ${e.message}`);
      statsSource = "failed";
    }
  }

  return NextResponse.json({
    ok: true,
    data: { node, stats, network: networkParam, statsSource, _errors: errors },
    fetchedAt,
  });
}