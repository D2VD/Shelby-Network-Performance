"use client";
/**
 * app/dashboard/providers/page.tsx — v3.0
 * Layout: Map (70vh) trên / SP info grid dưới
 * Design: light mode, giống Celestia/Solana explorer
 */

import { useState, useEffect, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { ProviderMap } from "@/components/provider-map";
import { TestnetBanner } from "@/components/testnet-banner";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

// ── SP health / state badge ────────────────────────────────────────────────────
function Badge({ label, variant }: { label: string; variant: "green" | "red" | "yellow" | "gray" }) {
  const colors = {
    green:  { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
    red:    { bg: "#fef2f2", color: "#dc2626", dot: "#ef4444" },
    yellow: { bg: "#fffbeb", color: "#d97706", dot: "#f59e0b" },
    gray:   { bg: "#f4f4f4", color: "#6b7280", dot: "#9ca3af" },
  };
  const c = colors[variant];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot }} />
      {label}
    </span>
  );
}

function healthVariant(h: string): "green" | "red" {
  return h === "Healthy" ? "green" : "red";
}

function stateVariant(s: string): "green" | "yellow" | "gray" | "red" {
  if (s === "Active")     return "green";
  if (s === "Waitlisted") return "yellow";
  if (s === "Frozen")     return "gray";
  if (s === "Leaving")    return "yellow";
  return "gray";
}

