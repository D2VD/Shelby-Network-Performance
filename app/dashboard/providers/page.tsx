"use client";
/**
 * app/dashboard/providers/page.tsx — v5.0
 *
 * - MapLibre GL JS dark map (thay SVG cũ)
 * - Live stats panel: activeBlobs, pendingOrFailed, deletedBlobs, emptyRecords
 * - Chart buttons → link sang /dashboard/charts
 * - SP table giữ nguyên
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useNetwork } from "@/components/network-context";
import { ProviderMap } from "@/components/provider-map";
import { TestnetBanner } from "@/components/testnet-banner";
import type { StorageProvider } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveSnap {
  ts: string; tsMs: number;
  activeBlobs: number; pendingOrFailed: number; deletedBlobs: number; emptyRecords: number;
  totalBlobEvents: number; totalStorageBytes: number; totalStorageGB: number;
  storageProviders: number; placementGroups: number; slices: number;
  blockHeight: number; ledgerVersion: number; method: string; cacheAge?: number;
}

type FilterMode = "all" | "healthy" | "faulty";
type SortMode   = "zone" | "health" | "state";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// Animated counter
function useCountUp(target: number | null, duration = 700) {
  const [val, setVal] = useState(target ?? 0);
  const raf = useRef(0);
  const from = useRef(0);
  const start = useRef(0);
  useEffect(() => {
    if (target == null) return;
    from.current  = val;
    start.current = performance.now();
    cancelAnimationFrame(raf.current);
    const tick = (now: number) => {
      const t = Math.min((now - start.current) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from.current + (target - from.current) * e));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]); // eslint-disable-line
  return val;
}

// ─── SP Table Row ─────────────────────────────────────────────────────────────

function SPRow({ p, idx }: { p: StorageProvider; idx: number }) {
  const isHealthy = p.health === "Healthy";
  return (
    <tr style={{ background: idx % 2 === 0 ? "transparent" : "rgba(0,0,0,0.015)" }}>
      <td style={{ padding: "10px 16px", width: 28 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: isHealthy ? "#22c55e" : "#ef4444",
          boxShadow: isHealthy ? "0 0 6px #22c55e88" : "none",
        }} />
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "#374151" }}>
        {p.addressShort}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280" }}>
        {p.availabilityZone?.replace("dc_", "").replace("_", " ").toUpperCase() ?? "—"}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5,
          background: isHealthy ? "#f0fdf4" : "#fef2f2",
          color:      isHealthy ? "#16a34a" : "#dc2626",
        }}>
          {isHealthy ? "Healthy" : "Faulty"}
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: "#9ca3af" }}>
        {p.state ?? "Active"}
      </td>
      <td style={{ padding: "10px 12px", fontSize: 12, color: "#374151", textAlign: "right" }}>
        {p.capacityTiB != null ? `${p.capacityTiB.toFixed(1)} TiB` : "—"}
      </td>
      <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 10, color: "#9ca3af", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.blsKey ? `${p.blsKey.slice(0, 12)}…` : "—"}
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const { network } = useNetwork();

  // ── Providers ──
  const [providers,  setProviders]  = useState<StorageProvider[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [lastAt,     setLastAt]     = useState<Date | null>(null);
  const [filter,     setFilter]     = useState<FilterMode>("all");
  const [sortBy,     setSortBy]     = useState<SortMode>("zone");

  // ── Live stats ──
  const [snap,       setSnap]       = useState<LiveSnap | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval>>(null!);

  // Animated counters
  const animActive  = useCountUp(snap?.activeBlobs      ?? null);
  const animPending = useCountUp(snap?.pendingOrFailed  ?? null);
  const animDeleted = useCountUp(snap?.deletedBlobs     ?? null);
  const animEmpty   = useCountUp(snap?.emptyRecords     ?? null);
  const animEvents  = useCountUp(snap?.totalBlobEvents  ?? null);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/providers?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as any;
      setProviders(j.data?.providers ?? []);
      setLastAt(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [network]);

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/stats/live?network=${network}`);
      if (!res.ok) return;
      const j = await res.json() as any;
      setSnap(j.data ?? j);
    } catch {}
    finally { setStatsLoading(false); }
  }, [network]);

  useEffect(() => {
    setLoading(true);
    setProviders([]);
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  useEffect(() => {
    setStatsLoading(true);
    fetchLive();
    statsIntervalRef.current = setInterval(fetchLive, 30_000);
    return () => clearInterval(statsIntervalRef.current);
  }, [fetchLive]);

  // Filter + sort
  const filtered = providers
    .filter(p => filter === "all" ? true : filter === "healthy" ? p.health === "Healthy" : p.health !== "Healthy")
    .sort((a, b) => {
      if (sortBy === "zone")   return (a.availabilityZone ?? "").localeCompare(b.availabilityZone ?? "");
      if (sortBy === "health") return a.health.localeCompare(b.health);
      if (sortBy === "state")  return (a.state ?? "").localeCompare(b.state ?? "");
      return 0;
    });

  const totalBlobs = snap
    ? snap.activeBlobs + snap.pendingOrFailed + snap.deletedBlobs + snap.emptyRecords
    : 0;

  if (network === "testnet") return <TestnetBanner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{`
        @keyframes live-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: -0.5, color: "var(--gray-900)" }}>
            Network Map
          </h1>
          <p style={{ fontSize: 13, color: "var(--gray-400)", margin: "4px 0 0", fontFamily: "var(--font-mono)" }}>
            {providers.length} Storage Providers · auto-refresh 60s
            {lastAt && ` · ${lastAt.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={fetchProviders} style={{
            padding: "7px 14px", borderRadius: 8, border: "1px solid var(--gray-200)",
            background: "#fff", fontSize: 12, color: "var(--gray-600)", cursor: "pointer",
          }}>
            ⟳ Refresh
          </button>
          <Link href="/dashboard/charts" style={{
            padding: "7px 14px", borderRadius: 8,
            background: "var(--net-color, #2563eb)", color: "#fff",
            fontSize: 12, fontWeight: 600, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 5,
          }}>
            ▲ View Charts
          </Link>
        </div>
      </div>

      {/* ── Live Stats Bar ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
        gap: 10,
      }}>
        {[
          { label: "Active Blobs",    value: statsLoading ? "…" : fmt(animActive),  color: "#22c55e",
            sub: totalBlobs ? `${((snap!.activeBlobs / totalBlobs) * 100).toFixed(1)}% of total` : undefined, pulse: true },
          { label: "Pending/Failed",  value: statsLoading ? "…" : fmt(animPending), color: snap && snap.pendingOrFailed > 50000 ? "#f59e0b" : undefined },
          { label: "Deleted",         value: statsLoading ? "…" : fmt(animDeleted), color: "#ef4444" },
          { label: "Empty Records",   value: statsLoading ? "…" : fmt(animEmpty),   color: "#6b7280" },
          { label: "Blob Events",     value: statsLoading ? "…" : fmt(animEvents)   },
          { label: "Storage",         value: statsLoading ? "…" : snap ? `${snap.totalStorageGB.toFixed(1)} GB` : "—" },
        ].map(({ label, value, color, sub, pulse }) => (
          <div key={label} style={{
            background: "#fff", border: "1px solid var(--gray-200)",
            borderRadius: 10, padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 2, position: "relative",
          }}>
            {pulse && snap && (
              <span style={{
                position: "absolute", top: 10, right: 10,
                width: 7, height: 7, borderRadius: "50%", background: "#22c55e",
                animation: "live-pulse 2s ease-in-out infinite",
              }} />
            )}
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {label}
            </span>
            <span style={{ fontSize: 20, fontWeight: 800, color: color ?? "var(--gray-900)", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {value}
            </span>
            {sub && <span style={{ fontSize: 10, color: "var(--gray-400)" }}>{sub}</span>}
          </div>
        ))}
      </div>

      {/* ── Blob Composition Bar ── */}
      {snap && totalBlobs > 0 && (
        <div style={{
          background: "#fff", border: "1px solid var(--gray-200)",
          borderRadius: 10, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Blob Composition
          </span>
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1 }}>
            {[
              { v: snap.activeBlobs,     c: "#22c55e" },
              { v: snap.pendingOrFailed, c: "#f59e0b" },
              { v: snap.deletedBlobs,    c: "#ef4444" },
              { v: snap.emptyRecords,    c: "#d1d5db" },
            ].map(({ v, c }, i) => (
              <div key={i} style={{
                width: `${(v / totalBlobs * 100).toFixed(2)}%`,
                background: c, transition: "width .6s ease", minWidth: v > 0 ? 2 : 0,
              }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { label: "Active",  v: snap.activeBlobs,     c: "#22c55e" },
              { label: "Pending", v: snap.pendingOrFailed, c: "#f59e0b" },
              { label: "Deleted", v: snap.deletedBlobs,    c: "#ef4444" },
              { label: "Empty",   v: snap.emptyRecords,    c: "#9ca3af" },
            ].map(({ label, v, c }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: c, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "var(--gray-400)" }}>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gray-700)", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Map ── */}
      <div style={{
        borderRadius: 12, overflow: "hidden",
        height: 380, background: "#060d1a",
        border: "1px solid rgba(6,182,212,0.15)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
        position: "relative",
      }}>
        {/* Live nodes badge */}
        <div style={{
          position: "absolute", top: 12, left: 12, zIndex: 10,
          background: "rgba(6,14,28,0.85)", border: "1px solid rgba(34,197,94,0.3)",
          borderRadius: 8, padding: "4px 12px", fontSize: 11, color: "#94a3b8",
          backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "live-pulse 2s ease-in-out infinite" }} />
          {loading ? "Loading…" : `${providers.filter(p => p.health === "Healthy").length} nodes online`}
        </div>

        {loading && providers.length === 0 ? (
          <div style={{
            height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 12, color: "#475569", fontSize: 13,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              border: "2px solid #1e3a5f", borderTopColor: "#06b6d4",
              animation: "spin 1s linear infinite",
            }} />
            Loading providers…
          </div>
        ) : (
          <ProviderMap providers={providers} />
        )}
      </div>

      {/* ── On-chain info strip ── */}
      {snap && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8,
        }}>
          {[
            { label: "Storage Providers", value: snap.storageProviders },
            { label: "Placement Groups",  value: snap.placementGroups  },
            { label: "Slices",            value: snap.slices           },
            { label: "Block Height",      value: snap.blockHeight      },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: "#fff", border: "1px solid var(--gray-200)",
              borderRadius: 8, padding: "10px 12px", textAlign: "center",
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--gray-900)", fontVariantNumeric: "tabular-nums" }}>
                {value?.toLocaleString() ?? "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--gray-400)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Summary bar ── */}
      <div style={{
        display: "flex", gap: 20, flexWrap: "wrap",
        padding: "12px 16px", background: "#fff",
        border: "1px solid var(--gray-200)", borderRadius: 10,
        fontSize: 12, color: "var(--gray-500)",
      }}>
        {[
          { label: "Total", value: providers.length },
          { label: "Healthy", value: providers.filter(p => p.health === "Healthy").length },
          { label: "Faulty",  value: providers.filter(p => p.health !== "Healthy").length },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: "flex", gap: 6 }}>
            <span>{label}:</span>
            <strong style={{ color: "var(--gray-800)" }}>{value}</strong>
          </div>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          {snap?.method && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
              background: "rgba(6,182,212,0.08)", color: "#0891b2",
            }}>
              {snap.method}
            </span>
          )}
          {snap?.ts && (
            <span style={{ fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>
              {new Date(snap.ts).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ── SP Table ── */}
      <div style={{ background: "#fff", border: "1px solid var(--gray-200)", borderRadius: 12, overflow: "hidden" }}>
        {/* Table header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--gray-100)", flexWrap: "wrap", gap: 10,
        }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--gray-900)", margin: 0 }}>Storage Providers</h2>
            <p style={{ fontSize: 11, color: "var(--gray-400)", margin: "2px 0 0", fontFamily: "var(--font-mono)" }}>
              {filtered.length} of {providers.length} providers
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", gap: 2, background: "var(--gray-100)", borderRadius: 8, padding: 2 }}>
              {(["all", "healthy", "faulty"] as FilterMode[]).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: "4px 11px", borderRadius: 6, border: "none", fontSize: 11,
                  fontWeight: filter === f ? 600 : 400,
                  background: filter === f ? "#fff" : "transparent",
                  color: filter === f ? "var(--gray-800)" : "var(--gray-400)",
                  boxShadow: filter === f ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  cursor: "pointer", textTransform: "capitalize",
                }}>{f}</button>
              ))}
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortMode)} style={{
              padding: "5px 10px", borderRadius: 7, border: "1px solid var(--gray-200)",
              fontSize: 11, color: "var(--gray-700)", background: "#fff", cursor: "pointer", outline: "none",
            }}>
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>
            <button onClick={fetchProviders} style={{
              padding: "5px 11px", borderRadius: 7, border: "1px solid var(--gray-200)",
              background: "#fff", fontSize: 11, color: "var(--gray-500)", cursor: "pointer",
            }}>⟳</button>
          </div>
        </div>

        {error && (
          <div style={{
            background: "#fef2f2", borderBottom: "1px solid #fecaca",
            padding: "10px 20px", fontSize: 12, color: "#dc2626",
          }}>⚠ {error}</div>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--gray-50)", borderBottom: "1px solid var(--gray-200)" }}>
              {["", "Address", "Zone", "Health", "State", "Capacity", "BLS Key"].map((h, i) => (
                <th key={i} style={{
                  padding: i === 0 ? "8px 16px" : "8px 12px",
                  textAlign: i === 5 ? "right" : "left",
                  fontSize: 10, fontWeight: 600, color: "var(--gray-400)",
                  textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "40px 16px", textAlign: "center", color: "var(--gray-300)", fontSize: 13 }}>
                  {loading ? "Loading providers…" : "No providers found"}
                </td>
              </tr>
            ) : (
              filtered.map((p, i) => <SPRow key={p.address || i} p={p} idx={i} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}