"use client";
// components/live-stats-panel.tsx — v6.0
// Fixes:
//  - Light theme (var(--bg-card), var(--text-primary) etc.)
//  - Full numbers (toLocaleString, not fmtN/M abbreviations)
//  - Per-series min/max for Pending+Deleted chart (show fluctuation)
//  - Tooltip only shows when mouse is inside chart SVG
//  - Click on chart point shows tooltip (recharts default supports this)

import { useEffect, useRef, useState, useCallback } from "react";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useTheme } from "./theme-context";

// ─── Types ────────────────────────────────────────────────────────────────────
interface NetworkSnapshot {
  ts:                string;
  tsMs:              number;
  network:           string;
  activeBlobs:       number;
  pendingOrFailed:   number;
  deletedBlobs:      number;
  emptyRecords:      number;
  totalBlobEvents:   number;
  totalStorageBytes: number;
  totalStorageGB:    number;
  totalStorageGiB:   number;
  storageProviders:  number;
  placementGroups:   number;
  slices:            number;
  blockHeight:       number;
  ledgerVersion:     number;
  method:            string;
  cacheAge?:         number;
}

interface TimeseriesData {
  series: NetworkSnapshot[];
  delta: {
    newBlobs:       number;
    deletedBlobs:   number;
    newEvents:      number;
    storageDeltaGB: number;
  };
  count: number;
}

type TimeRange = "1h" | "24h" | "7d" | "30d";

