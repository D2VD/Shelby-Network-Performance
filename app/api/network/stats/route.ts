// app/api/network/stats/route.ts — v9 (VPS edition)
//
// Kiến trúc mới: proxy sang VPS /api/geo-sync/stats thay vì CF Worker.
// Fallback trực tiếp từ Shelby node + on-chain RPC nếu VPS không response.

import { NextRequest, NextResponse } from "next/server";
import { VPS_API_URL } from "@/app/api/_proxy";

export const runtime    = "edge";
export const revalidate = 15;

const CONFIGS = {
  shelbynet: {
    nodeUrl: "https://api.shelbynet.shelby.xyz/v1",
    core:    "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
  },
  testnet: {
    nodeUrl: "https://api.testnet.aptoslabs.com/v1",
    core:    "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
  },
} as const;

type NetKey = keyof typeof CONFIGS;
const n = (v: any, fb = 0): number => { const x = Number(v ?? fb); return isNaN(x) ? fb : x; };

export async function GET(req: NextRequest) {
  const networkParam = (new URL(req.url).searchParams.get("network") ?? "shelbynet") as NetKey;
  const cfg          = CONFIGS[networkParam] ?? CONFIGS.shelbynet;
  const fetchedAt    = new Date().toISOString();
  const errors: string[] = [];

  // ── Node info (trực tiếp, không qua VPS) ─────────────────────────────────
  let node: any = null;
  try {
    const r = await fetch(`${cfg.nodeUrl}/`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const d = await r.json() as any;
      node = { blockHeight: n(d.block_height), ledgerVersion: n(d.ledger_version), chainId: n(d.chain_id) };
    }
  } catch (e: any) { errors.push(`node: ${e.message}`); }

  // ── Priority 1: VPS /api/geo-sync/stats (Redis cache, hourly updated) ────
  try {
    const vpsRes = await fetch(
      `${VPS_API_URL}/api/geo-sync/stats?network=${networkParam}`,
      { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } }
    );
    if (vpsRes.ok) {
      const data = await vpsRes.json() as any;
      const s    = data?.data?.stats;
      const hasData = s && (
        (s.totalBlobs != null && s.totalBlobs > 0) ||
        (s.storageProviders != null && s.storageProviders > 0)
      );
      if (hasData) {
        if (node && data.data) data.data.node = node; // inject fresh node info
        return NextResponse.json(
          { ...data, fetchedAt },
          { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } }
        );
      }
      errors.push(`vps: responded but no data`);
    } else {
      errors.push(`vps: HTTP ${vpsRes.status}`);
    }
  } catch (e: any) {
    errors.push(`vps: ${e.message}`);
  }

  // ── Priority 2: On-chain RPC fallback (trực tiếp, không cần VPS) ─────────
  const stats: Record<string, number | null> = {
    totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null,
    storageProviders: null, placementGroups: null, slices: null,
  };
  let statsSource = "none";

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
      stats.slices = n(d?.data?.slices?.big_vec?.vec?.[0]?.end_index) + n(d?.data?.slices?.inline_vec?.length);
    }
    statsSource = "on-chain-rpc-fallback";
  } catch (e: any) {
    errors.push(`rpc: ${e.message}`);
    statsSource = "failed";
  }

  return NextResponse.json(
    { ok: true, data: { node, stats, network: networkParam, statsSource, _errors: errors }, fetchedAt },
    { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } }
  );
}