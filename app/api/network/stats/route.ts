// app/api/network/stats/route.ts — v3.0
// Đồng bộ thông số chính xác:
// - totalBlobs: SDK getBlobsCount({}) → GQL aggregate → binary search
// - totalStorageUsedBytes: SDK getTotalBlobsSize({}) → từ VPS (KHÔNG hardcode multiply)
// - totalBlobEvents: account_transactions_aggregate × eventsPerTxn
// - storageProviders / placementGroups / slices: on-chain resource read
// Cache 15s (live stats), stale-while-revalidate 60s

import { type NextRequest, NextResponse } from "next/server";
import { proxyToGeoSync } from "@/app/api/_proxy";

export const runtime = "edge";

const SHELBY_NODE    = "https://api.shelbynet.shelby.xyz/v1";
const SHELBY_INDEXER = "https://api.shelbynet.shelby.xyz/v1/graphql";
const CORE_ADDRESS   = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";
const BLOB_HANDLE    = "0xe41f1fa92a4beeacd0b83b7e05d150e2b260f6b7f934f62a5843f762260d5cb8";

function nb(v: any, fb = 0): number {
  const x = Number(v ?? fb);
  return isNaN(x) ? fb : x;
}

async function gql(query: string): Promise<any> {
  const r = await fetch(SHELBY_INDEXER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`GQL ${r.status}`);
  const j = JSON.parse(t);
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// Lấy node info từ fullnode
async function fetchNodeInfo() {
  const r = await fetch(`${SHELBY_NODE}/`, { signal: AbortSignal.timeout(5_000) });
  if (!r.ok) throw new Error(`Node HTTP ${r.status}`);
  const d = await r.json() as any;
  return {
    blockHeight:    nb(d.block_height),
    ledgerVersion:  nb(d.ledger_version),
    chainId:        nb(d.chain_id),
    nodeVersion:    d.node_role ?? undefined,
  };
}

// Lấy on-chain stats từ resource reads
// Không dùng explorer API (không tồn tại) — đọc trực tiếp contract state
async function fetchOnChainStats() {
  const [pgR, spR, slR] = await Promise.allSettled([
    fetch(`${SHELBY_NODE}/accounts/${CORE_ADDRESS}/resource/${CORE_ADDRESS}::placement_group_registry::PlacementGroups`,
      { signal: AbortSignal.timeout(5_000) }),
    fetch(`${SHELBY_NODE}/accounts/${CORE_ADDRESS}/resource/${CORE_ADDRESS}::storage_provider_registry::StorageProviders`,
      { signal: AbortSignal.timeout(5_000) }),
    fetch(`${SHELBY_NODE}/accounts/${CORE_ADDRESS}/resource/${CORE_ADDRESS}::slice_registry::SliceRegistry`,
      { signal: AbortSignal.timeout(5_000) }),
  ]);

  let placementGroups = 0, storageProviders = 0, slices = 0;

  if (pgR.status === "fulfilled" && pgR.value.ok) {
    const d = await pgR.value.json() as any;
    placementGroups = nb(d?.data?.next_unassigned_placement_group_index);
  }

  if (spR.status === "fulfilled" && spR.value.ok) {
    const d = await spR.value.json() as any;
    const entries: any[] = d?.data?.active_providers_by_az?.root?.children?.entries ?? [];
    entries.forEach((z: any) => {
      storageProviders += (z.value?.value ?? []).length;
    });
  }

  if (slR.status === "fulfilled" && slR.value.ok) {
    const d = await slR.value.json() as any;
    const bigVec  = nb(d?.data?.slices?.big_vec?.vec?.[0]?.end_index);
    const inline  = nb(d?.data?.slices?.inline_vec?.length);
    slices = bigVec + inline;
  }

  return { placementGroups, storageProviders, slices };
}

// Đếm blob events từ Indexer
async function fetchBlobEvents(): Promise<number> {
  const d = await gql(`{
    account_transactions_aggregate(
      where: { account_address: { _eq: "${CORE_ADDRESS}" } }
    ) { aggregate { count } }
  }`);
  const count = nb(d?.account_transactions_aggregate?.aggregate?.count);
  // Mỗi blob upload tạo 2 txns (register + acknowledge)
  return Math.round(count * 2.0);
}

// Đếm blobs từ GQL aggregate (fallback khi không có VPS)
async function fetchBlobCountGQL(): Promise<{ count: number }> {
  const d = await gql(`{
    current_table_items_aggregate(
      where: { table_handle: { _eq: "${BLOB_HANDLE}" } }
    ) { aggregate { count } }
  }`);
  return { count: nb(d?.current_table_items_aggregate?.aggregate?.count) };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? "shelbynet";

  if (network === "testnet") {
    return NextResponse.json({
      ok: true,
      data: {
        node: null,
        stats: { totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, slices: null, placementGroups: null, storageProviders: null },
        network,
        statsSource: "none",
      },
    });
  }

  // ── Fetch tất cả sources song song ────────────────────────────────────────
  const [nodeResult, onChainResult, blobEventsResult] = await Promise.allSettled([
    fetchNodeInfo(),
    fetchOnChainStats(),
    fetchBlobEvents(),
  ]);

  const node    = nodeResult.status === "fulfilled" ? nodeResult.value : null;
  const onChain = onChainResult.status === "fulfilled" ? onChainResult.value : null;
  const blobEvents = blobEventsResult.status === "fulfilled" ? blobEventsResult.value : null;

  // ── Get accurate blob count + storage size từ VPS (có SDK) ───────────────
  // VPS đọc SDK on-chain → chính xác nhất cho totalBlobs + totalStorageUsedBytes
  // Dùng /stats/live (no-cache, real-time) thay vì /stats (cached)
  let totalBlobs: number | null = null;
  let totalStorageUsedBytes: number | null = null;
  let statsSource = "unknown";

  // Try VPS first (SDK on-chain, most accurate)
  try {
    const vpsRes = await fetch(
      `${(globalThis as any).__VPS_API_URL ?? process.env.SHELBY_API_URL ?? "http://localhost:3000"}/api/geo-sync/stats/live?network=${network}`,
      { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } }
    );
    if (vpsRes.ok) {
      const vpsData = await vpsRes.json() as any;
      if (vpsData.data?.stats) {
        const s = vpsData.data.stats;
        if (nb(s.totalBlobs) > 0)            totalBlobs             = nb(s.totalBlobs);
        if (nb(s.totalStorageUsedBytes) > 0) totalStorageUsedBytes  = nb(s.totalStorageUsedBytes);
        statsSource = s.statsMethod ?? "vps-sdk";
      }
    }
  } catch { /* VPS unavailable */ }

  // Fallback: GQL aggregate count
  if (totalBlobs === null) {
    try {
      const { count } = await fetchBlobCountGQL();
      if (count > 0) {
        totalBlobs  = count;
        statsSource = "gql-aggregate";
        // totalStorageUsedBytes: không thể tính chính xác không có SDK
        // Để null là tốt hơn là hiển thị số sai
      }
    } catch { /* GQL failed */ }
  }

  return NextResponse.json({
    ok: true,
    data: {
      node,
      stats: {
        totalBlobs,
        totalStorageUsedBytes,
        totalBlobEvents:  blobEvents,
        storageProviders: onChain?.storageProviders ?? null,
        placementGroups:  onChain?.placementGroups  ?? null,
        slices:           onChain?.slices           ?? null,
      },
      network,
      statsSource,
    },
    fetchedAt: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
    },
  });
}