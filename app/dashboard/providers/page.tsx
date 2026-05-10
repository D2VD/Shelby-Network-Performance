"use client";
/**
 * app/dashboard/providers/page.tsx — v16.0
 *
 * CHANGES:
 * 1. Frozen state: new badge (blue/ice), separate counter in SummaryBar
 * 2. Location column: uses p.geo.city + p.geo.countryCode (from real IP lookup)
 *    instead of hardcoded zone label. Falls back to locationName if geo null.
 * 3. Filter: added "frozen" tab
 * 4. stateVariant: handles "Frozen" → blue
 * 5. healthVariant: "Awaiting Activation" → yellow
 * 6. SummaryBar: shows 7 counters (Total, Healthy, Active, Waitlisted, Frozen, Zones, Capacity)
 * 7. suppressHydrationWarning on time display
 */

import { useState, useEffect, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import { ProviderMap } from "@/components/provider-map";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

function TestnetMapNotice() {
  return (
    <div style={{ background: "rgba(147,51,234,0.07)", border: "1px solid rgba(147,51,234,0.25)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#c084fc", display: "flex", alignItems: "center", gap: 8 }}>
      <span>⚗</span><span>Shelby Testnet · Storage provider data from Aptos Testnet RPC + real IP geolocation</span>
    </div>
  );
}

type Variant = "green" | "red" | "yellow" | "gray" | "blue" | "cyan" | "ice";

function Badge({ label, variant }: { label: string; variant: Variant }) {
  const { isDark } = useTheme();
  const COLORS: Record<Variant, { light: { bg: string; color: string }; dark: { bg: string; color: string } }> = {
    green:  { light: { bg: "#f0fdf4", color: "#16a34a" }, dark: { bg: "rgba(34,197,94,0.12)",   color: "#22c55e" } },
    red:    { light: { bg: "#fef2f2", color: "#dc2626" }, dark: { bg: "rgba(239,68,68,0.12)",   color: "#ef4444" } },
    yellow: { light: { bg: "#fffbeb", color: "#d97706" }, dark: { bg: "rgba(245,158,11,0.12)",  color: "#f59e0b" } },
    gray:   { light: { bg: "#f9fafb", color: "#6b7280" }, dark: { bg: "rgba(100,116,139,0.12)", color: "#94a3b8" } },
    blue:   { light: { bg: "#eff6ff", color: "#2563eb" }, dark: { bg: "rgba(59,130,246,0.12)",  color: "#3b82f6" } },
    cyan:   { light: { bg: "#ecfeff", color: "#0891b2" }, dark: { bg: "rgba(6,182,212,0.12)",   color: "#06b6d4" } },
    // Frozen = icy blue
    ice:    { light: { bg: "#eff6ff", color: "#1d4ed8" }, dark: { bg: "rgba(96,165,250,0.15)",  color: "#60a5fa" } },
  };
  const s = isDark ? COLORS[variant].dark : COLORS[variant].light;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, display: "inline-block", flexShrink: 0 }} />
      {label}
    </span>
  );
}

function healthVariant(h: string): Variant {
  if (h === "Healthy")             return "green";
  if (h === "Faulty" || h === "Unhealthy") return "red";
  if (h === "Awaiting Activation") return "yellow";
  return "gray";
}

function stateVariant(s: string): Variant {
  if (s === "Active")     return "green";
  if (s === "Waitlisted") return "yellow";
  if (s === "Frozen")     return "ice";   // NEW
  if (s === "Leaving")    return "gray";
  return "gray";
}

function healthDotColor(h: string, state: string): string {
  if (state === "Frozen")                      return "#60a5fa"; // icy blue
  if (state === "Waitlisted")                  return "#f59e0b"; // amber
  if (h === "Healthy")                         return "#22c55e"; // green
  if (h === "Faulty" || h === "Unhealthy")     return "#ef4444"; // red
  return "#9ca3af";
}

