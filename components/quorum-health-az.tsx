"use client";
/**
 * components/quorum-health-az.tsx — v1.0
 *
 * Per-AZ Quorum Health Indicator (UPGRADE_ROADMAP.md — A3)
 *
 * Distinct from the existing NHI-derived QuorumHealthBar in app/network/page.tsx,
 * which shows a single aggregate 0-100 "Quorum" score. This component answers a
 * different question per AZ: "does this specific availability zone have enough
 * Active storage providers to keep placement groups healthy?"
 *
 * Threshold source: on-chain contract constant
 *   min_active_storage_providers_for_active_pg = 12
 * Status bands (per UPGRADE_ROADMAP.md A3 spec), computed from on-chain `state`:
 *   🔴 Below quorum  — activeCount < 12
 *   🟡 Warning       — 12 <= activeCount <= 14
 *   🟢 Quorum OK     — activeCount > 14
 *
 * `state` (on-chain) and `health` (off-chain derived: condition + TCP/IP checks)
 * are tracked separately and both surfaced — confirmed via live curl that an SP
 * can be state:"Active" with health:"Faulty" simultaneously. The big number/band
 * is state-based (matches the protocol's own quorum semantics exactly); the
 * subtext shows how many of those state-Active SPs are also health:"Healthy",
 * so a degraded-but-still-registered AZ is visible without silently discarding
 * either signal.
 *
 * Data source: GET /api/network/providers?network=... (existing route,
 * proxies to VPS /api/geo-sync/providers). Response envelope shape is NOT
 * fully confirmed from source in this session, so extraction is defensive —
 * it tries the known { ok, data: { providers, count } } shape first, then
 * falls back to a couple of plausible alternates, and surfaces a visible
 * error rather than silently rendering an empty/misleading state.
 *
 * NOT included: per-PG status (Active/At-risk/Inactive). SpInfo (shared-types.ts
 * v1.2) carries no placement-group/slot data — that only exists in the raw
 * on-chain `designated_placement_groups` field, which the backend geo-sync
 * pipeline currently drops before building SpInfo. Needs a backend change
 * (expose designated_placement_groups per SP, or a dedicated PG summary
 * endpoint) before per-PG status can be built without guessing.
 */

import { useEffect, useRef, useState } from "react";

const MIN_ACTIVE_SPS_FOR_QUORUM = 12; // on-chain: min_active_storage_providers_for_active_pg
const WARNING_CEILING = 14;           // <=14 active SPs => Warning band

type SpState  = "Active" | "Waitlisted" | "Frozen" | "Leaving";
type SpHealth = "Healthy" | "Faulty" | "Unhealthy" | "Unknown";

interface RawSpInfo {
  address?: unknown;
  availabilityZone?: unknown;
  locationName?: unknown;
  state?: unknown;
  health?: unknown;
}

interface AZGroup {
  az: string;
  locationName: string;
  activeCount: number;
  activeHealthyCount: number; // subset of activeCount where health === "Healthy"
  waitlistedCount: number;
  frozenCount: number;
  leavingCount: number;
}

type QuorumBand = "ok" | "warning" | "below";

function num(v: unknown, fb = 0): number {
  const n = Number(v ?? fb);
  return isFinite(n) ? n : fb;
}

function str(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v || "—";
  if (typeof v === "number") return isFinite(v) ? String(v) : "—";
  return "—";
}

function isSpState(v: unknown): v is SpState {
  return v === "Active" || v === "Waitlisted" || v === "Frozen" || v === "Leaving";
}

function isSpHealth(v: unknown): v is SpHealth {
  return v === "Healthy" || v === "Faulty" || v === "Unhealthy" || v === "Unknown";
}

function isRawSpInfo(v: unknown): v is RawSpInfo {
  return !!v && typeof v === "object";
}

/**
 * Defensive extraction: tries the documented route.ts envelope first
 * ({ ok, data: { providers, count } }), then falls back to a couple of
 * plausible alternates. Returns null (not []) if nothing matches, so the
 * caller can distinguish "zero providers" from "unexpected response shape".
 */
function extractProviders(json: unknown): RawSpInfo[] | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;

  const fromData = j.data as Record<string, unknown> | undefined;
  if (fromData && Array.isArray(fromData.providers)) {
    return (fromData.providers as unknown[]).filter(isRawSpInfo);
  }
  if (Array.isArray(j.providers)) {
    return (j.providers as unknown[]).filter(isRawSpInfo);
  }
  if (Array.isArray(j.data)) {
    return (j.data as unknown[]).filter(isRawSpInfo);
  }
  return null;
}

function bandFor(activeCount: number): QuorumBand {
  if (activeCount < MIN_ACTIVE_SPS_FOR_QUORUM) return "below";
  if (activeCount <= WARNING_CEILING) return "warning";
  return "ok";
}