// ─── Formatters — FULL numbers (no M/K abbreviations) ─────────────────────────
function fmtFull(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}
function fmtGB(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  return `${(bytes / 1e9).toFixed(2)} GB`;
}
function fmtDate(tsMs: number, range: TimeRange): string {
  const d = new Date(tsMs);
  if (range === "1h" || range === "24h")
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`;
}

// Animated counter
function useAnimatedValue(target: number | null, duration = 600) {
  const [display, setDisplay] = useState(target ?? 0);
  const rafRef   = useRef<number>(0);
  const startRef = useRef<number>(0);
  const fromRef  = useRef<number>(0);

  useEffect(() => {
    if (target == null) return;
    fromRef.current  = display;
    startRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);
    const animate = (now: number) => {
      const p = Math.min((now - startRef.current) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(fromRef.current + (target - fromRef.current) * e));
      if (p < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]); // eslint-disable-line

  return display;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, pulse }: {
  label: string; value: string; sub?: string; accent?: string; pulse?: boolean;
}) {
  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      position: "relative",
      overflow: "hidden",
      transition: "background 0.2s",
    }}>
      {pulse && (
        <span style={{
          position: "absolute", top: 12, right: 12,
          width: 8, height: 8, borderRadius: "50%",
          background: "#22c55e",
          boxShadow: "0 0 0 0 rgba(34,197,94,0.4)",
          animation: "pulse-dot 2s infinite",
        }} />
      )}
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-muted)", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: 700, color: accent ?? "var(--text-primary)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1, fontFamily: "var(--font-mono)" }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</span>}
    </div>
  );
}

function DeltaBadge({ value, suffix = "", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  if (value === 0) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>+0{suffix}</span>;
  const positive = invert ? value < 0 : value > 0;
  return (
    <span style={{
      fontSize: 12, fontWeight: 600,
      color: positive ? "#22c55e" : "#ef4444",
      background: positive ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
      padding: "2px 8px", borderRadius: 6,
    }}>
      {value > 0 ? "+" : ""}{value.toLocaleString("en-US")}{suffix}
    </span>
  );
}

function BlobBreakdownBar({ active, pending, deleted, empty }: {
  active: number; pending: number; deleted: number; empty: number;
}) {
  const total = active + pending + deleted + empty;
  if (total === 0) return null;
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
        <div style={{ width: pct(active),  background: "#22c55e", transition: "width 0.6s ease" }} title={`Active: ${active.toLocaleString("en-US")}`} />
        <div style={{ width: pct(pending), background: "#f59e0b", transition: "width 0.6s ease" }} title={`Pending: ${pending.toLocaleString("en-US")}`} />
        <div style={{ width: pct(deleted), background: "#ef4444", transition: "width 0.6s ease" }} title={`Deleted: ${deleted.toLocaleString("en-US")}`} />
        <div style={{ width: pct(empty),   background: "#6b7280", transition: "width 0.6s ease" }} title={`Empty: ${empty.toLocaleString("en-US")}`} />
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[
          { label: "Active",  value: active,  color: "#22c55e" },
          { label: "Pending", value: pending, color: "#f59e0b" },
          { label: "Deleted", value: deleted, color: "#ef4444" },
          { label: "Empty",   value: empty,   color: "#6b7280" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-mono)" }}>
              {value.toLocaleString("en-US")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Custom tooltip — full numbers, theme-aware
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "10px 14px", fontSize: 12,
      boxShadow: "0 4px 12px var(--shadow-color)",
      pointerEvents: "none",
    }}>
      <div style={{ color: "var(--text-muted)", marginBottom: 6 }}>
        {label ? new Date(label).toLocaleString() : ""}
      </div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: p.color }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            {typeof p.value === "number"
              ? p.dataKey === "storageGB"
                ? `${p.value.toFixed(2)} GB`
                : p.value.toLocaleString("en-US")
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Chart wrapper with isMouseInside guard ────────────────────────────────────
function ChartContainer({ children, height = 140 }: { children: React.ReactNode; height?: number }) {
  const [inside, setInside] = useState(false);
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setInside(true)}
      onMouseLeave={() => setInside(false)}
    >
      {/* Invisible overlay that blocks tooltip when mouse is outside */}
      {!inside && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10 }} />
      )}
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LiveStatsPanel({ network = "shelbynet" }: { network?: string }) {
  const { isDark } = useTheme();
  const [snap,    setSnap]    = useState<NetworkSnapshot | null>(null);
  const [tsData,  setTsData]  = useState<TimeseriesData | null>(null);
  const [range,   setRange]   = useState<TimeRange>("24h");
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null!);

  const animActive  = useAnimatedValue(snap?.activeBlobs      ?? null);
  const animStorage = useAnimatedValue(snap?.totalStorageBytes ?? null);
  const animEvents  = useAnimatedValue(snap?.totalBlobEvents   ?? null);
  const animPending = useAnimatedValue(snap?.pendingOrFailed   ?? null);
  const animDeleted = useAnimatedValue(snap?.deletedBlobs      ?? null);

  const fetchLive = useCallback(async () => {
    try {
      const r = await fetch(`/api/network/stats/live?network=${network}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const data = j.data ?? j;
      if (data) { setSnap(data); setLastUpdate(new Date()); setError(null); }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [network]);

  const fetchTimeseries = useCallback(async (r: TimeRange) => {
    try {
      const resolution = r === "1h" ? "5m" : r === "24h" ? "5m" : "1h";
      const res = await fetch(`/api/network/stats/timeseries?network=${network}&resolution=${resolution}&range=${r}`);
      if (!res.ok) return;
      const j = await res.json();
      if (j.data) setTsData(j.data);
    } catch {}
  }, [network]);

  useEffect(() => {
    fetchLive();
    fetchTimeseries(range);
    intervalRef.current = setInterval(fetchLive, 30_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchLive]);

  useEffect(() => { fetchTimeseries(range); }, [range, fetchTimeseries]);

  const chartData = (tsData?.series ?? []).map(s => ({
    tsMs:         s.tsMs,
    activeBlobs:  s.activeBlobs,
    deletedBlobs: s.deletedBlobs,
    pendingBlobs: s.pendingOrFailed,
    storageGB:    s.totalStorageGB,
    events:       s.totalBlobEvents,
    blockHeight:  s.blockHeight,
  }));

  // Per-series domain for Pending+Deleted — show fluctuation even when small
  const pendingVals  = chartData.map(d => d.pendingBlobs);
  const deletedVals  = chartData.map(d => d.deletedBlobs);
  const combinedPD   = [...pendingVals, ...deletedVals].filter(v => v > 0);
  const pdMin        = combinedPD.length ? Math.min(...combinedPD) * 0.95 : 0;
  const pdMax        = combinedPD.length ? Math.max(...combinedPD) * 1.05 : 1;

  const RANGES: TimeRange[] = ["1h", "24h", "7d", "30d"];
  const gridColor = isDark ? "#1e3a5f" : "#e5e7eb";
  const tickFill  = "var(--text-muted)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        @keyframes pulse-dot {
          0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
          70%  { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .live-range-btn {
          padding: 5px 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .live-range-btn:hover { background: var(--border); color: var(--text-primary); }
        .live-range-btn.active {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%", background: "#22c55e",
            boxShadow: "0 0 0 0 rgba(34,197,94,0.4)",
            animation: "pulse-dot 2s infinite",
          }} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
            Live Network View
          </h2>
          {snap?.method && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 8px",
              borderRadius: 4, background: "var(--accent-bg)",
              color: "var(--accent)", letterSpacing: "0.06em",
            }}>
              {snap.method}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {lastUpdate && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchLive}
            style={{
              padding: "5px 14px", borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent", color: "var(--text-muted)",
              fontSize: 12, cursor: "pointer",
            }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "12px 16px", borderRadius: 8,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          color: "#ef4444", fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Primary Metrics — FULL NUMBERS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <StatCard label="Active Blobs"    value={loading ? "…" : fmtFull(animActive)}  sub={snap ? `${pct(snap.activeBlobs, total(snap))}% of total` : undefined} accent="#22c55e" pulse />
        <StatCard label="Storage Used"    value={loading ? "…" : fmtGB(animStorage)}   sub={snap ? `${snap.totalStorageGiB.toFixed(2)} GiB` : undefined} />
        <StatCard label="Blob Events"     value={loading ? "…" : fmtFull(animEvents)} />
        <StatCard label="Pending / Failed" value={loading ? "…" : fmtFull(animPending)} accent={snap && snap.pendingOrFailed > 10000 ? "#f59e0b" : undefined} />
        <StatCard label="Deleted Blobs"   value={loading ? "…" : fmtFull(animDeleted)} accent="#ef4444" />
        <StatCard label="Block Height"    value={loading ? "…" : fmtFull(snap?.blockHeight ?? null)} sub={snap ? `Ledger v${snap.ledgerVersion.toLocaleString("en-US")}` : undefined} />
      </div>

      {/* ── Blob Breakdown Bar ── */}
      {snap && (
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 12, padding: "16px 20px",
          display: "flex", flexDirection: "column", gap: 12,
          transition: "background 0.2s",
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Blob Composition
          </span>
          <BlobBreakdownBar
            active={snap.activeBlobs}
            pending={snap.pendingOrFailed}
            deleted={snap.deletedBlobs}
            empty={snap.emptyRecords}
          />
        </div>
      )}

      {/* ── Timeseries Section ── */}
      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "20px",
        display: "flex", flexDirection: "column", gap: 16,
        transition: "background 0.2s",
      }}>
        {/* Range selector + delta */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {RANGES.map(r => (
              <button key={r} className={`live-range-btn${range === r ? " active" : ""}`} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
          {tsData && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>In this period:</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>New blobs</span>
                <DeltaBadge value={tsData.delta.newBlobs} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Deleted</span>
                <DeltaBadge value={tsData.delta.deletedBlobs} invert />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Storage Δ</span>
                <DeltaBadge value={Number(tsData.delta.storageDeltaGB.toFixed(2))} suffix=" GB" />
              </div>
            </div>
          )}
        </div>

        {chartData.length === 0 ? (
          <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
            {tsData === null ? "Loading chart data…" : "No timeseries data yet — data accumulates over time"}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

            {/* Active Blobs */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Active Blobs
              </div>
              <ChartContainer height={140}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-active" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22c55e" stopOpacity={isDark ? 0.4 : 0.25} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="tsMs" tickFormatter={ts => fmtDate(ts, range)} tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false} tickFormatter={v => v.toLocaleString("en-US")} width={64} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area dataKey="activeBlobs" name="Active Blobs" stroke="#22c55e" strokeWidth={2} fill="url(#grad-active)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ChartContainer>
            </div>

            {/* Storage GB */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Storage Used (GB)
              </div>
              <ChartContainer height={140}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-storage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#06b6d4" stopOpacity={isDark ? 0.4 : 0.25} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="tsMs" tickFormatter={ts => fmtDate(ts, range)} tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(0)} GB`} width={52} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area dataKey="storageGB" name="Storage GB" stroke="#06b6d4" strokeWidth={2} fill="url(#grad-storage)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ChartContainer>
            </div>

            {/* Blob Events */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Blob Events
              </div>
              <ChartContainer height={140}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-events" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#a855f7" stopOpacity={isDark ? 0.4 : 0.25} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="tsMs" tickFormatter={ts => fmtDate(ts, range)} tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false} tickFormatter={v => v.toLocaleString("en-US")} width={64} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area dataKey="events" name="Blob Events" stroke="#a855f7" strokeWidth={2} fill="url(#grad-events)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ChartContainer>
            </div>

            {/* Deleted + Pending — Per-series min/max scale để thấy fluctuation */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Deleted / Pending
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8 }}>
                Anomaly tracking · auto-scaled per series
              </div>
              <ChartContainer height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="tsMs" tickFormatter={ts => fmtDate(ts, range)} tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false} />
                  {/* Per-series domain: show fluctuation even when values are large & flat */}
                  <YAxis
                    tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false}
                    tickFormatter={v => v.toLocaleString("en-US")}
                    domain={[Math.floor(pdMin * 0.98), Math.ceil(pdMax * 1.02)]}
                    width={72}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line dataKey="deletedBlobs" name="Deleted" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line dataKey="pendingBlobs" name="Pending" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ChartContainer>
            </div>

          </div>
        )}
      </div>

      {/* ── On-chain Info ── */}
      {snap && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          {[
            { label: "Storage Providers", value: snap.storageProviders },
            { label: "Placement Groups",  value: snap.placementGroups  },
            { label: "Slices",            value: snap.slices           },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "12px 16px", textAlign: "center",
              transition: "background 0.2s",
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                {value?.toLocaleString("en-US") ?? "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function total(snap: NetworkSnapshot) {
  return snap.activeBlobs + snap.pendingOrFailed + snap.deletedBlobs + snap.emptyRecords;
}
function pct(a: number, b: number) {
  return b === 0 ? 0 : ((a / b) * 100).toFixed(1);
}