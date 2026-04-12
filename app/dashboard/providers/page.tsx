"use client";
/**
 * app/dashboard/providers/page.tsx — v12.0
 * FIX: Remove TestnetBanner from Map/Providers page.
 *      Testnet now shows live provider data fetched from /api/network/providers?network=testnet.
 *      Testnet doesn't have globe arcs but DOES show the provider table and topology info.
 * KEEP: Benchmark page retains TestnetBanner (upload not supported on testnet).
 */

import { useState, useEffect, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import { ProviderMap } from "@/components/provider-map";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

// ─── Testnet lightweight notice (replaces full TestnetBanner) ─────────────────
function TestnetMapNotice() {
  return (
    <div style={{
      background: "rgba(147,51,234,0.07)", border: "1px solid rgba(147,51,234,0.25)",
      borderRadius: 10, padding: "10px 16px", marginBottom: 16,
      fontSize: 13, color: "#c084fc", display: "flex", alignItems: "center", gap: 8,
    }}>
      <span>⚗</span>
      <span>Shelby Testnet · Storage provider data from Aptos Testnet RPC</span>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Variant = "green" | "red" | "yellow" | "gray" | "blue" | "cyan";

function Badge({ label, variant }: { label: string; variant: Variant }) {
  const { isDark } = useTheme();
  const COLORS: Record<Variant, { light: { bg: string; color: string }; dark: { bg: string; color: string } }> = {
    green:  { light: { bg: "#f0fdf4", color: "#16a34a" }, dark: { bg: "rgba(34,197,94,0.12)",   color: "#22c55e" } },
    red:    { light: { bg: "#fef2f2", color: "#dc2626" }, dark: { bg: "rgba(239,68,68,0.12)",   color: "#ef4444" } },
    yellow: { light: { bg: "#fffbeb", color: "#d97706" }, dark: { bg: "rgba(245,158,11,0.12)",  color: "#f59e0b" } },
    gray:   { light: { bg: "#f9fafb", color: "#6b7280" }, dark: { bg: "rgba(100,116,139,0.12)", color: "#94a3b8" } },
    blue:   { light: { bg: "#eff6ff", color: "#2563eb" }, dark: { bg: "rgba(59,130,246,0.12)",  color: "#3b82f6" } },
    cyan:   { light: { bg: "#ecfeff", color: "#0891b2" }, dark: { bg: "rgba(6,182,212,0.12)",   color: "#06b6d4" } },
  };
  const s = isDark ? COLORS[variant].dark : COLORS[variant].light;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, fontSize: 13, fontWeight: 600, background: s.bg, color: s.color }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, display: "inline-block" }} />
      {label}
    </span>
  );
}

const healthVariant = (h: string): Variant => h === "Healthy" ? "green" : h === "Unhealthy" ? "red" : "gray";
const stateVariant  = (s: string): Variant => s === "Active" ? "green" : s === "Waitlisted" ? "yellow" : s === "Frozen" ? "gray" : "red";

