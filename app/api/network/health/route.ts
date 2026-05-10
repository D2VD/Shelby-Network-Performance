// app/api/network/health/route.ts — v1.0
// Network Health Index (NHI) — Week 2 B2
//
// NHI = 0–100 score computed from:
//   SP Quorum (30%)      — active SPs vs min required (12)
//   Blob Availability (25%) — active_blobs > 0 and growing
//   Epoch Health (25%)   — current epoch not stalled
//   Storage Util (20%)   — storage bytes > 0
//
// Sources:
//   Shelbynet: /api/geo-sync/health (VPS) — computed from cached stats
//   Testnet: direct Aptos node REST + indexer V3

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

const CORE    = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";
const TESTNET = "https://api.testnet.aptoslabs.com/v1";

// ── NHI computation (direct fallback when VPS unavailable) ────────────────────
async function computeNHIFromNode(network: string): Promise<{
  nhi: number;
  components: Record<string, number>;
  status: "healthy" | "degraded" | "critical";
  detail: string;
}> {
  const node = network === "testnet" ? TESTNET : "https://api.shelbynet.shelby.xyz/v1";

  try {
    // Fetch StorageProviders registry
    const [nodeRes, spRes] = await Promise.allSettled([
      fetch(`${node}/`, { signal: AbortSignal.timeout(5_000) }).then(r => r.ok ? r.json() : null),
      fetch(`${node}/accounts/${CORE}/resource/${CORE}::storage_provider_registry::StorageProviders`, {
        signal: AbortSignal.timeout(6_000),
      }).then(r => r.ok ? r.json() : null),
    ]);

    const nodeData = nodeRes.status === "fulfilled" ? nodeRes.value as Record<string, unknown> | null : null;
    const spData   = spRes.status  === "fulfilled" ? spRes.value  as Record<string, unknown> | null : null;

    // Count active SPs from BPlusTreeMap entries
    let activeSpCount = 0;
    if (spData) {
      const data = (spData.data ?? spData) as Record<string, unknown>;
      const activeProviders = data.active_providers as Record<string, unknown> | undefined;
      const root = (activeProviders?.root ?? {}) as Record<string, unknown>;
      const children = (root.children ?? {}) as Record<string, unknown>;
      const entries = (children.entries ?? []) as unknown[];
      activeSpCount = entries.length; // each entry = 1 SP in active_providers (flat map)

      // If entries is by AZ, sum up SPs per AZ
      // Check if first entry has a value with array (by_az structure)
      if (entries.length > 0) {
        const first = entries[0] as Record<string, unknown>;
        const val = first.value as Record<string, unknown> | undefined;
        const innerVal = val?.value;
        
        if (Array.isArray(innerVal)) {
          // Sửa lỗi: Chỉ định kiểu 'number' cho accumulator 'sum'
          activeSpCount = entries.reduce((sum: number, e): number => {
            const ent = e as Record<string, unknown>;
            const v = ent.value as Record<string, unknown> | undefined;
            const arr = v?.value;
            
            const currentCount = Array.isArray(arr) ? arr.length : 0;
            return sum + currentCount;
          }, 0);
        }
      }
    }

    const blockHeight = nodeData ? Number((nodeData as Record<string, unknown>).block_height ?? 0) : 0;

    // ── Score components ──────────────────────────────────────────────────────
    const MIN_SPS_FOR_QUORUM = 12;
    const IDEAL_SPS          = 30;

    // SP Quorum (30%) — linear from 0 at 0 SPs to 100 at IDEAL_SPS
    const spQuorumScore = Math.min(100, (activeSpCount / IDEAL_SPS) * 100);
    // Extra penalty if below minimum quorum
    const quorumPenalty = activeSpCount < MIN_SPS_FOR_QUORUM ? 50 : 0;

    // Node availability (replaces blob availability when no indexer)
    const nodeScore = blockHeight > 0 ? 100 : 0;

    // Epoch health: block height > 0 = chain advancing
    const epochScore = blockHeight > 0 ? 100 : 0;

    // Storage utilization: can't compute without indexer, default 70 (optimistic)
    const storageScore = 70;

    const rawNHI =
      (spQuorumScore - quorumPenalty) * 0.30 +
      nodeScore      * 0.25 +
      epochScore     * 0.25 +
      storageScore   * 0.20;

    const nhi = Math.round(Math.max(0, Math.min(100, rawNHI)));
    const status: "healthy" | "degraded" | "critical" =
      nhi >= 80 ? "healthy" : nhi >= 60 ? "degraded" : "critical";

    return {
      nhi,
      components: {
        spQuorum: Math.round(spQuorumScore - quorumPenalty),
        nodeAvailability: nodeScore,
        epochHealth: epochScore,
        storageUtilization: storageScore,
      },
      status,
      detail: `${activeSpCount} active SPs · block #${blockHeight.toLocaleString("en-US")}`,
    };
  } catch (e: unknown) {
    return {
      nhi: 0,
      components: { spQuorum: 0, nodeAvailability: 0, epochHealth: 0, storageUtilization: 0 },
      status: "critical",
      detail: (e as Error).message,
    };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";

  // Try VPS first (has full indexer data for Shelbynet)
  if (VPS_URLS.length > 0) {
    let lastError = "";
    for (const vpsUrl of VPS_URLS) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 8_000);
        const r = await fetch(`${vpsUrl}/api/geo-sync/health?network=${network}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(tid);
        if (r.ok) {
          const body = await r.text();
          return new NextResponse(body, {
            status: r.status,
            headers: {
              "Content-Type":  "application/json",
              "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
            },
          });
        }
      } catch (e: unknown) {
        lastError = (e as Error).message;
      }
    }
    console.warn(`[health] VPS attempts failed: ${lastError} — falling back to direct compute`);
  }

  // Fallback: compute directly from Aptos node
  const result = await computeNHIFromNode(network);
  return NextResponse.json(
    { ok: true, network, ...result, source: "direct-node", updatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } }
  );
}