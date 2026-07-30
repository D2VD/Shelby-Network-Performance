"use client";
/**
 * components/quorum-health-az.tsx — v2.0
 *
 * REWRITE (2026-07-30): v1.0 applied the on-chain constant
 * `min_active_storage_providers_for_active_pg = 12` directly to raw per-AZ
 * SP population counts. That constant is a PER-PLACEMENT-GROUP threshold
 * (a PG needs 12 of its 16 assigned slots active) — it is not an AZ-level
 * quorum rule. On a network with ~34 total SPs spread across 10 AZs, no
 * single AZ can ever reach 12, so v1.0 showed every AZ as "Below Quorum"
 * regardless of actual health. This was a spec error inherited from
 * UPGRADE_ROADMAP.md's A3 section, not just an implementation bug — caught
 * via live screenshot showing 10/10 AZs red including zones at 4/4 and 5/5
 * healthy.
 *
 * A true per-PG quorum verdict requires per-PG slot-fill data (the raw
 * on-chain `designated_placement_groups` field), which the backend pipeline
 * does not currently expose on SpInfo — see the deferred per-PG follow-up
 * from the prior session. Until that data exists, this component makes NO
 * quorum/pass-fail claim. It shows a plain, accurate distribution: how many
 * SPs are Active per AZ, and what fraction of those are also health:Healthy.
 * Coloring is informational (health ratio) — explicitly not labeled "OK" /
 * "Quorum" / "Below Quorum" anywhere in this file, to avoid re-implying a
 * verdict the data can't support.
 *
 * `state` (on-chain) vs `health` (off-chain derived: condition + TCP/IP
 * checks) remain tracked separately, per prior session — confirmed via live
 * curl that an SP can be state:"Active" with health:"Faulty" simultaneously.
 *
 * Data source: GET /api/network/providers?network=... — confirmed live via
 * curl against api.shelbyanalytics.site to match the extraction below
 * ({ ok, data: { providers, count } }); fallbacks kept for defense only.
 *
 * v2.1: hover a card to see the individual SPs behind the aggregate counts
 * (address, state, health per SP), sorted worst-health-first.
 */

import { useEffect, useRef, useState } from "react";

type SpState  = "Active" | "Waitlisted" | "Frozen" | "Leaving";
type SpHealth = "Healthy" | "Faulty" | "Unhealthy" | "Unknown";

interface RawSpInfo {
  address?: unknown;
  addressShort?: unknown;
  availabilityZone?: unknown;
  locationName?: unknown;
  state?: unknown;
  health?: unknown;
}

interface SpEntry {
  address: string;
  state: SpState;
  health: SpHealth;
}

interface AZGroup {
  az: string;
  locationName: string;
  activeCount: number;
  activeHealthyCount: number; // subset of activeCount where health === "Healthy"
  waitlistedCount: number;
  frozenCount: number;
  leavingCount: number;
  providers: SpEntry[]; // full per-SP list for the hover breakdown
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
 * Defensive extraction: tries the confirmed-live envelope first
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

/** Informational health-ratio banding — NOT a quorum verdict. */
type HealthBand = "healthy" | "degraded" | "unhealthy" | "empty";

function healthBandFor(activeCount: number, activeHealthyCount: number): HealthBand {
  if (activeCount === 0) return "empty";
  const ratio = activeHealthyCount / activeCount;
  if (ratio >= 0.8) return "healthy";
  if (ratio >= 0.5) return "degraded";
  return "unhealthy";
}

const BAND_META: Record<HealthBand, { color: string; icon: string; label: string }> = {
  healthy:   { color: "#22c55e", icon: "🟢", label: "Healthy" },
  degraded:  { color: "#f59e0b", icon: "🟡", label: "Degraded" },
  unhealthy: { color: "#ef4444", icon: "🔴", label: "Mostly Unhealthy" },
  empty:     { color: "#6b7280", icon: "⚪", label: "No Active SPs" },
};

const HEALTH_COLOR: Record<SpHealth, string> = {
  Healthy:   "#22c55e",
  Faulty:    "#ef4444",
  Unhealthy: "#ef4444",
  Unknown:   "#6b7280",
};

// Worst-first ordering for the per-SP hover list, so problem SPs surface immediately.
const HEALTH_SEVERITY: Record<SpHealth, number> = { Faulty: 0, Unhealthy: 1, Unknown: 2, Healthy: 3 };
const STATE_SEVERITY:  Record<SpState, number>  = { Frozen: 0, Leaving: 1, Waitlisted: 2, Active: 3 };

export function SpDistributionByAZ({ network }: { network: string }) {
  const [groups,    setGroups]    = useState<AZGroup[] | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [hoveredAz, setHoveredAz] = useState<string | null>(null);
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
          setError("Unexpected /api/network/providers response shape — cannot compute AZ distribution.");
          setLoading(false);
          return;
        }