function BlsKey({ full }: { full: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!full) return;
    await navigator.clipboard.writeText(full).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (!full) return <span style={{ color: "var(--text-dim)", fontSize: 13 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }} title={full}>{full.slice(0, 10)}…</span>
      <button onClick={copy} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: copied ? "#22c55e" : "var(--text-dim)", padding: "0 2px" }}>
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const active     = providers.filter(p => p.state  === "Active").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const zones      = new Set(providers.map(p => p.availabilityZone)).size;
  const totalTiB   = providers.reduce((s, p) => s + (p.capacityTiB ?? 0), 0);
  const stats = [
    { label: "Total SPs",      value: providers.length, color: "#2563eb" },
    { label: "Healthy",        value: healthy,          color: "#16a34a" },
    { label: "Active",         value: active,           color: "#0891b2" },
    { label: "Waitlisted",     value: waitlisted,       color: "#f59e0b" },
    { label: "Zones",          value: zones,            color: "#8b5cf6" },
    { label: "Total Capacity", value: totalTiB > 0 ? `${totalTiB.toFixed(0)} TiB` : "—", color: "#d97706", isStr: true },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 1, background: "var(--border)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
      {stats.map(s => (
        <div key={s.label} style={{ background: "var(--bg-card)", padding: "14px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: s.isStr ? 18 : 24, fontWeight: 700, color: s.color, letterSpacing: -0.5 }}>{s.value}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Map adapter — testnet SpInfo → StorageProvider shape ─────────────────────
// The API returns SpInfo (from shared-types). ProviderMap expects StorageProvider (lib/types).
// These are structurally compatible — just need to map field names.
function adaptSpInfoToStorageProvider(sp: Record<string, unknown>): StorageProvider {
  return {
    address:          String(sp.address ?? ""),
    addressShort:     String(sp.addressShort ?? ""),
    availabilityZone: String(sp.availabilityZone ?? "unknown"),
    state:            String(sp.state ?? "Active") as StorageProvider["state"],
    health:           String(sp.health ?? "Unknown") as StorageProvider["health"],
    blsKey:           String(sp.blsKey ?? ""),
    fullBlsKey:       String(sp.blsKey ?? ""),
    capacityTiB:      sp.capacityTiB != null ? Number(sp.capacityTiB) : undefined,
    netAddress:       sp.netAddress   ? String(sp.netAddress) : sp.ipAddress ? String(sp.ipAddress) : undefined,
    geo: sp.geo ? {
      lat:         Number((sp.geo as Record<string, unknown>).lat ?? 0),
      lng:         Number((sp.geo as Record<string, unknown>).lng ?? 0),
      city:        String((sp.geo as Record<string, unknown>).city ?? ""),
      countryCode: String((sp.geo as Record<string, unknown>).countryCode ?? ""),
      source:      "zone-fallback" as const,
    } : undefined,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const { network } = useNetwork();
  const { isDark }  = useTheme();
  const isTestnet   = network === "testnet";

  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastAt,    setLastAt]    = useState<Date | null>(null);
  const [filter,    setFilter]    = useState<"all" | "healthy" | "faulty" | "waitlisted">("all");
  const [sortBy,    setSortBy]    = useState<"zone" | "health" | "state">("zone");
  const [hoveredSP, setHoveredSP] = useState<StorageProvider | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/providers?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      const raw = ((d as Record<string, unknown>).data as Record<string, unknown>)?.providers;
      if (Array.isArray(raw)) {
        // Adapt SpInfo → StorageProvider shape
        const adapted = (raw as Record<string, unknown>[]).map(adaptSpInfoToStorageProvider);
        setProviders(adapted);
        setLastAt(new Date());
        setError(null);
      }
    } catch (e: unknown) {
      setError((e as Error).message);
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

  const filtered = providers
    .filter(p => {
      if (filter === "healthy")    return p.health === "Healthy";
      if (filter === "faulty")     return p.health !== "Healthy" && (p.health as string) !== "Unknown";
      if (filter === "waitlisted") return p.state  === "Waitlisted";
      return true;
    })
    .sort((a, b) =>
      sortBy === "zone"   ? (a.availabilityZone ?? "").localeCompare(b.availabilityZone ?? "") :
      sortBy === "health" ? a.health.localeCompare(b.health) :
      a.state.localeCompare(b.state)
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "calc(100vh - 120px)", background: "var(--bg-primary)" }}>

      {/* MAP SECTION */}
      <div style={{ background: isDark ? "#0d1526" : "#f0f4f8", position: "relative", height: "55vh", minHeight: 340 }}>
        <div style={{ position: "absolute", top: 12, right: 52, zIndex: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            background: isDark ? "rgba(13,21,38,0.92)" : "rgba(255,255,255,0.92)",
            border: `1px solid ${isDark ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.4)"}`,
            borderRadius: 8, padding: "5px 14px", fontSize: 12, color: isDark ? "#94a3b8" : "#6b7280",
            backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            {loading ? "Loading…" : `${providers.filter(p => p.health === "Healthy").length} nodes online`}
          </div>
          {lastAt && (
            <div style={{ background: isDark ? "rgba(13,21,38,0.9)" : "rgba(255,255,255,0.9)", border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#e5e7eb"}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>
              {lastAt.toLocaleTimeString()}
            </div>
          )}
        </div>

        {loading && providers.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14, flexDirection: "column", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            {isTestnet ? "Fetching testnet providers…" : "Loading providers…"}
          </div>
        ) : (
          <ProviderMap providers={providers} />
        )}
      </div>

      {/* STATS SECTION */}
      <div style={{ padding: "18px 26px", background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
        {isTestnet && <TestnetMapNotice />}
        <SummaryBar providers={providers} />
      </div>

      {/* TABLE SECTION */}
      <div style={{ flex: 1, background: "var(--bg-primary)", padding: "22px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Provider Directory</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0", fontFamily: "monospace" }}>
              {filtered.length} of {providers.length} providers · {isTestnet ? "Aptos Testnet" : "Hover row for details"} · Auto-refresh 60s
            </p>
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <div style={{ display: "flex", gap: 2, background: "var(--bg-card2)", borderRadius: 9, padding: 2, border: "1px solid var(--border)" }}>
              {(["all", "healthy", "faulty", "waitlisted"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: filter === f ? 600 : 400, background: filter === f ? "var(--bg-card)" : "transparent", color: filter === f ? "var(--text-primary)" : "var(--text-muted)", boxShadow: filter === f ? "0 1px 3px var(--shadow-color)" : "none", cursor: "pointer", textTransform: "capitalize" }}>
                  {f}
                </button>
              ))}
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as "zone" | "health" | "state")} style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--text-primary)", background: "var(--bg-card)", cursor: "pointer", outline: "none" }}>
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>
            <button onClick={fetchProviders} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>⟳ Refresh</button>
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 9, padding: "11px 15px", marginBottom: 14, fontSize: 13, color: "#ef4444" }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ borderRadius: 11, border: "1px solid var(--border)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-card2)", borderBottom: "1px solid var(--border)" }}>
                {["", "ADDRESS", "ZONE", "HEALTH", "STATE", "CAPACITY", "BLS KEY"].map((h, i) => (
                  <th key={i} style={{ padding: i === 0 ? "10px 18px" : "10px 14px", textAlign: i === 5 ? "right" : "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "52px 18px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                  {loading
                    ? "Loading providers…"
                    : isTestnet
                      ? "No providers found on Testnet yet"
                      : "No providers found"}
                </td></tr>
              ) : filtered.map((p, i) => {
                const isH = p.health === "Healthy";
                return (
                  <tr key={p.address || i}
                    style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)", cursor: "default" }}
                    onMouseEnter={() => setHoveredSP(p)}
                    onMouseLeave={() => setHoveredSP(null)}
                  >
                    <td style={{ padding: "11px 18px", width: 30 }}>
                      <div style={{ 
                          width: 9, 
                          height: 9, 
                          borderRadius: "50%", 
                            background: isH ? "#22c55e" : (p.health as string) === "Unknown" ? "#9ca3af" : "#ef4444", 
                            boxShadow: isH ? "0 0 6px #22c55e88" : "none" 
                        }} />
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{p.addressShort}</span>
                      {p.geo?.city && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{p.geo.city}{p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}</div>}
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                        {ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone}
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px" }}><Badge label={p.health} variant={healthVariant(p.health)} /></td>
                    <td style={{ padding: "11px 14px" }}><Badge label={p.state}  variant={stateVariant(p.state)}   /></td>
                    <td style={{ padding: "11px 14px", textAlign: "right" }}>
                      {p.capacityTiB != null
                        ? <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-primary)" }}>{p.capacityTiB.toFixed(2)} TiB</span>
                        : <span style={{ color: "var(--text-dim)" }}>—</span>}
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <BlsKey full={p.fullBlsKey ?? p.blsKey ?? ""} />
                      {p.netAddress && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1, fontFamily: "monospace" }}>{p.netAddress}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}