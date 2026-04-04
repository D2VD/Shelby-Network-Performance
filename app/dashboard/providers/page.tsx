"use client";
/**
 * app/dashboard/providers/page.tsx — v6.0
 * FIX: BLS key display đầy đủ + hover tooltip trên row
 * FIX: Map dùng react-simple-maps (theo guide.txt)
 */

import { useState, useEffect, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { ProviderMap } from "@/components/provider-map";
import { TestnetBanner } from "@/components/testnet-banner";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

// ── Badges ────────────────────────────────────────────────────────────────────
type Variant = "green" | "red" | "yellow" | "gray";

const BADGE = {
  green:  { bg: "#f0fdf4", color: "#16a34a" },
  red:    { bg: "#fef2f2", color: "#dc2626" },
  yellow: { bg: "#fffbeb", color: "#d97706" },
  gray:   { bg: "#f9fafb", color: "#6b7280" },
};

function Badge({ label, variant }: { label: string; variant: Variant }) {
  const s = BADGE[variant];
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

// ── BLS Key with expand toggle ─────────────────────────────────────────────────
function BlsKey({ full, short }: { full: string; short: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(full).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!full && !short) return <span style={{ color: "#d1d5db" }}>—</span>;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        title={full || short}
        style={{ fontFamily: "monospace", fontSize: 10, color: "#9ca3af", cursor: "pointer" }}
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? (full || short).slice(0, 32) + "…" : (short || full.slice(0, 10) + "…")}
      </span>
      <button
        onClick={copy}
        title="Copy full BLS key"
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 10, color: copied ? "#22c55e" : "#9ca3af", padding: "0 2px",
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

// ── Row hover tooltip ─────────────────────────────────────────────────────────
function SPRow({ p, idx }: { p: StorageProvider; idx: number }) {
  const [hovered, setHovered] = useState(false);
  const zoneMeta = ZONE_META[p.availabilityZone];
  const isHealthy = p.health === "Healthy";

  return (
    <tr
      style={{
        borderBottom: "1px solid #f3f4f6",
        background: hovered ? "#f0f7ff" : (idx % 2 === 0 ? "#fff" : "#fafafa"),
        transition: "background 0.1s",
        position: "relative",
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
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#111827", fontWeight: 600 }}>
          {p.addressShort}
        </div>
        {p.geo?.city && (
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
            {p.geo.city}{p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}
          </div>
        )}
        {/* On hover: show full address */}
        {hovered && p.address && (
          <div style={{ fontSize: 9, fontFamily: "monospace", color: "#d1d5db", marginTop: 2 }}>
            {p.address}
          </div>
        )}
      </td>

      {/* Zone */}
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 11, color: "#374151", fontWeight: 500 }}>
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
          ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{p.capacityTiB.toFixed(2)} TiB</span>
          : <span style={{ color: "#d1d5db" }}>—</span>
        }
      </td>

      {/* BLS Key — với expand + copy */}
      <td style={{ padding: "10px 16px" }}>
        <BlsKey full={p.fullBlsKey ?? p.blsKey ?? ""} short={p.blsKey ? p.blsKey.slice(0, 10) + "…" : ""} />
        {/* On hover: show net address */}
        {hovered && p.netAddress && (
          <div style={{ fontSize: 9, fontFamily: "monospace", color: "#d1d5db", marginTop: 2 }}>
            {p.netAddress}
          </div>
        )}
      </td>
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, background: "#e5e7eb", borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}>
      {[
        { label: "Total SPs",     value: providers.length,                                           color: "#2563eb" },
        { label: "Healthy",       value: healthy,                                                     color: "#16a34a" },
        { label: "Active",        value: active,                                                      color: "#0891b2" },
        { label: "Zones",         value: zones,                                                       color: "#8b5cf6" },
        { label: "Total Capacity",value: totalTiB > 0 ? `${totalTiB.toFixed(0)} TiB` : "—",         color: "#d97706", isStr: true },
      ].map(s => (
        <div key={s.label} style={{ background: "#fff", padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontFamily: "monospace", fontSize: s.isStr ? 18 : 22, fontWeight: 700, color: s.color, letterSpacing: -0.5 }}>
            {s.value}
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "calc(100vh - 120px)" }}>

      {/* ── MAP ── */}
      <div style={{ background: "#060d1a", position: "relative", height: "55vh", minHeight: 320 }}>
        {/* Header overlay */}
        <div style={{ position: "absolute", top: 12, left: 16, zIndex: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            background: "rgba(6,14,28,0.9)", border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 8, padding: "4px 12px", fontSize: 11, color: "#94a3b8",
            backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            {loading ? "Loading…" : `${providers.filter(p => p.health === "Healthy").length} nodes online`}
          </div>
          {lastAt && (
            <div style={{ background: "rgba(6,14,28,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "3px 9px", fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>
              {lastAt.toLocaleTimeString()}
            </div>
          )}
        </div>

        {loading && providers.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13, flexDirection: "column", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid #1e3a5f", borderTopColor: "#06b6d4", animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            Loading providers…
          </div>
        ) : (
          <ProviderMap providers={providers} />
        )}
      </div>

      {/* ── STATS BAR ── */}
      <div style={{ padding: "16px 24px", background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
        <SummaryBar providers={providers} />
      </div>

      {/* ── SP TABLE ── */}
      <div style={{ flex: 1, background: "#fff", padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>Storage Providers</h2>
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "3px 0 0", fontFamily: "monospace" }}>
              {filtered.length} of {providers.length} providers · Hover row for details · Auto-refresh 60s
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", gap: 2, background: "#f4f4f4", borderRadius: 8, padding: 2 }}>
              {(["all", "healthy", "faulty"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 11,
                  fontWeight: filter === f ? 600 : 400,
                  background: filter === f ? "#fff" : "transparent",
                  color: filter === f ? "#111827" : "#9ca3af",
                  boxShadow: filter === f ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  cursor: "pointer", textTransform: "capitalize",
                }}>{f}</button>
              ))}
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: 11, color: "#374151", background: "#fff", cursor: "pointer", outline: "none" }}>
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>
            <button onClick={fetchProviders} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff", fontSize: 11, color: "#6b7280", cursor: "pointer" }}>
              ⟳ Refresh
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#dc2626" }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
                {["", "Address", "Zone", "Health", "State", "Capacity", "BLS Key"].map((h, i) => (
                  <th key={i} style={{
                    padding: i === 0 ? "9px 16px" : "9px 12px",
                    textAlign: i === 5 ? "right" : "left",
                    fontSize: 10, fontWeight: 600, color: "#9ca3af",
                    textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "48px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
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