// ── SP detail row ──────────────────────────────────────────────────────────────
function SPRow({ p, idx }: { p: StorageProvider; idx: number }) {
  const zoneMeta = ZONE_META[p.availabilityZone];
  return (
    <tr style={{
      borderBottom: "1px solid #f3f4f6",
      background: idx % 2 === 0 ? "#fff" : "#fafafa",
      transition: "background 0.1s",
    }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f0f7ff")}
      onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 0 ? "#fff" : "#fafafa")}
    >
      <td style={{ padding: "10px 16px", width: 28 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: p.health === "Healthy" ? "#22c55e" : "#ef4444",
          boxShadow: p.health === "Healthy" ? "0 0 6px #22c55e88" : "none",
        }} />
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#111827", fontWeight: 600 }}>
          {p.addressShort}
        </div>
        {p.geo?.city && (
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
            {p.geo.city}{p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}
          </div>
        )}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 11, color: "#374151", fontWeight: 500 }}>
          {zoneMeta?.label ?? p.availabilityZone}
        </div>
      </td>
      <td style={{ padding: "10px 12px" }}>
        <Badge label={p.health} variant={healthVariant(p.health)} />
      </td>
      <td style={{ padding: "10px 12px" }}>
        <Badge label={p.state} variant={stateVariant(p.state)} />
      </td>
      <td style={{ padding: "10px 12px", textAlign: "right" }}>
        {p.capacityTiB != null
          ? <span style={{ fontFamily: "monospace", fontSize: 12, color: "#374151" }}>
              {p.capacityTiB.toFixed(2)} TiB
            </span>
          : <span style={{ color: "#d1d5db" }}>—</span>
        }
      </td>
      <td style={{ padding: "10px 16px" }}>
        {p.blsKey && (
          <span style={{
            fontFamily: "monospace", fontSize: 10, color: "#9ca3af",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "block", maxWidth: 120,
          }} title={p.blsKey}>
            {p.blsKey.slice(0, 10)}…
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Summary stats bar ──────────────────────────────────────────────────────────
function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const healthy    = providers.filter(p => p.health  === "Healthy").length;
  const active     = providers.filter(p => p.state   === "Active").length;
  const zones      = new Set(providers.map(p => p.availabilityZone)).size;
  const totalTiB   = providers.reduce((s, p) => s + (p.capacityTiB ?? 0), 0);

  const stats = [
    { label: "Total SPs",    value: providers.length, sub: "providers",    color: "#2563eb" },
    { label: "Healthy",      value: healthy,           sub: `of ${providers.length}`, color: "#16a34a" },
    { label: "Active",       value: active,            sub: "state",        color: "#0891b2" },
    { label: "Zones",        value: zones,             sub: "regions",      color: "#8b5cf6" },
    { label: "Total Capacity",value: totalTiB > 0 ? `${totalTiB.toFixed(0)} TiB` : "—",
      sub: "raw storage", color: "#d97706", isString: true },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      gap: 1,
      background: "#e5e7eb",
      borderRadius: 12,
      overflow: "hidden",
      border: "1px solid #e5e7eb",
    }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: "#fff",
          padding: "14px 18px",
          textAlign: "center",
        }}>
          <div style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: s.isString ? 18 : 24,
            fontWeight: 700,
            color: s.color,
            letterSpacing: -0.5,
            lineHeight: 1.1,
          }}>
            {s.value}
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
  const [providers, setProviders]   = useState<StorageProvider[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [error,     setError]       = useState<string | null>(null);
  const [lastAt,    setLastAt]      = useState<Date | null>(null);
  const [filter,    setFilter]      = useState<"all" | "healthy" | "faulty">("all");
  const [sortBy,    setSortBy]      = useState<"zone" | "health" | "state">("zone");

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/providers?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as any;
      if (d.ok && d.data?.providers) {
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

  // Filter + sort
  const filtered = providers
    .filter(p => {
      if (filter === "healthy") return p.health === "Healthy";
      if (filter === "faulty")  return p.health !== "Healthy";
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "zone")   return (a.availabilityZone ?? "").localeCompare(b.availabilityZone ?? "");
      if (sortBy === "health") return a.health.localeCompare(b.health);
      if (sortBy === "state")  return a.state.localeCompare(b.state);
      return 0;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "calc(100vh - 60px)" }}>

      {/* ── MAP SECTION ──────────────────────────────────────────────────── */}
      <div style={{
        background: "#f8fafc",
        borderBottom: "1px solid #e5e7eb",
        padding: "0",
        position: "relative",
      }}>
        {/* Map header overlay */}
        <div style={{
          position: "absolute", top: 12, left: 16, zIndex: 10,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            background: "rgba(255,255,255,0.95)",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "5px 12px",
            display: "flex", alignItems: "center", gap: 6,
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "#22c55e",
              boxShadow: "0 0 6px #22c55e",
              display: "inline-block",
              animation: "live-pulse 2s ease-in-out infinite",
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", fontFamily: "monospace" }}>
              {loading ? "Loading…" : `${providers.filter(p => p.health === "Healthy").length} nodes online`}
            </span>
          </div>

          {lastAt && (
            <div style={{
              background: "rgba(255,255,255,0.9)",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "3px 9px",
              fontSize: 10,
              color: "#9ca3af",
              fontFamily: "monospace",
            }}>
              {lastAt.toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Sovereignty badge */}
        <div style={{
          position: "absolute", top: 12, right: 16, zIndex: 10,
          background: "rgba(255,255,255,0.95)",
          border: "1px solid rgba(217,119,6,0.3)",
          borderRadius: 8,
          padding: "4px 10px",
          fontSize: 9,
          color: "#92400e",
          fontFamily: "monospace",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
        </div>

        {loading && providers.length === 0 ? (
          <div style={{
            height: 340,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#f0f7ff",
            color: "#9ca3af", fontSize: 13, fontFamily: "monospace",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 32, height: 32, border: "2px solid #e5e7eb",
                borderTop: "2px solid #2563eb", borderRadius: "50%",
                margin: "0 auto 12px",
                animation: "spin 1s linear infinite",
              }} />
              Loading providers…
            </div>
          </div>
        ) : (
          <ProviderMap providers={providers} onProviderClick={undefined} />
        )}
      </div>

      {/* ── STATS BAR ────────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 24px", background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
        <SummaryBar providers={providers} />
      </div>

      {/* ── PROVIDER TABLE ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, background: "#fff", padding: "20px 24px" }}>

        {/* Table header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 14, flexWrap: "wrap", gap: 10,
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>
              Storage Providers
            </h2>
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "3px 0 0", fontFamily: "monospace" }}>
              {filtered.length} of {providers.length} providers · Auto-refresh 60s
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Filter buttons */}
            <div style={{
              display: "flex", gap: 2, background: "#f4f4f4",
              borderRadius: 8, padding: 2,
            }}>
              {(["all", "healthy", "faulty"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none",
                  fontSize: 11, fontWeight: 500, cursor: "pointer",
                  background: filter === f ? "#fff" : "transparent",
                  color: filter === f ? "#111827" : "#9ca3af",
                  boxShadow: filter === f ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.1s",
                  textTransform: "capitalize",
                }}>
                  {f}
                </button>
              ))}
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              style={{
                padding: "5px 10px", borderRadius: 7, border: "1px solid #e5e7eb",
                fontSize: 11, color: "#374151", background: "#fff",
                cursor: "pointer", outline: "none",
              }}
            >
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>

            {/* Refresh */}
            <button onClick={fetchProviders} style={{
              padding: "5px 12px", borderRadius: 7,
              border: "1px solid #e5e7eb", background: "#fff",
              fontSize: 11, color: "#6b7280", cursor: "pointer",
            }}>
              ⟳ Refresh
            </button>
          </div>
        </div>

        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 8, padding: "10px 14px", marginBottom: 12,
            fontSize: 12, color: "#dc2626",
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Table */}
        <div style={{ borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
                {["", "Address", "Zone", "Health", "State", "Capacity", "BLS Key"].map((h, i) => (
                  <th key={i} style={{
                    padding: "9px 12px",
                    textAlign: i === 5 ? "right" : "left",
                    fontSize: 10, fontWeight: 600,
                    color: "#9ca3af",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    whiteSpace: "nowrap",
                    ...(i === 0 ? { width: 28, padding: "9px 16px" } : {}),
                    ...(i === 6 ? { padding: "9px 16px" } : {}),
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{
                    padding: "48px 16px", textAlign: "center",
                    color: "#9ca3af", fontSize: 13,
                  }}>
                    {loading ? "Loading providers…" : "No providers found"}
                  </td>
                </tr>
              ) : (
                filtered.map((p, i) => <SPRow key={p.address} p={p} idx={i} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}