        const byAz = new Map<string, AZGroup>();
        for (const sp of providers) {
          const az = str(sp.availabilityZone) === "—" ? "Unknown AZ" : String(sp.availabilityZone);
          const locationName = str(sp.locationName) === "—" ? az : String(sp.locationName);
          const state  = isSpState(sp.state)   ? sp.state   : "Active";  // fail-open to Active only if state truly absent
          const health = isSpHealth(sp.health) ? sp.health  : "Unknown"; // fail-open to Unknown, never assumed Healthy
          const address = str(sp.addressShort) !== "—" ? String(sp.addressShort) : str(sp.address);

          if (!byAz.has(az)) {
            byAz.set(az, { az, locationName, activeCount: 0, activeHealthyCount: 0, waitlistedCount: 0, frozenCount: 0, leavingCount: 0, providers: [] });
          }
          const g = byAz.get(az)!;
          if (state === "Active") {
            g.activeCount++;
            if (health === "Healthy") g.activeHealthyCount++;
          }
          if (state === "Waitlisted") g.waitlistedCount++;
          if (state === "Frozen")     g.frozenCount++;
          if (state === "Leaving")    g.leavingCount++;
          g.providers.push({ address, state, health });
        }

        for (const g of byAz.values()) {
          g.providers.sort((a, b) => {
            const sd = STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state];
            if (sd !== 0) return sd;
            return HEALTH_SEVERITY[a.health] - HEALTH_SEVERITY[b.health];
          });
        }

        // Worst health-ratio first, so degraded AZs surface without implying a pass/fail line.
        const sorted = Array.from(byAz.values()).sort((a, b) => {
          const ra = a.activeCount === 0 ? -1 : a.activeHealthyCount / a.activeCount;
          const rb = b.activeCount === 0 ? -1 : b.activeHealthyCount / b.activeCount;
          return ra - rb;
        });
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
        Loading storage provider distribution…
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

  const totalActive  = groups.reduce((s, g) => s + g.activeCount, 0);
  const totalHealthy = groups.reduce((s, g) => s + g.activeHealthyCount, 0);
  const maxActive    = Math.max(...groups.map((g) => g.activeCount), 1);

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
          Storage Providers by AZ
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>
          {groups.length} zones · {totalActive} active · {totalHealthy} healthy
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginBottom: 10 }}>
        Distribution only — per-PG quorum status (12-of-16 slots) requires placement-group data not yet exposed by the backend.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {groups.map((g) => {
          const band = healthBandFor(g.activeCount, g.activeHealthyCount);
          const meta = BAND_META[band];
          const fillPct = Math.min(100, (g.activeCount / maxActive) * 100);
          return (
            <div
              key={g.az}
              onMouseEnter={() => setHoveredAz(g.az)}
              onMouseLeave={() => setHoveredAz((cur) => (cur === g.az ? null : cur))}
              style={{
                position: "relative",
                background: `${meta.color}0d`,
                border: `1px solid ${meta.color}44`,
                borderRadius: 12,
                padding: "12px 14px",
                cursor: "default",
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

              {g.activeCount > 0 && (
                <div style={{ fontSize: 10, color: g.activeHealthyCount < g.activeCount ? "#f59e0b" : "var(--text-dim)", marginBottom: 6 }}>
                  {g.activeHealthyCount < g.activeCount ? "⚠ only " : ""}{g.activeHealthyCount}/{g.activeCount}{" "}
                  {g.activeHealthyCount < g.activeCount ? "report Healthy" : "healthy"}
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

              {hoveredAz === g.az && g.providers.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 6,
                    zIndex: 20,
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                    padding: "8px 10px",
                    maxHeight: 220,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {g.providers.length} SP{g.providers.length === 1 ? "" : "s"} in {g.az}
                  </div>
                  {g.providers.map((sp, i) => (
                    <div
                      key={`${sp.address}-${i}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        padding: "3px 0",
                        borderTop: i === 0 ? "none" : "1px solid var(--border)",
                        fontSize: 11,
                      }}
                    >
                      <span style={{ fontFamily: "monospace", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sp.address}
                      </span>
                      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: "var(--text-dim)" }}>{sp.state}</span>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: HEALTH_COLOR[sp.health], display: "inline-block" }} />
                        <span style={{ color: HEALTH_COLOR[sp.health] }}>{sp.health}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}