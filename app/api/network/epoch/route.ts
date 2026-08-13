// app/api/network/epoch/route.ts — v1.1
// Fetches epoch data directly from Aptos Node REST API (no VPS hop).
// Supports both Shelbynet and Testnet.
// Security: input validated, internal errors never exposed to client.
//
// CHANGES v1.1 (post shelbynet wipe schema change, confirmed live 2026-08):
//   - Resource `config::ShelbyConfig` renamed on-chain to
//     `config::ShelbyProtocolConfig`. Field names inside it (audit/payment/
//     staking_epoch_duration) are UNCHANGED — only the resource type name
//     moved. Confirmed via direct fetch: durations still read
//     3_600_000_000 / 86_400_000_000 / 604_800_000_000 microseconds
//     (1h/24h/7d), matching DEFAULT_DURATIONS exactly.
//   - epoch::Epoch resource no longer exposes *_epoch_start_times as
//     SortedVectorMap `{entries: [...]}` history structures. Replaced with
//     flat scalar fields:
//       current_audit_epoch_start_time    (direct, like before but singular)
//       current_staking_epoch_start_time  (direct, same)
//       payment_epoch_genesis_start       (NEW — epoch 0's start only;
//         there is no current_payment_epoch_start_time field at all)
//     Payment epoch's current start is therefore now COMPUTED:
//       genesis + (current_payment_epoch * payment_epoch_duration)
//     Verified independently: for live data (genesis=1785369688863243,
//     current_payment_epoch=14, duration=86400000000), this computation
//     produces 1786579288863243 — which exactly matches the live
//     current_staking_epoch_start_time (14 payment days == 2 staking
//     weeks, so the two boundaries coincide). That match is a strong
//     correctness signal for the formula, not a coincidence to be
//     suspicious of.
//   - buildHistory() is REMOVED. The on-chain source data it depended on
//     (per-epoch history entries) no longer exists in this resource at
//     all — not renamed, genuinely gone. `history` is now always returned
//     as an empty array. The frontend's existing `data.history.length > 0`
//     guard (EpochPanel-style components) already handles an empty array
//     gracefully — no frontend change required for this specifically, the
//     "History" section will just not render, which is honest given we
//     have no real history data anymore. If historical epoch timelines are
//     wanted again later, they'd need to come from a different source
//     (e.g. reconstructing from TimescaleDB epoch_snapshots, which this
//     project already has a schema for) — not from this Node REST
//     resource, since the data isn't there anymore.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const CORE = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

const NODE_URLS: Record<string, string> = {
  shelbynet: "https://api.shelbynet.shelby.xyz/v1",
  testnet:   "https://api.testnet.aptoslabs.com/v1",
};

// Epoch durations in microseconds — on-chain defaults from ShelbyProtocolConfig.
// Confirmed live 2026-08: values unchanged from pre-wipe (1h/24h/7d), only
// the resource type name changed. Kept as fallback in case the config
// resource is ever briefly unavailable (e.g. node syncing).
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

    // Fetch Epoch resource and ShelbyProtocolConfig (renamed from
    // ShelbyConfig, see header comment) in parallel.
    const [epochRes, configRes] = await Promise.allSettled([
      fetch(`${nodeUrl}/accounts/${CORE}/resource/${CORE}::epoch::Epoch`,
        { headers, signal: controller.signal }),
      fetch(`${nodeUrl}/accounts/${CORE}/resource/${CORE}::config::ShelbyProtocolConfig`,
        { headers, signal: controller.signal }),
    ]);

    clearTimeout(timer);

    // Parse Epoch data — flat scalar fields, confirmed live 2026-08.
    // NOTE: no *_epoch_start_times history maps anymore, and no direct
    // current_payment_epoch_start_time field — see header comment.
    interface EpochResource {
      current_audit_epoch:            string;
      current_audit_epoch_start_time: string;
      current_payment_epoch:          string;
      current_staking_epoch:          string;
      current_staking_epoch_start_time: string;
      payment_epoch_genesis_start:    string;
    }
    interface ShelbyProtocolConfig {
      audit_epoch_duration:   string;
      payment_epoch_duration: string;
      staking_epoch_duration: string;
      // staking: { max_stake: string; min_stake: string } — present on-chain,
      // not needed by this route, intentionally not typed/used here.
    }

    let epochData: EpochResource | null = null;
    let configData: ShelbyProtocolConfig | null = null;

    if (epochRes.status === "fulfilled" && epochRes.value.ok) {
      const j = await epochRes.value.json() as { data?: EpochResource };
      epochData = j.data ?? null;
    }
    if (configRes.status === "fulfilled" && configRes.value.ok) {
      const j = await configRes.value.json() as { data?: ShelbyProtocolConfig };
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

    const nowMs = Date.now();

    // Audit and staking still expose their current epoch's start directly.
    const auditStart   = BigInt(epochData.current_audit_epoch_start_time   ?? "0");
    const stakingStart = BigInt(epochData.current_staking_epoch_start_time ?? "0");

    // Payment no longer has a direct current-start field — compute it from
    // genesis + (current epoch number * duration). See header comment for
    // the verified sanity check on this formula against live data.
    const paymentGenesis    = BigInt(epochData.payment_epoch_genesis_start ?? "0");
    const currentPaymentNum = BigInt(epochData.current_payment_epoch ?? "0");
    const paymentStart      = paymentGenesis > 0n
      ? paymentGenesis + currentPaymentNum * durations.payment
      : 0n; // no genesis available — computeCountdown's zero-guard handles this safely

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
            // History timeline data no longer exists in this on-chain
            // resource — see header comment. Always empty until/unless a
            // different data source (e.g. TimescaleDB epoch_snapshots) is
            // wired in to replace this.
            history:     [] as Array<{ epoch: number; started_at: number; ended_at: number }>,
          },
          payment: {
            duration_ms: Number(durations.payment / 1000n),
            countdown:   computeCountdown(paymentStart, durations.payment, nowMs),
            history:     [] as Array<{ epoch: number; started_at: number; ended_at: number }>,
          },
          staking: {
            duration_ms: Number(durations.staking / 1000n),
            countdown:   computeCountdown(stakingStart, durations.staking, nowMs),
            history:     [] as Array<{ epoch: number; started_at: number; ended_at: number }>,
          },
          config: configData ? {
            // min_active_storage_providers_for_active_pg / max_placement_groups /
            // num_slots_per_pg were on the OLD ShelbyConfig resource and were
            // not observed on the new ShelbyProtocolConfig resource in the
            // live fetch this session (only audit/payment/staking durations
            // and a nested `staking: {max_stake, min_stake}` were present).
            // Returning null here rather than guessing these moved somewhere
            // else — if the frontend actually renders these values anywhere,
            // that display will need its own follow-up investigation to find
            // where these three fields now live (if they still exist at all).
            min_sps_for_active_pg: null,
            max_placement_groups:  null,
            num_slots_per_pg:      null,
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