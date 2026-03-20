// app/api/network/stats/route.ts — FINAL v7
// ✅ edge runtime (CF Pages bắt buộc)
//
// Priority chain:
// 1. GET Worker /stats  → Worker gọi Explorer OK (không bị block)
// 2. GET Explorer trực tiếp → OK trên local, có thể bị block trên CF Pages
// 3. On-chain RPC fallback  → Số liệu kém chính xác nhưng không crash
//
// Setup: Thêm SHELBY_WORKER_URL vào CF Pages env vars
// Value: https://shelby-geo-sync.<your-subdomain>.workers.dev
// Tìm URL: CF Dashboard → Workers & Pages → shelby-geo-sync → Settings → Domains

import { NextRequest, NextResponse } from "next/server";

export const runtime    = "edge";
export const revalidate = 15;

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

const n = (v: any, fb = 0): number => {
  const x = Number(v ?? fb);
  return isNaN(x) ? fb : x;
};

export async function GET(req: NextRequest) {
  const networkParam = (new URL(req.url).searchParams.get("network") ?? "shelbynet") as NetKey;
  const cfg          = CONFIGS[networkParam] ?? CONFIGS.shelbynet;
  const fetchedAt    = new Date().toISOString();

  // ── Node info (không phụ thuộc priority) ─────────────────────────────────
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
  } catch {}

  // ── Priority 1: Worker /stats ─────────────────────────────────────────────
  // Worker (shelby-geo-sync) có thể gọi Explorer API không bị block
  const workerUrl = process.env.SHELBY_WORKER_URL;
  if (workerUrl) {
    try {
      const r = await fetch(
        `${workerUrl}/stats?network=${networkParam}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      if (r.ok) {
        const data = await r.json() as any;
        if (data?.ok && data?.data?.stats) {
          // Merge node info mới nhất (fresh từ request này)
          if (node && data.data) data.data.node = node;
          return NextResponse.json(data, {
            headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" }
          });
        }
      }
    } catch { /* Worker không khả dụng hoặc chưa deploy */ }
  }

  // ── Priority 2: Explorer API trực tiếp ───────────────────────────────────
  // Hoạt động tốt trên local dev; trên CF Pages có thể bị block tùy region
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
      // Chỉ dùng nếu có data thực (không phải 0)
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
      }
    }
  } catch { /* bị block trên CF Pages edge — tiếp tục fallback */ }

  // ── Priority 3: On-chain RPC (always runs for providers/PGs if missing) ──
  if (!stats.storageProviders || !stats.placementGroups || statsSource === "none") {
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
        stats.slices = sl;
        // Chỉ estimate blob count nếu Explorer không cung cấp
        if (!stats.totalBlobs && sl > 0) {
          stats.totalBlobs = Math.ceil(sl / 16);
          statsSource = "on-chain-rpc";
        }
      }

      if (statsSource === "none") statsSource = "on-chain-rpc";
    } catch { statsSource = "failed"; }
  }

  return NextResponse.json({
    ok: true,
    data: { node, stats, network: networkParam, statsSource },
    fetchedAt,
  });
}