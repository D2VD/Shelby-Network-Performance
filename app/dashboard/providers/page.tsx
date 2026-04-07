"use client";
/**
 * app/dashboard/providers/page.tsx — v7.0
 * Theme-aware (dark/light CSS vars)
 * Hover row tooltip with full BLS key display
 * Map section uses ProviderMap (pure SVG) — theme synced
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme } from "@/components/theme-context";
import { ProviderMap } from "@/components/provider-map";
import { TestnetBanner } from "@/components/testnet-banner";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

// ── Badges ────────────────────────────────────────────────────────────────────
type Variant = "green" | "red" | "yellow" | "gray";

const BADGE_LIGHT = {
  green:  { bg: "#f0fdf4", color: "#16a34a" },
  red:    { bg: "#fef2f2", color: "#dc2626" },
  yellow: { bg: "#fffbeb", color: "#d97706" },
  gray:   { bg: "#f9fafb", color: "#6b7280" },
};
const BADGE_DARK = {
  green:  { bg: "rgba(34,197,94,0.12)",  color: "#22c55e" },
  red:    { bg: "rgba(239,68,68,0.12)",   color: "#ef4444" },
  yellow: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
  gray:   { bg: "rgba(100,116,139,0.12)",color: "#94a3b8" },
};

function Badge({ label, variant }: { label: string; variant: Variant }) {
  const { isDark } = useTheme();
  const s = (isDark ? BADGE_DARK : BADGE_LIGHT)[variant];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, display: "inline-block" }} />
      {label}
    </span>
  );
}

const healthVariant = (h: string): Variant => h === "Healthy" ? "green" : "red";
const stateVariant  = (s: string): Variant =>
  s === "Active" ? "green" : s === "Waitlisted" ? "yellow" : s === "Frozen" ? "gray" : "red";

// ── BLS Key with expand/copy ──────────────────────────────────────────────────
function BlsKey({ full, short }: { full: string; short: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied,   setCopied]   = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(full).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!full && !short) return <span style={{ color: "var(--text-dim)" }}>—</span>;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        title={full || short}
        style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? (full || short).slice(0, 32) + "…" : (short || full.slice(0, 10) + "…")}
      </span>
      <button
        onClick={copy}
        title="Copy full BLS key"
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: copied ? "#22c55e" : "var(--text-dim)", padding: "0 2px" }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

// ── SP Row with tooltip popup on hover ────────────────────────────────────────
function SPRow({ p, idx }: { p: StorageProvider; idx: number }) {
  const { isDark } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [copied,  setCopied]  = useState(false);
  const rowRef   = useRef<HTMLTableRowElement>(null);
  const zoneMeta = ZONE_META[p.availabilityZone];
  const isHealthy = p.health === "Healthy";
  const bls = p.fullBlsKey || p.blsKey || "";

  const copyBls = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!bls) return;
    await navigator.clipboard.writeText(bls).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Tooltip position: right side of row if space, else left
  const [tipLeft, setTipLeft] = useState(true);
  useEffect(() => {
    if (hovered && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setTipLeft(rect.right + 290 < window.innerWidth);
    }
  }, [hovered]);

  return (
    <tr
      ref={rowRef}
      style={{
        borderBottom: `1px solid var(--border-soft)`,
        background: hovered
          ? (isDark ? "rgba(56,189,248,0.06)" : "#f0f7ff")
          : (idx % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)"),
        transition: "background 0.1s",
        position: "relative",
        cursor: "default",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Status dot */}
      <td style={{ padding: "10px 16px", width: 28 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: isHealthy ? "#22c55e" : "#ef4444",
          boxShadow: isHealthy ? "0 0 6px #22c55e88" : "0 0 6px #ef444488",
        }} />
      </td>

      {/* Address */}
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>
          {p.addressShort}
        </div>
        {p.geo?.city && (
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1 }}>
            {p.geo.city}{p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}
          </div>
        )}
        {hovered && p.address && p.address !== p.addressShort && (
          <div style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-dim)", marginTop: 2, opacity: 0.7 }}>
            {p.address.slice(0, 18)}…
          </div>
        )}
      </td>

      {/* Zone */}
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>
          {zoneMeta?.label ?? p.availabilityZone}
        </div>
      </td>

      {/* Health */}
      <td style={{ padding: "10px 12px" }}>
        <Badge label={p.health} variant={healthVariant(p.health)} />
      </td>

      {/* State */}
      <td style={{ padding: "10px 12px" }}>
        <Badge label={p.state} variant={stateVariant(p.state)} />
      </td>

      {/* Capacity */}
      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        {p.capacityTiB != null
          ? <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-primary)" }}>{p.capacityTiB.toFixed(2)} TiB</span>
          : <span style={{ color: "var(--text-dim)" }}>—</span>
        }
      </td>

      {/* BLS Key */}
      <td style={{ padding: "10px 16px" }}>
        <BlsKey full={p.fullBlsKey ?? p.blsKey ?? ""} short={p.blsKey ? p.blsKey.slice(0, 10) + "…" : ""} />
        {hovered && p.netAddress && (
          <div style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-dim)", marginTop: 2, opacity: 0.7 }}>
            {p.netAddress}
          </div>
        )}
      </td>

      {/* Hover tooltip — detailed card like Image 1 */}
      {hovered && (
        <td style={{ padding: 0, border: "none", position: "relative" }}>
          <div style={{
            position: "absolute",
            [tipLeft ? "left" : "right"]: "100%",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 200,
            width: 260,
            background: isDark ? "rgba(13,21,38,0.97)" : "rgba(255,255,255,0.98)",
            border: `1px solid ${isDark ? "rgba(56,189,248,0.2)" : "#e2e8f0"}`,
            borderRadius: 12,
            padding: "12px 14px",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
            pointerEvents: "none",
          }}>
            {/* Header */}
            <div style={{ fontSize: 9, fontWeight: 700, color: isDark ? "#94a3b8" : "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
              STORAGE PROVIDER
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#3b82f6", fontFamily: "monospace", marginBottom: 8 }}>
              {p.addressShort}
            </div>
            {/* Badges */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                background: isHealthy ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                color: isHealthy ? "#22c55e" : "#ef4444",
                border: `1px solid ${isHealthy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                ● {p.state}
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                background: isHealthy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                color: isHealthy ? "#22c55e" : "#ef4444" }}>
                ● {p.health}
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                Zone {ZONE_META[p.availabilityZone]?.shortLabel ?? p.availabilityZone.replace("dc_","")}
              </span>
            </div>
            {/* Location */}
            <div style={{ background: "rgba(128,128,128,0.08)", borderRadius: 6, padding: "7px 9px", marginBottom: 8 }}>
              <div style={{ fontSize: 8, color: isDark ? "#94a3b8" : "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>LOCATION</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: isDark ? "#e2e8f0" : "#111827" }}>
                {p.geo?.city ?? zoneMeta?.label ?? "Unknown"}{p.geo?.countryCode ? `, ${p.geo.countryCode}` : ""}
              </div>
              {p.geo && <div style={{ fontSize: 9, color: isDark ? "#94a3b8" : "#9ca3af", fontFamily: "monospace", marginTop: 1 }}>{p.geo.lat?.toFixed(4)}°, {p.geo.lng?.toFixed(4)}°</div>}
            </div>
            {/* Info grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 8px", marginBottom: bls ? 8 : 0 }}>
              <div>
                <div style={{ fontSize: 8, color: isDark ? "#94a3b8" : "#9ca3af", textTransform: "uppercase" }}>ZONE</div>
                <div style={{ fontSize: 10, color: isDark ? "#e2e8f0" : "#111827", fontWeight: 500 }}>{zoneMeta?.label ?? p.availabilityZone}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: isDark ? "#94a3b8" : "#9ca3af", textTransform: "uppercase" }}>CAPACITY</div>
                <div style={{ fontSize: 10, color: isDark ? "#e2e8f0" : "#111827", fontWeight: 500 }}>{p.capacityTiB != null ? `${p.capacityTiB.toFixed(1)} TiB` : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: isDark ? "#94a3b8" : "#9ca3af", textTransform: "uppercase" }}>NET IP</div>
                <div style={{ fontSize: 10, color: isDark ? "#e2e8f0" : "#111827", fontWeight: 500, fontFamily: "monospace" }}>{p.netAddress ?? "—"}</div>
              </div>
            </div>
            {/* BLS Key */}
            {bls && (
              <div style={{ borderTop: `1px solid ${isDark ? "rgba(56,189,248,0.15)" : "#e2e8f0"}`, paddingTop: 8 }}>
                <div style={{ fontSize: 8, color: isDark ? "#94a3b8" : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>BLS PUBLIC KEY</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(128,128,128,0.07)", borderRadius: 4, padding: "3px 6px" }}>
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: isDark ? "#94a3b8" : "#6b7280", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {bls.length > 34 ? `${bls.slice(0,32)}…` : bls}
                  </span>
                </div>
                <div style={{ fontSize: 8, color: isDark ? "#64748b" : "#9ca3af", marginTop: 2, opacity: .7 }}>on-chain · storage_provider_registry</div>
              </div>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

// ── Summary bar ────────────────────────────────────────────────────────────────
function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const healthy  = providers.filter(p => p.health === "Healthy").length;
  const active   = providers.filter(p => p.state  === "Active").length;
  const zones    = new Set(providers.map(p => p.availabilityZone)).size;
  const totalTiB = providers.reduce((s, p) => s + (p.capacityTiB ?? 0), 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, background: "var(--border)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
      {[
        { label: "Total SPs",      value: providers.length,                                  color: "#2563eb" },
        { label: "Healthy",        value: healthy,                                            color: "#16a34a" },
        { label: "Active",         value: active,                                             color: "#0891b2" },
        { label: "Zones",          value: zones,                                              color: "#8b5cf6" },
        { label: "Total Capacity", value: totalTiB > 0 ? `${totalTiB.toFixed(0)} TiB` : "—", color: "#d97706", isStr: true },
      ].map(s => (
        <div key={s.label} style={{ background: "var(--bg-card)", padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: s.isStr ? 18 : 22, fontWeight: 700, color: s.color, letterSpacing: -0.5 }}>
            {s.value}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const { network } = useNetwork();
  const { isDark }  = useTheme();
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastAt,    setLastAt]    = useState<Date | null>(null);
  const [filter,    setFilter]    = useState<"all" | "healthy" | "faulty">("all");
  const [sortBy,    setSortBy]    = useState<"zone" | "health" | "state">("zone");

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/providers?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as any;
      if (d.data?.providers) {
        setProviders(d.data.providers);
        setLastAt(new Date());
        setError(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setLoading(true);
    setProviders([]);
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  if (network === "testnet") return <TestnetBanner />;

  const filtered = providers
    .filter(p => filter === "healthy" ? p.health === "Healthy" : filter === "faulty" ? p.health !== "Healthy" : true)
    .sort((a, b) => {
      if (sortBy === "zone")   return (a.availabilityZone ?? "").localeCompare(b.availabilityZone ?? "");
      if (sortBy === "health") return a.health.localeCompare(b.health);
      if (sortBy === "state")  return a.state.localeCompare(b.state);
      return 0;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "calc(100vh - 120px)", background: "var(--bg-primary)" }}>

      {/* ── MAP ── */}
      <div style={{
        background: isDark ? "#0d1526" : "#f0f4f8",
        position: "relative", height: "55vh", minHeight: 320,
      }}>
        {/* Header overlay */}
        <div style={{ position: "absolute", top: 12, left: 264, zIndex: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            background: isDark ? "rgba(13,21,38,0.92)" : "rgba(255,255,255,0.92)",
            border: `1px solid ${isDark ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.4)"}`,
            borderRadius: 8, padding: "4px 12px", fontSize: 11,
            color: isDark ? "#94a3b8" : "#6b7280",
            backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            {loading ? "Loading…" : `${providers.filter(p => p.health === "Healthy").length} nodes online`}
          </div>
          {lastAt && (
            <div style={{
              background: isDark ? "rgba(13,21,38,0.9)" : "rgba(255,255,255,0.9)",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#e5e7eb"}`,
              borderRadius: 6, padding: "3px 9px", fontSize: 10,
              color: "var(--text-dim)", fontFamily: "monospace",
            }}>
              {lastAt.toLocaleTimeString()}
            </div>
          )}
        </div>

        {loading && providers.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13, flexDirection: "column", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            Loading providers…
          </div>
        ) : (
          <ProviderMap providers={providers} />
        )}
      </div>

      {/* ── STATS BAR ── */}
      <div style={{ padding: "16px 24px", background: "var(--bg-card)", borderBottom: `1px solid var(--border)` }}>
        <SummaryBar providers={providers} />
      </div>

      {/* ── SP TABLE ── */}
      <div style={{ flex: 1, background: "var(--bg-primary)", padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              Provider Directory
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0", fontFamily: "monospace" }}>
              {filtered.length} of {providers.length} providers · Hover row for details · Auto-refresh 60s
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", gap: 2, background: "var(--bg-card2)", borderRadius: 8, padding: 2, border: "1px solid var(--border)" }}>
              {(["all", "healthy", "faulty"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 11,
                  fontWeight: filter === f ? 600 : 400,
                  background: filter === f ? "var(--bg-card)" : "transparent",
                  color: filter === f ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: filter === f ? "0 1px 3px var(--shadow-color)" : "none",
                  cursor: "pointer", textTransform: "capitalize",
                }}>{f}</button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid var(--border)`, fontSize: 11, color: "var(--text-primary)", background: "var(--bg-card)", cursor: "pointer", outline: "none" }}
            >
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>
            <button
              onClick={fetchProviders}
              style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid var(--border)`, background: "var(--bg-card)", fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}
            >
              ⟳ Refresh
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#ef4444" }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ borderRadius: 10, border: `1px solid var(--border)`, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-card2)", borderBottom: `1px solid var(--border)` }}>
                {["", "ADDRESS", "ZONE", "HEALTH", "STATE", "CAPACITY", "BLS KEY"].map((h, i) => (
                  <th key={i} style={{
                    padding: i === 0 ? "9px 16px" : "9px 12px",
                    textAlign: i === 5 ? "right" : "left",
                    fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
                    textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
                <th style={{ width: 0, padding: 0 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "48px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  {loading ? "Loading providers…" : "No providers found"}
                </td></tr>
              ) : (
                filtered.map((p, i) => <SPRow key={p.address || i} p={p} idx={i} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}