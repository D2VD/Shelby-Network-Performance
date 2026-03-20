// app/api/network/stats/route.ts — v4
// FIX: Testnet dùng Network.TESTNET (không phải SHELBYNET)
// FIX: getTotalBlobsSize() trả bytes — không cần nhân thêm
// FIX: Testnet providers/PGs lấy từ đúng contract address

import { NextRequest, NextResponse } from "next/server";

// Node.js runtime — SDK + WASM
// export const runtime = "edge"; // BỎ

export const revalidate = 15;

// Config per network
const CONFIGS = {
  shelbynet: {
    sdkNetwork:  "shelbynet" as const,   // dùng string, SDK sẽ resolve
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    core:        "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    useTestnet:  false,
  },
  testnet: {
    sdkNetwork:  "testnet" as const,
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    core:        "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    useTestnet:  true,
  },
} as const;

type NetworkKey = keyof typeof CONFIGS;

const n = (v: any, fb = 0): number => {
  const x = Number(v ?? fb);
  return isNaN(x) ? fb : x;
};

export async function GET(req: NextRequest) {
  const networkParam = (new URL(req.url).searchParams.get("network") ?? "shelbynet") as NetworkKey;
  const cfg          = CONFIGS[networkParam] ?? CONFIGS.shelbynet;
  const fetchedAt    = new Date().toISOString();

  // ── Node info ─────────────────────────────────────────────────────────────
  let node: any = null;
  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const d = await r.json();
      node = {
        blockHeight:   n(d.block_height),
        ledgerVersion: n(d.ledger_version),
        chainId:       n(d.chain_id),
      };
    }
  } catch {}

  // ── Stats via SDK ─────────────────────────────────────────────────────────
  const stats: Record<string, number | null> = {
    totalBlobs:            null,
    totalStorageUsedBytes: null,
    totalBlobEvents:       null,
    storageProviders:      null,
    placementGroups:       null,
    slices:                null,
  };
  let statsSource = "none";

  try {
    const { ShelbyNodeClient } = await import("@shelby-protocol/sdk/node");
    const { Network }          = await import("@aptos-labs/ts-sdk");

    // FIX: Chọn đúng network enum cho từng mạng
    const shelbyNetwork = cfg.useTestnet
      ? Network.TESTNET
      : (Network as any).SHELBYNET ?? ("shelbynet" as any);

    const client = new ShelbyNodeClient({
      network: shelbyNetwork,
      ...(process.env.SHELBY_API_KEY ? { apiKey: process.env.SHELBY_API_KEY } : {}),
    });

    // Gọi song song — truyền {} vì SDK strict require params object
    const [blobCount, totalSize, actCount] = await Promise.allSettled([
      client.coordination.getBlobsCount({}),
      client.coordination.getTotalBlobsSize({}),
      client.coordination.getBlobActivitiesCount({}),
    ]);

    if (blobCount.status === "fulfilled") {
      stats.totalBlobs = n(blobCount.value);
    }
    if (totalSize.status === "fulfilled") {
      // SDK trả bytes thực — không cần convert thêm
      stats.totalStorageUsedBytes = n(totalSize.value);
    }
    if (actCount.status === "fulfilled") {
      stats.totalBlobEvents = n(actCount.value);
    }

    statsSource = "sdk";
    console.log(`[stats/${networkParam}] SDK ok: blobs=${stats.totalBlobs}, size=${stats.totalStorageUsedBytes}, events=${stats.totalBlobEvents}`);

  } catch (sdkErr: any) {
    console.warn(`[stats/${networkParam}] SDK error:`, sdkErr?.message?.slice(0, 150));
    // Fallback on-chain nếu SDK fail
    try {
      const slR = await fetch(
        `${cfg.nodeUrl}/accounts/${cfg.core}/resource/${cfg.core}::slice_registry::SliceRegistry`,
        { signal: AbortSignal.timeout(6_000) }
      );
      if (slR.ok) {
        const d = await slR.json();
        const bigVec = n(d?.data?.slices?.big_vec?.vec?.[0]?.end_index);
        const inline = n(d?.data?.slices?.inline_vec?.length);
        stats.slices     = bigVec + inline;
        stats.totalBlobs = stats.slices > 0 ? Math.ceil(stats.slices / 16) : 0;
      }
      statsSource = "on-chain-rpc";
    } catch { statsSource = "failed"; }
  }

  // ── Placement Groups + Storage Providers (on-chain, cả 2 mạng) ───────────
  try {
    const [pgR, spR] = await Promise.allSettled([
      fetch(
        `${cfg.nodeUrl}/accounts/${cfg.core}/resource/${cfg.core}::placement_group_registry::PlacementGroups`,
        { signal: AbortSignal.timeout(5_000) }
      ),
      fetch(
        `${cfg.nodeUrl}/accounts/${cfg.core}/resource/${cfg.core}::storage_provider_registry::StorageProviders`,
        { signal: AbortSignal.timeout(5_000) }
      ),
    ]);

    if (pgR.status === "fulfilled" && pgR.value.ok) {
      const d = await pgR.value.json();
      stats.placementGroups = n(d?.data?.next_unassigned_placement_group_index);
    }
    if (spR.status === "fulfilled" && spR.value.ok) {
      const d = await spR.value.json();
      const zones: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? [];
      let c = 0;
      zones.forEach(z => { c += (z.value?.value ?? []).length; });
      stats.storageProviders = c;
    }
  } catch { /* non-fatal */ }

  // ── Slices (nếu chưa có) ──────────────────────────────────────────────────
  if (stats.slices === null) {
    try {
      const slR = await fetch(
        `${cfg.nodeUrl}/accounts/${cfg.core}/resource/${cfg.core}::slice_registry::SliceRegistry`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (slR.ok) {
        const d = await slR.json();
        stats.slices = n(d?.data?.slices?.big_vec?.vec?.[0]?.end_index)
                     + n(d?.data?.slices?.inline_vec?.length);
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    ok: true,
    data: { node, stats, network: networkParam, statsSource },
    fetchedAt,
  });
}