const BAND_META: Record<QuorumBand, { color: string; icon: string; label: string }> = {
  ok:      { color: "#22c55e", icon: "🟢", label: "Quorum OK" },
  warning: { color: "#f59e0b", icon: "🟡", label: "Warning" },
  below:   { color: "#ef4444", icon: "🔴", label: "Below Quorum" },
};

export function QuorumHealthByAZ({ network }: { network: string }) {
  const [groups,  setGroups]  = useState<AZGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!alive.current) return;
    setGroups(null);
    setError(null);
    setLoading(true);

    fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(20_000) })
      .then(async (r) => {
        const json = (await r.json()) as unknown;
        if (!alive.current) return;

        const providers = extractProviders(json);
        if (providers === null) {
          setError("Unexpected /api/network/providers response shape — cannot compute per-AZ quorum.");
          setLoading(false);
          return;
        }

        const byAz = new Map<string, AZGroup>();
        for (const sp of providers) {
          const az = str(sp.availabilityZone) === "—" ? "Unknown AZ" : String(sp.availabilityZone);
          const locationName = str(sp.locationName) === "—" ? az : String(sp.locationName);
          const state  = isSpState(sp.state)   ? sp.state   : "Active";  // fail-open to Active only if state truly absent
          const health = isSpHealth(sp.health) ? sp.health  : "Unknown"; // fail-open to Unknown, never assumed Healthy

          if (!byAz.has(az)) {
            byAz.set(az, { az, locationName, activeCount: 0, activeHealthyCount: 0, waitlistedCount: 0, frozenCount: 0, leavingCount: 0 });
          }
          const g = byAz.get(az)!;
          if (state === "Active") {
            g.activeCount++;
            if (health === "Healthy") g.activeHealthyCount++;
          }
          if (state === "Waitlisted") g.waitlistedCount++;
          if (state === "Frozen")     g.frozenCount++;
          if (state === "Leaving")    g.leavingCount++;
        }

        const sorted = Array.from(byAz.values()).sort((a, b) => a.activeCount - b.activeCount);
        if (alive.current) { setGroups(sorted); setLoading(false); }
      })
      .catch((e: unknown) => {
        if (alive.current) {
          setError(e instanceof Error ? e.message : "Failed to load provider data.");
          setLoading(false);
        }
      });
  }, [network]);

  if (loading) {
    return (
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 22px", marginBottom: 18, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading per-AZ quorum status…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 14, padding: "18px 22px", marginBottom: 18, color: "#ef4444", fontSize: 13 }}>
        ⚠ {error}
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 22px", marginBottom: 18, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
        No availability zones reported.
      </div>
    );
  }

  const belowCount   = groups.filter((g) => bandFor(g.activeCount) === "below").length;
  const warningCount = groups.filter((g) => bandFor(g.activeCount) === "warning").length;
  const okCount       = groups.length - belowCount - warningCount;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
          Quorum Health by AZ
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>
          Threshold: {MIN_ACTIVE_SPS_FOR_QUORUM} active SPs/PG ·{" "}
          <span style={{ color: "#22c55e" }}>{okCount} OK</span> ·{" "}
          <span style={{ color: "#f59e0b" }}>{warningCount} Warning</span> ·{" "}
          <span style={{ color: "#ef4444" }}>{belowCount} Below</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {groups.map((g) => {
          const band = bandFor(g.activeCount);
          const meta = BAND_META[band];
          // Visual fill relative to the warning ceiling, capped at 100%.
          const fillPct = Math.min(100, (g.activeCount / WARNING_CEILING) * 100);
          return (
            <div
              key={g.az}
              style={{
                background: `${meta.color}0d`,
                border: `1px solid ${meta.color}44`,
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.locationName}>
                    {g.locationName}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace" }}>{g.az}</div>
                </div>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{meta.icon}</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                <span style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 800, color: meta.color }}>
                  {g.activeCount}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  active {g.waitlistedCount > 0 ? `· +${g.waitlistedCount} waitlisted` : ""}
                </span>
              </div>

              {/* Subtext: how many of the state-Active SPs are also health:Healthy.
                  Distinct signal from `state` — see header comment. Only flagged
                  when it diverges from activeCount, so a fully-healthy AZ stays clean. */}
              {g.activeCount > 0 && g.activeHealthyCount < g.activeCount && (
                <div style={{ fontSize: 10, color: "#f59e0b", marginBottom: 6 }}>
                  ⚠ only {g.activeHealthyCount}/{g.activeCount} report Healthy
                </div>
              )}
              {g.activeCount > 0 && g.activeHealthyCount === g.activeCount && (
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6 }}>
                  {g.activeHealthyCount}/{g.activeCount} healthy
                </div>
              )}

              <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                <div style={{ height: "100%", width: `${fillPct}%`, background: meta.color, borderRadius: 2 }} />
              </div>

              <div style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>{meta.label}</div>

              {(g.frozenCount > 0 || g.leavingCount > 0) && (
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
                  {g.frozenCount > 0 && `${g.frozenCount} frozen `}
                  {g.leavingCount > 0 && `${g.leavingCount} leaving`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}