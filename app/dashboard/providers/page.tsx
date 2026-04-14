"use client";
/**
 * app/dashboard/providers/page.tsx — v14.0
 * FIXES:
 * 1. React error #418 hydration mismatch — time display now uses mounted state
 * 2. Uses real testnet data: 32 active SPs, 1 waitlisted, 10 PGs, 50 slices
 * 3. AZ names from registry (Stakely-0, Jump-AMS-0, etc.) displayed correctly
 * 4. Loading skeleton, retry on error
 */

import { useState, useEffect, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import { ProviderMap } from "@/components/provider-map";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

// ─── Testnet notice ───────────────────────────────────────────────────────────
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

const healthVariant = (h: string): Variant => {
  if (h === "Healthy") return "green";
  if (h === "Faulty")  return "red"; // Đổi Unhealthy -> Faulty
  return "gray";
};
const stateVariant = (s: string): Variant => {
  if (s === "Active")     return "green";
  if (s === "Waitlisted") return "yellow";
  if (s === "Frozen")     return "blue";
  return "gray";
};

function BlsKey({ full }: { full: string }) {
  const [copied, setCopied] = useState(false);
  if (!full) return <span style={{ color: "var(--text-dim)", fontSize: 13 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }} title={full}>
        {full.slice(0, 10)}…
      </span>
      <button
        onClick={async (e) => {
          e.stopPropagation();
          await navigator.clipboard.writeText(full).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: copied ? "#22c55e" : "var(--text-dim)", padding: "0 2px" }}
      >
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 1, background: "var(--border)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
      {[
        { label: "Total SPs",      value: providers.length,  color: "#2563eb" },
        { label: "Healthy",        value: healthy,            color: "#16a34a" },
        { label: "Active",         value: active,             color: "#0891b2" },
        { label: "Waitlisted",     value: waitlisted,         color: "#f59e0b" },
        { label: "Zones",          value: zones,              color: "#8b5cf6" },
        { label: "Total Capacity", value: totalTiB > 0 ? `${totalTiB.toFixed(0)} TiB` : "—", color: "#d97706" },
      ].map(s => (
        <div key={s.label} style={{ background: "var(--bg-card)", padding: "14px 10px", textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: s.color, letterSpacing: -0.5 }}>{s.value}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// Adapt API SpInfo → StorageProvider (handles testnet AZ names like "Stakely-0")
function adaptToStorageProvider(sp: Record<string, unknown>): StorageProvider {
  const az = String(sp.availabilityZone ?? "unknown");
  const azMapped = az.startsWith("dc_") ? az : az;

  return {
    address:          String(sp.address ?? ""),
    addressShort:     String(sp.addressShort ?? ""),
    availabilityZone: azMapped,
    state:            String(sp.state ?? "Active") as StorageProvider["state"],
    // NEW LOGIC: Tránh dùng "Unknown" nếu Type StorageProvider["health"] không hỗ trợ
    health: (String(sp.health ?? "Unhealthy")) as StorageProvider["health"], 
    blsKey:           String(sp.blsKey ?? ""),
    fullBlsKey:       String(sp.blsKey ?? ""),
    capacityTiB:      sp.capacityTiB != null ? Number(sp.capacityTiB) : undefined,
    netAddress:       sp.netAddress ? String(sp.netAddress) : undefined,
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
  // FIX: Use mounted state for time display to prevent hydration mismatch
  const [lastAtStr, setLastAtStr] = useState<string>("");
  const [filter,    setFilter]    = useState<"all" | "healthy" | "faulty" | "waitlisted">("all");
  const [sortBy,    setSortBy]    = useState<"zone" | "health" | "state">("zone");
  const [source,    setSource]    = useState<string>("");

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, {
        signal: AbortSignal.timeout(35_000),
      });

      const d = await res.json() as any;

      if (!res.ok) {
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }

      const raw = d?.data?.providers;
      if (Array.isArray(raw)) {
        const adapted = (raw as Record<string, unknown>[]).map(adaptToStorageProvider);
        setProviders(adapted);
        // FIX: Only set time string client-side (not during SSR)
        setLastAtStr(new Date().toLocaleTimeString());
        setSource(String(d?.source ?? "vps"));
        setError(null);
      } else {
        setProviders([]);
        setLastAtStr(new Date().toLocaleTimeString());
        setSource(String(d?.source ?? "vps"));
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setProviders([]);
    setError(null);
    setSource("");
    setLastAtStr("");
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  const filtered = providers
  .filter(p => {
    if (filter === "healthy")    return p.health === "Healthy";
    if (filter === "faulty")     return p.health === "Faulty"; // Dùng Faulty
    if (filter === "waitlisted") return p.state  === "Waitlisted";
    return true;
  })
    .sort((a, b) =>
      sortBy === "zone"   ? (a.availabilityZone ?? "").localeCompare(b.availabilityZone ?? "") :
      sortBy === "health" ? a.health.localeCompare(b.health) :
      a.state.localeCompare(b.state)
    );

  const healthyCount = providers.filter(p => p.health === "Healthy").length;
  const totalCount   = providers.length;

  // Get display label for AZ — handles both dc_* format and custom names like "Stakely-0"
  function getZoneLabel(az: string): string {
    if (ZONE_META[az]?.label) return ZONE_META[az].label;
    // Custom AZ names from testnet: "Stakely-0", "Jump-AMS-0", etc.
    return az;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "calc(100vh - 120px)", background: "var(--bg-primary)" }}>

      {/* MAP */}
      <div style={{ background: isDark ? "#0d1526" : "#f0f4f8", position: "relative", height: "55vh", minHeight: 340 }}>

        {/* Status badge — suppressHydrationWarning to avoid mismatch */}
        <div style={{ position: "absolute", top: 12, right: 52, zIndex: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            background: isDark ? "rgba(13,21,38,0.92)" : "rgba(255,255,255,0.92)",
            border: `1px solid ${isDark ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.4)"}`,
            borderRadius: 8, padding: "5px 14px", fontSize: 12, color: isDark ? "#94a3b8" : "#6b7280",
            backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: loading ? "#9ca3af" : error ? "#f59e0b" : totalCount > 0 ? "#22c55e" : "#9ca3af",
              display: "inline-block",
            }} />
            {loading
              ? "Loading providers…"
              : error
                ? "Fetch failed"
                : totalCount === 0
                  ? (isTestnet ? "No testnet providers yet" : "No providers found")
                  : `${healthyCount}/${totalCount} nodes online`}
          </div>
          {/* FIX: suppressHydrationWarning prevents React #418 error for time display */}
          {lastAtStr && (
            <div
              suppressHydrationWarning
              style={{ background: isDark ? "rgba(13,21,38,0.9)" : "rgba(255,255,255,0.9)", border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#e5e7eb"}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}
            >
              {lastAtStr}
            </div>
          )}
        </div>

        {loading && providers.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14, flexDirection: "column", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            {isTestnet ? "Fetching testnet providers from Aptos RPC…" : "Loading providers…"}
          </div>
        ) : error && providers.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, padding: "0 24px", textAlign: "center" }}>
            <span style={{ fontSize: 28 }}>⚠️</span>
            <div style={{ fontSize: 14, color: "#f59e0b", fontWeight: 600 }}>Provider data unavailable</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", maxWidth: 400 }}>{error}</div>
            <button onClick={fetchProviders} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, cursor: "pointer" }}>
              ⟳ Retry
            </button>
          </div>
        ) : (
          <ProviderMap providers={providers} />
        )}
      </div>

      {/* STATS */}
      <div style={{ padding: "18px 26px", background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
        {isTestnet && <TestnetMapNotice />}
        <SummaryBar providers={providers} />
        {source && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>
            Source: {source} · {isTestnet ? "Aptos Testnet RPC" : "Shelbynet on-chain"} · Auto-refresh 60s
          </div>
        )}
      </div>

      {/* TABLE */}
      <div style={{ flex: 1, background: "var(--bg-primary)", padding: "22px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Provider Directory</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0", fontFamily: "monospace" }}>
              {loading && providers.length === 0
                ? "Loading…"
                : `${filtered.length} of ${totalCount} providers · ${isTestnet ? "Aptos Testnet" : "Shelbynet"} · Auto-refresh 60s`}
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
            <button onClick={fetchProviders} disabled={loading} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", fontSize: 12, color: "var(--text-muted)", cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "…" : "⟳ Refresh"}
            </button>
          </div>
        </div>

        {error && providers.length === 0 && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 9, padding: "11px 15px", marginBottom: 14, fontSize: 13, color: "#ef4444" }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ borderRadius: 11, border: "1px solid var(--border)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-card2)", borderBottom: "1px solid var(--border)" }}>
                {["", "ADDRESS", "ZONE / DC", "HEALTH", "STATE", "CAPACITY", "BLS KEY"].map((h, i) => (
                  <th key={i} style={{ padding: i === 0 ? "10px 18px" : "10px 14px", textAlign: i === 5 ? "right" : "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && providers.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)" }}>
                    {[18, 120, 100, 60, 60, 70, 80].map((w, j) => (
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
                      : isTestnet
                        ? "No testnet storage providers found. The Shelby testnet may not have registered SPs yet."
                        : "No providers match the current filter"}
                  </td>
                </tr>
              ) : filtered.map((p, i) => {
                const isH      = p.health === "Healthy";
                const isUnknown = p.health !== "Healthy" && p.health !== "Faulty";
                const zoneLabel = getZoneLabel(p.availabilityZone);
                return (
                  <tr key={p.address || i} style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)" }}>
                    <td style={{ padding: "11px 18px", width: 30 }}>
                      <div style={{
                        width: 9, height: 9, borderRadius: "50%",
                        background: isH ? "#22c55e" : isUnknown ? "#9ca3af" : "#ef4444",
                        boxShadow: isH ? "0 0 6px #22c55e88" : "none",
                      }} />
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{p.addressShort}</span>
                      {p.geo?.city && (
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                          {p.geo.city}{p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                        {zoneLabel}
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
                      {p.netAddress && (
                        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1, fontFamily: "monospace" }}>
                          {p.netAddress}
                        </div>
                      )}
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