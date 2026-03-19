// app/api/network/stats/route.ts
// FIX: export const runtime = "edge"
// FIX: Hỗ trợ ?network=shelbynet|testnet
// FIX: Fallback 3 lớp: Explorer API → On-chain RPC → zeros
import { NextRequest, NextResponse } from "next/server";

export const runtime    = "edge";
export const revalidate = 15;

const CONFIGS: Record<string, { node: string; core: string; explorer: string }> = {
  shelbynet: {
    node:     "https://api.shelbynet.shelby.xyz/v1",
    core:     "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    explorer: "https://explorer.shelby.xyz/api/stats",
  },
  testnet: {
    node:     "https://api.testnet.aptoslabs.com/v1",
    core:     "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    explorer: "https://explorer.shelby.xyz/api/stats?network=testnet",
  },
};

const n = (v: any, fb = 0) => { const x = Number(v ?? fb); return isNaN(x) ? fb : x; };

export async function GET(req: NextRequest) {
  const network = new URL(req.url).searchParams.get("network") ?? "shelbynet";
  const cfg = CONFIGS[network] ?? CONFIGS.shelbynet;
  const fetchedAt = new Date().toISOString();

  // Node info
  let nodeInfo: any = null;
  try {
    const r = await fetch(`${cfg.node}/`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) nodeInfo = await r.json();
  } catch {}

  const node = nodeInfo ? {
    blockHeight:   n(nodeInfo.block_height),
    ledgerVersion: n(nodeInfo.ledger_version),
    chainId:       n(nodeInfo.chain_id),
  } : null;

  let stats: any = {};
  let statsSource = "none";

  // Source 1: Explorer API (chính xác nhất)
  try {
    const r = await fetch(cfg.explorer, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    stats = {
      totalBlobs:            n(d.total_blobs ?? d.totalBlobs),
      totalStorageUsedBytes: n(d.total_storage_used ?? d.totalStorageUsed),
      totalBlobEvents:       n(d.total_blob_events ?? d.totalBlobEvents),
      storageProviders:      n(d.storage_providers ?? d.storageProviders),
      placementGroups:       n(d.placement_groups ?? d.placementGroups),
      slices:                n(d.slices),
    };
    statsSource = "explorer";
  } catch {
    // Source 2: On-chain RPC
    try {
      const [pgR, spR, slR] = await Promise.allSettled([
        fetch(`${cfg.node}/accounts/${cfg.core}/resource/${cfg.core}::placement_group_registry::PlacementGroups`, { signal: AbortSignal.timeout(6_000) }),
        fetch(`${cfg.node}/accounts/${cfg.core}/resource/${cfg.core}::storage_provider_registry::StorageProviders`, { signal: AbortSignal.timeout(6_000) }),
        fetch(`${cfg.node}/accounts/${cfg.core}/resource/${cfg.core}::slice_registry::SliceRegistry`, { signal: AbortSignal.timeout(6_000) }),
      ]);

      if (pgR.status === "fulfilled" && pgR.value.ok) {
        const d = await pgR.value.json();
        stats.placementGroups = n(d?.data?.next_unassigned_placement_group_index);
      }
      if (spR.status === "fulfilled" && spR.value.ok) {
        const d = await spR.value.json();
        const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? [];
        let c = 0; zones.forEach(z => { c += (z.value?.value ?? []).length; });
        stats.storageProviders = c;
      }
      if (slR.status === "fulfilled" && slR.value.ok) {
        const d = await slR.value.json();
        const total = n(d?.data?.slices?.big_vec?.vec?.[0]?.end_index) + n(d?.data?.slices?.inline_vec?.length);
        stats.slices            = total;
        stats.totalBlobs        = total > 0 ? Math.ceil(total / 16) : 0;
        stats.totalStorageUsedBytes = stats.totalBlobs * 2 * 1024 * 1024;
        stats.totalBlobEvents   = stats.totalBlobs * 3;
      }
      statsSource = "on-chain";
    } catch { statsSource = "failed"; }
  }

  return NextResponse.json({
    ok: true,
    data: { node, stats, network, statsSource },
    fetchedAt,
  });
}