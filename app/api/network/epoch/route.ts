// app/api/network/epoch/route.ts — v1.0
// Fetches epoch data directly from Aptos Node REST API (no VPS hop).
// Supports both Shelbynet and Testnet.
// Security: input validated, internal errors never exposed to client.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const CORE = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

const NODE_URLS: Record<string, string> = {
  shelbynet: "https://api.shelbynet.shelby.xyz/v1",
  testnet:   "https://api.testnet.aptoslabs.com/v1",
};

// Epoch durations in microseconds — on-chain defaults from ShelbyConfig
const DEFAULT_DURATIONS = {
  audit:   3_600_000_000n,    // 1 hour
  payment: 86_400_000_000n,   // 24 hours
  staking: 604_800_000_000n,  // 7 days
};

// Input validation — only allow known values (security: prevent SSRF via network param)
function validateNetwork(raw: string | null): string | null {
  if (!raw) return "shelbynet";
  const clean = raw.toLowerCase().trim();
  return ["shelbynet", "testnet"].includes(clean) ? clean : null;
}

// Extract the latest (highest-key) entry from a SortedVectorMap entries array
function latestEntry(entries: Array<{ key: string; value: string }>): bigint {
  if (!Array.isArray(entries) || entries.length === 0) return 0n;
  return BigInt(entries[entries.length - 1].value ?? "0");
}

function computeCountdown(startMicros: bigint, durationMicros: bigint, nowMs: number) {
  if (startMicros === 0n || durationMicros === 0n) {
    return { remaining_ms: 0, elapsed_ms: 0, pct_complete: 0, next_epoch_at_ms: 0 };
  }
  const nowMicros     = BigInt(nowMs) * 1000n;
  const elapsed       = (nowMicros - startMicros) % durationMicros;
  const remaining     = durationMicros - elapsed;
  const elapsed_ms    = Number(elapsed   / 1000n);
  const remaining_ms  = Number(remaining / 1000n);
  const duration_ms   = Number(durationMicros / 1000n);
  const pct_complete  = Math.min(100, (elapsed_ms / duration_ms) * 100);
  return {
    remaining_ms,
    elapsed_ms,
    pct_complete: Math.round(pct_complete * 10) / 10,
    next_epoch_at_ms: nowMs + remaining_ms,
  };
}

function buildHistory(
  entries: Array<{ key: string; value: string }>,
  durationMicros: bigint,
  limit = 10
) {
  return [...entries]
    .slice(-limit)
    .reverse()
    .map(e => {
      const startMs = Number(BigInt(e.value) / 1000n);
      const endMs   = Number((BigInt(e.value) + durationMicros) / 1000n);
      return { epoch: Number(e.key), started_at: startMs, ended_at: endMs };
    });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const network = validateNetwork(req.nextUrl.searchParams.get("network"));
  if (!network) {
    return NextResponse.json(
      { ok: false, error: "Invalid network. Must be 'shelbynet' or 'testnet'." },
      { status: 400 }
    );
  }

  const nodeUrl = NODE_URLS[network];
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (network === "shelbynet" && process.env.SHELBY_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.SHELBY_API_KEY}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    // Fetch Epoch resource and ShelbyConfig in parallel
    const [epochRes, configRes] = await Promise.allSettled([
      fetch(`${nodeUrl}/accounts/${CORE}/resource/${CORE}::epoch::Epoch`,
        { headers, signal: controller.signal }),
      fetch(`${nodeUrl}/accounts/${CORE}/resource/${CORE}::config::ShelbyConfig`,
        { headers, signal: controller.signal }),
    ]);

    clearTimeout(timer);

    // Parse Epoch data
    type EpochEntries = Array<{ key: string; value: string }>;
    interface EpochResource {
      current_audit_epoch:   string;
      current_payment_epoch: string;
      current_staking_epoch: string;
      audit_epoch_start_times:   { entries: EpochEntries };
      payment_epoch_start_times: { entries: EpochEntries };
      staking_epoch_start_times: { entries: EpochEntries };
    }
    interface ShelbyConfig {
      audit_epoch_duration:   string;
      payment_epoch_duration: string;
      staking_epoch_duration: string;
      min_active_storage_providers_for_active_pg: string;
      max_placement_groups: string;
      num_slots_per_pg:     string;
    }

    let epochData: EpochResource | null = null;
    let configData: ShelbyConfig | null = null;

    if (epochRes.status === "fulfilled" && epochRes.value.ok) {
      const j = await epochRes.value.json() as { data?: EpochResource };
      epochData = j.data ?? null;
    }
    if (configRes.status === "fulfilled" && configRes.value.ok) {
      const j = await configRes.value.json() as { data?: ShelbyConfig };
      configData = j.data ?? null;
    }

    if (!epochData) {
      return NextResponse.json(
        { ok: true, network, data: null, warning: "Epoch resource unavailable — node may be syncing" },
        { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } }
      );
    }

    const durations = {
      audit:   BigInt(configData?.audit_epoch_duration   ?? String(DEFAULT_DURATIONS.audit)),
      payment: BigInt(configData?.payment_epoch_duration ?? String(DEFAULT_DURATIONS.payment)),
      staking: BigInt(configData?.staking_epoch_duration ?? String(DEFAULT_DURATIONS.staking)),
    };

    const auditStart   = latestEntry(epochData.audit_epoch_start_times?.entries   ?? []);
    const paymentStart = latestEntry(epochData.payment_epoch_start_times?.entries ?? []);
    const stakingStart = latestEntry(epochData.staking_epoch_start_times?.entries ?? []);
    const nowMs        = Date.now();

    return NextResponse.json(
      {
        ok: true,
        network,
        fetched_at: new Date(nowMs).toISOString(),
        data: {
          current_audit_epoch:   Number(epochData.current_audit_epoch),
          current_payment_epoch: Number(epochData.current_payment_epoch),
          current_staking_epoch: Number(epochData.current_staking_epoch),
          audit: {
            duration_ms: Number(durations.audit   / 1000n),
            countdown:   computeCountdown(auditStart,   durations.audit,   nowMs),
            history:     buildHistory(epochData.audit_epoch_start_times?.entries   ?? [], durations.audit),
          },
          payment: {
            duration_ms: Number(durations.payment / 1000n),
            countdown:   computeCountdown(paymentStart, durations.payment, nowMs),
            history:     buildHistory(epochData.payment_epoch_start_times?.entries ?? [], durations.payment),
          },
          staking: {
            duration_ms: Number(durations.staking / 1000n),
            countdown:   computeCountdown(stakingStart, durations.staking, nowMs),
            history:     buildHistory(epochData.staking_epoch_start_times?.entries ?? [], durations.staking, 5),
          },
          config: configData ? {
            min_sps_for_active_pg: Number(configData.min_active_storage_providers_for_active_pg),
            max_placement_groups:  Number(configData.max_placement_groups),
            num_slots_per_pg:      Number(configData.num_slots_per_pg),
          } : null,
        },
      },
      { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } }
    );
  } catch (err: unknown) {
    // Security: never expose internal error details to client
    const isTimeout = err instanceof Error &&
      (err.message.includes("abort") || err.message.includes("timeout"));
    console.error(`[epoch/${network}]`, err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { ok: false, error: isTimeout ? "Request timed out" : "Failed to fetch epoch data" },
      { status: 503 }
    );
  }
}