function BlsKey({ full }: { full: string }) {
  const [copied, setCopied] = useState(false);
  if (!full) return <span style={{ color: "var(--text-dim)", fontSize: 13 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }} title={full}>{full.slice(0, 10)}…</span>
      <button onClick={async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(full).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: copied ? "#22c55e" : "var(--text-dim)", padding: "0 2px" }}>
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const active     = providers.filter(p => p.state  === "Active").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const frozen     = providers.filter(p => p.state  === "Frozen").length;   // NEW
  // Count unique real geo cities (not AZ names)
  const cities     = new Set(providers.map(p => p.geo?.city ?? p.availabilityZone)).size;
  const totalTiB   = providers.reduce((s, p) => s + (p.capacityTiB ?? 0), 0);

  const items = [
    { label: "Total SPs",   value: providers.length, color: "#2563eb" },
    { label: "Healthy",     value: healthy,           color: "#16a34a" },
    { label: "Active",      value: active,            color: "#0891b2" },
    { label: "Waitlisted",  value: waitlisted,        color: "#f59e0b" },
    { label: "Frozen",      value: frozen,            color: "#60a5fa" }, // NEW
    { label: "Cities",      value: cities,            color: "#8b5cf6" },
    { label: "Capacity",    value: totalTiB > 0 ? `${totalTiB.toFixed(0)} TiB` : "—", color: "#d97706" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length},1fr)`, gap: 1, background: "var(--border)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
      {items.map(s => (
        <div key={s.label} style={{ background: "var(--bg-card)", padding: "14px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: s.color, letterSpacing: -0.5 }}>{s.value}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function adaptToStorageProvider(sp: Record<string, unknown>): StorageProvider {
  return {
    address:          String(sp.address ?? ""),
    addressShort:     String(sp.addressShort ?? ""),
    availabilityZone: String(sp.availabilityZone ?? "unknown"),
    state:            String(sp.state ?? "Active") as StorageProvider["state"],
    health:           String(sp.health ?? "Unknown") as StorageProvider["health"],
    blsKey:           String(sp.blsKey ?? ""),
    fullBlsKey:       String(sp.blsKey ?? ""),
    capacityTiB:      sp.capacityTiB != null ? Number(sp.capacityTiB) : undefined,
    netAddress:       sp.netAddress ? String(sp.netAddress) : undefined,
    geo: sp.geo ? {
      lat:         Number((sp.geo as Record<string, unknown>).lat ?? 0),
      lng:         Number((sp.geo as Record<string, unknown>).lng ?? 0),
      city:        String((sp.geo as Record<string, unknown>).city ?? ""),
      countryCode: String((sp.geo as Record<string, unknown>).countryCode ?? ""),
      source:      String((sp.geo as Record<string, unknown>).source ?? "zone-fallback") as "geo-ip" | "zone-fallback" | "manual",
    } : undefined,
  };
}

type FilterKey = "all" | "healthy" | "faulty" | "waitlisted" | "frozen";

export default function ProvidersPage() {
  const { network } = useNetwork();
  const { isDark }  = useTheme();
  const isTestnet   = network === "testnet";

  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastAtStr, setLastAtStr] = useState<string>("");
  const [filter,    setFilter]    = useState<FilterKey>("all");
  const [sortBy,    setSortBy]    = useState<"zone" | "health" | "state" | "city">("city");
  const [source,    setSource]    = useState<string>("");

  const fetchProviders = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(35_000) });
      const d   = await res.json() as { ok?: boolean; error?: string; data?: { providers: unknown[]; count: number }; source?: string };
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
      const raw = d?.data?.providers;
      if (Array.isArray(raw)) {
        setProviders((raw as Record<string, unknown>[]).map(adaptToStorageProvider));
        setLastAtStr(new Date().toLocaleTimeString());
        setSource(String(d?.source ?? "vps"));
      } else {
        // No mock data — surface as error
        setError("Provider list returned no data");
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setProviders([]); setError(null); setSource(""); setLastAtStr("");
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  const filtered = providers
    .filter(p => {
      if (filter === "healthy")    return p.health === "Healthy";
      if (filter === "faulty")     return p.health === "Faulty" || p.health === "Unhealthy";
      if (filter === "waitlisted") return p.state  === "Waitlisted";
      if (filter === "frozen")     return p.state  === "Frozen";
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "city")   return (a.geo?.city ?? a.availabilityZone).localeCompare(b.geo?.city ?? b.availabilityZone);
      if (sortBy === "zone")   return a.availabilityZone.localeCompare(b.availabilityZone);
      if (sortBy === "health") return a.health.localeCompare(b.health);
      return a.state.localeCompare(b.state);
    });

  const healthyCount = providers.filter(p => p.health === "Healthy").length;
  const frozenCount  = providers.filter(p => p.state  === "Frozen").length;

  // Location to display: prefer real geo city, fallback to AZ zone label
  function locationDisplay(p: StorageProvider): { primary: string; secondary: string | null } {
    if (p.geo?.city) {
      const country = p.geo.countryCode ? `, ${p.geo.countryCode}` : "";
      return {
        primary:   `${p.geo.city}${country}`,
        secondary: p.availabilityZone,
      };
    }
    return {
      primary:   ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone,
      secondary: null,
    };
  }

  const FILTER_TABS: Array<{ key: FilterKey; label: string }> = [
    { key: "all",       label: "All"       },
    { key: "healthy",   label: "Healthy"   },
    { key: "faulty",    label: "Faulty"    },
    { key: "waitlisted",label: "Waitlisted"},
    { key: "frozen",    label: "Frozen"    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "calc(100vh - 120px)", background: "var(--bg-primary)" }}>

      {/* MAP */}
      <div style={{ background: isDark ? "#0d1526" : "#f0f4f8", position: "relative", height: "55vh", minHeight: 340 }}>
        <div style={{ position: "absolute", top: 12, right: 52, zIndex: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            background: isDark ? "rgba(13,21,38,0.92)" : "rgba(255,255,255,0.92)",
            border: `1px solid ${isDark ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.4)"}`,
            borderRadius: 8, padding: "5px 14px", fontSize: 12, color: isDark ? "#94a3b8" : "#6b7280",
            backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "#9ca3af" : providers.length > 0 ? "#22c55e" : "#9ca3af", display: "inline-block" }} />
            {loading ? "Loading…" : providers.length === 0
              ? (error ? "Failed to load providers" : "No providers found")
              : `${healthyCount}/${providers.length} online${frozenCount > 0 ? ` · ${frozenCount} frozen` : ""}`}
          </div>
          {lastAtStr && (
            <div suppressHydrationWarning style={{ background: isDark ? "rgba(13,21,38,0.9)" : "rgba(255,255,255,0.9)", border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#e5e7eb"}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>
              {lastAtStr}
            </div>
          )}
        </div>

        {loading && providers.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14, flexDirection: "column", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            {isTestnet ? "Fetching testnet providers…" : "Loading providers…"}
          </div>
        ) : error && providers.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, padding: "0 24px", textAlign: "center" }}>
            <span style={{ fontSize: 28 }}>⚠️</span>
            <div style={{ fontSize: 14, color: "#f59e0b", fontWeight: 600 }}>Provider data unavailable</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", maxWidth: 400 }}>{error}</div>
            <button onClick={fetchProviders} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, cursor: "pointer" }}>⟳ Retry</button>
          </div>
        ) : (
          <ProviderMap providers={providers} />
        )}
      </div>

      {/* STATS */}
      <div style={{ padding: "18px 26px", background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
        {isTestnet && <TestnetMapNotice />}
        <SummaryBar providers={providers} />
        <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {source && <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>Source: {source} · Auto-refresh 60s</div>}
          {isTestnet && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>
              Geo: real IP lookup via ip-api.com (Redis-cached 7d)
            </div>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div style={{ flex: 1, background: "var(--bg-primary)", padding: "22px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Provider Directory</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0", fontFamily: "monospace" }}>
              {loading && providers.length === 0
                ? "Loading…"
                : `${filtered.length} of ${providers.length} providers · ${isTestnet ? "Aptos Testnet" : "Shelbynet"}`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 2, background: "var(--bg-card2)", borderRadius: 9, padding: 2, border: "1px solid var(--border)" }}>
              {FILTER_TABS.map(({ key, label }) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  padding: "6px 14px", borderRadius: 7, border: "none", fontSize: 12,
                  fontWeight: filter === key ? 600 : 400,
                  background: filter === key ? "var(--bg-card)" : "transparent",
                  color: filter === key ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: filter === key ? "0 1px 3px var(--shadow-color)" : "none",
                  cursor: "pointer",
                }}>
                  {label}
                  {key === "frozen" && frozenCount > 0 && (
                    <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: "#60a5fa" }}>({frozenCount})</span>
                  )}
                </button>
              ))}
            </div>
            {/* Sort */}
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--text-primary)", background: "var(--bg-card)", cursor: "pointer", outline: "none" }}>
              <option value="city">Sort: City</option>
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>
            <button onClick={fetchProviders} disabled={loading} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", fontSize: 12, color: "var(--text-muted)", cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "…" : "⟳ Refresh"}
            </button>
          </div>
        </div>

        {error && providers.length === 0 && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 9, padding: "11px 15px", marginBottom: 14, fontSize: 13, color: "#ef4444" }}>⚠ {error}</div>
        )}

        <div style={{ borderRadius: 11, border: "1px solid var(--border)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-card2)", borderBottom: "1px solid var(--border)" }}>
                {["", "ADDRESS", "LOCATION", "AZ ZONE", "HEALTH", "STATE", "BLS KEY / NET"].map((h, i) => (
                  <th key={i} style={{ padding: i === 0 ? "10px 18px" : "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && providers.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)" }}>
                    {[18, 120, 100, 80, 60, 60, 80].map((w, j) => (
                      <td key={j} style={{ padding: j === 0 ? "11px 18px" : "11px 14px" }}>
                        <div className="skeleton" style={{ width: w, height: j === 0 ? 9 : 14, borderRadius: j === 0 ? "50%" : 4 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "52px 18px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                    {error
                      ? <span>Failed to load — <button onClick={fetchProviders} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 14 }}>retry</button></span>
                      : `No providers match "${filter}" filter`}
                  </td>
                </tr>
              ) : (
                filtered.map((p, i) => {
                  const dotColor  = healthDotColor(p.health, p.state);
                  const healthStr = p.health as string;
                  const hVariant  = healthVariant(healthStr);
                  const sVariant  = stateVariant(p.state);
                  const loc       = locationDisplay(p);
                  const isFrozen  = p.state === "Frozen";

                  return (
                    <tr key={p.address || i} style={{
                      borderBottom: "1px solid var(--border-soft)",
                      background: isFrozen
                        ? (isDark ? "rgba(96,165,250,0.04)" : "rgba(219,234,254,0.3)")
                        : i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)",
                    }}>
                      {/* Status dot */}
                      <td style={{ padding: "11px 18px", width: 30 }}>
                        <div style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, boxShadow: p.health === "Healthy" ? `0 0 6px ${dotColor}88` : "none" }} />
                      </td>
                      {/* Address */}
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{p.addressShort}</span>
                        {isFrozen && (
                          <div style={{ fontSize: 9, color: "#60a5fa", marginTop: 2, fontWeight: 600 }}>⛔ FROZEN</div>
                        )}
                      </td>
                      {/* Location (real IP geo) */}
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>{loc.primary}</div>
                        {loc.secondary && (
                          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1 }}>{loc.secondary}</div>
                        )}
                        {/* Show geo source indicator */}
                        {p.geo?.source === "geo-ip" && (
                          <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 1 }}>📍 IP geo</div>
                        )}
                      </td>
                      {/* AZ zone name */}
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.availabilityZone}</span>
                      </td>
                      {/* Health badge */}
                      <td style={{ padding: "11px 14px" }}>
                        <Badge
                          label={healthStr === "Unknown" ? "Awaiting" : healthStr}
                          variant={hVariant}
                        />
                      </td>
                      {/* State badge */}
                      <td style={{ padding: "11px 14px" }}>
                        <Badge label={p.state} variant={sVariant} />
                      </td>
                      {/* BLS key + net address */}
                      <td style={{ padding: "11px 18px" }}>
                        <BlsKey full={p.fullBlsKey ?? p.blsKey ?? ""} />
                        {p.netAddress && (
                          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2, fontFamily: "monospace" }}>{p.netAddress}</div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Legend for Frozen */}
        {frozenCount > 0 && (
          <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", fontSize: 11, color: "#60a5fa", display: "flex", alignItems: "center", gap: 8 }}>
            <span>ℹ</span>
            <span>Frozen SPs ({frozenCount}) are suspended by the protocol and cannot serve traffic.</span>
          </div>
        )}
      </div>
    </div>
  );
}