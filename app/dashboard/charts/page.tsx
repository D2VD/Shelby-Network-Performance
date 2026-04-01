"use client";
/**
 * app/dashboard/charts/page.tsx — v6.0
 *
 * Thay đổi kiến trúc:
 *  - Không còn dùng R2 snapshots làm nguồn chính
 *  - Poll /api/geo-sync/stats/live mỗi 30s → append vào ring buffer local
 *  - Tab "Network": real-time time-series (block, blobs, storage, events, slices)
 *  - Tab "Benchmark": charts từ benchmark history (hourly/daily/monthly)
 *    - Score, Upload speed, Download speed, Latency, TX confirm
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LivePoint {
  ts:                    number; // unix ms
  blockHeight:           number;
  totalBlobs:            number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents:       number | null;
  slices:                number | null;
  storageProviders:      number | null;
  placementGroups:       number | null;
}

interface AggPoint {
  window:        string;
  count:         number;
  avgScore:      number;
  avgUploadKbs:  number;
  avgDownloadKbs:number;
  avgLatencyMs:  number;
  avgConfirmMs:  number;
  minScore:      number;
  maxScore:      number;
  firstAt:       string;
  lastAt:        string;
}

type Tab = "network" | "benchmark";
type BenchPeriod = "hourly" | "daily" | "monthly";

const MAX_POINTS = 120; // 1 hour @ 30s interval
const POLL_MS    = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(b: number | null): string {
  if (b == null || b === 0) return "0 B";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}
function fmtNum(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  return v.toLocaleString("en-US");
}
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}
function fmtKbs(k: number): string {
  return k >= 1024 ? `${(k / 1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
}
function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────

function LineChart({
  data, color = "#2563eb", height = 140,
  formatY, label, unit = "",
}: {
  data: number[]; color?: string; height?: number;
  formatY?: (v: number) => string; label?: string; unit?: string;
}) {
  if (data.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gray-400)", fontSize: 13, flexDirection: "column", gap: 8 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--gray-200)", borderTopColor: color, animation: "spin 1s linear infinite" }} />
      Collecting data…
    </div>
  );

  const W = 600, pad = { t: 10, b: 20, l: 56, r: 10 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const xs  = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys  = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t + iH} ${line} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gId  = `lg${color.replace(/[^a-z0-9]/gi, "")}`;
  const fmt  = formatY ?? ((v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(Math.round(v));
  });

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <defs>
        <linearGradient id={gId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => {
        const y = pad.t + iH - f * iH;
        return (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#f0f0f0" />
            <text x={pad.l - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#ccc">{fmt(min + f * range)}</text>
          </g>
        );
      })}
      <polygon points={area} fill={`url(#${gId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {xs.length > 0 && (
        <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
      )}
    </svg>
  );
}

function BarChart({
  data, keys, colors, height = 120,
}: {
  data: { label: string; values: Record<string, number> }[];
  keys: string[]; colors: string[]; height?: number;
}) {
  if (!data.length) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gray-400)", fontSize: 13 }}>No data yet</div>
  );
  const allVals = data.flatMap(d => keys.map(k => d.values[k] ?? 0));
  const maxVal  = Math.max(...allVals, 1);
  const barW    = Math.max(8, Math.floor(560 / (data.length * (keys.length + 0.5))));
  const gap     = 2;

  return (
    <svg viewBox={`0 0 600 ${height}`} style={{ width: "100%", height, display: "block" }}>
      {data.map((d, di) => {
        const groupX = 40 + di * (keys.length * (barW + gap) + 8);
        return (
          <g key={d.label}>
            {keys.map((k, ki) => {
              const val   = d.values[k] ?? 0;
              const barH  = Math.round((val / maxVal) * (height - 30));
              const x     = groupX + ki * (barW + gap);
              const y     = height - 20 - barH;
              return (
                <g key={k}>
                  <rect x={x} y={y} width={barW} height={barH} fill={colors[ki]} opacity={0.85} rx={2} />
                  <title>{k}: {val}</title>
                </g>
              );
            })}
            <text x={groupX + (keys.length * (barW + gap)) / 2} y={height - 4} textAnchor="middle" fontSize={8} fill="#9ca3af">
              {d.label}
            </text>
          </g>
        );
      })}
      {/* Y axis label */}
      <text x={36} y={10} textAnchor="end" fontSize={8} fill="#ccc">{Math.round(maxVal)}</text>
      <text x={36} y={height - 22} textAnchor="end" fontSize={8} fill="#ccc">0</text>
    </svg>
  );
}

function StatBadge({ label, value, color = "var(--gray-800)" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 9, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const { network, config } = useNetwork();
  const [tab,        setTab]        = useState<Tab>("network");
  const [benchPeriod, setBenchPeriod] = useState<BenchPeriod>("hourly");

  // ── Network time-series ──
  const [points,     setPoints]     = useState<LivePoint[]>([]);
  const [polling,    setPolling]    = useState(false);
  const [lastError,  setLastError]  = useState<string | null>(null);
  const [lastFetch,  setLastFetch]  = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLive = useCallback(async () => {
    setPolling(true);
    try {
      const res  = await fetch(`/api/geo-sync/stats/live?network=${network}`);
      const json = await res.json() as any;
      if (!res.ok || !json.ok) { setLastError(json.error ?? `HTTP ${res.status}`); return; }
      const d = json.data;
      const point: LivePoint = {
        ts:                    Date.now(),
        blockHeight:           d.node?.blockHeight ?? 0,
        totalBlobs:            d.stats?.totalBlobs ?? null,
        totalStorageUsedBytes: d.stats?.totalStorageUsedBytes ?? null,
        totalBlobEvents:       d.stats?.totalBlobEvents ?? null,
        slices:                d.stats?.slices ?? null,
        storageProviders:      d.stats?.storageProviders ?? null,
        placementGroups:       d.stats?.placementGroups ?? null,
      };
      setPoints(prev => [...prev, point].slice(-MAX_POINTS));
      setLastFetch(new Date());
      setLastError(null);
    } catch (e: any) {
      setLastError(e.message);
    } finally {
      setPolling(false);
    }
  }, [network]);

  // Start polling on mount + network change
  useEffect(() => {
    setPoints([]);
    fetchLive();
    timerRef.current = setInterval(fetchLive, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLive]);

  // ── Benchmark analytics ──
  const [benchData,   setBenchData]   = useState<{ hourly: AggPoint[]; daily: AggPoint[]; monthly: AggPoint[] } | null>(null);
  const [benchLoading, setBenchLoading] = useState(false);

  const fetchBench = useCallback(async () => {
    setBenchLoading(true);
    try {
      const res  = await fetch("/api/geo-sync/benchmark-results?type=summary");
      const json = await res.json() as any;
      if (json.ok) setBenchData(json);
    } catch { /* silent */ }
    finally { setBenchLoading(false); }
  }, []);

  useEffect(() => { if (tab === "benchmark") fetchBench(); }, [tab, fetchBench]);

  // ── Derived series ──
  const latest    = points[points.length - 1];
  const prev      = points[points.length - 2];
  const blobSeries     = points.map(p => p.totalBlobs ?? 0).filter(Boolean);
  const storageSeries  = points.map(p => p.totalStorageUsedBytes ?? 0).filter(Boolean);
  const eventSeries    = points.map(p => p.totalBlobEvents ?? 0).filter(Boolean);
  const sliceSeries    = points.map(p => p.slices ?? 0).filter(Boolean);
  const blockSeries    = points.map(p => p.blockHeight).filter(Boolean);
  const labels         = points.filter(p => p.blockHeight > 0).map(p => timeLabel(p.ts));

  const benchPoints: AggPoint[] = useMemo(() => {
    if (!benchData) return [];
    const m: Record<BenchPeriod, AggPoint[]> = {
      hourly:  benchData.hourly  ?? [],
      daily:   benchData.daily   ?? [],
      monthly: benchData.monthly ?? [],
    };
    return m[benchPeriod].filter(Boolean).reverse(); // oldest first
  }, [benchData, benchPeriod]);

  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Network Charts</h1>
          <p className="page-subtitle">
            {config.label} · real-time polling every {POLL_MS/1000}s · {points.length} points collected
            {lastFetch && ` · ${lastFetch.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Tab */}
          <div style={{ display: "flex", background: "#f4f4f4", borderRadius: 10, padding: 3, gap: 2 }}>
            {(["network", "benchmark"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13,
                fontWeight: tab === t ? 600 : 400, color: tab === t ? "#0a0a0a" : "#999",
                background: tab === t ? "#fff" : "transparent",
                boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", border: "none", cursor: "pointer",
              }}>
                {t === "network" ? "🌐 Network" : "⚡ Benchmark"}
              </button>
            ))}
          </div>
          {tab === "network" && (
            <button onClick={fetchLive} disabled={polling} className="btn btn-secondary" style={{ fontSize: 12 }}>
              {polling ? "⟳ Fetching…" : "⟳ Refresh"}
            </button>
          )}
          {tab === "benchmark" && (
            <button onClick={fetchBench} disabled={benchLoading} className="btn btn-secondary" style={{ fontSize: 12 }}>
              {benchLoading ? "⟳ Loading…" : "⟳ Refresh"}
            </button>
          )}
        </div>
      </div>

      {lastError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {lastError}</div>
      )}

      {/* ── NETWORK TAB ── */}
      {tab === "network" && (
        <>
          {/* Live summary strip */}
          {latest && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ padding: "12px 20px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
                  <span style={{ fontSize: 12, color: "var(--gray-500)" }}>Live</span>
                </div>
                {[
                  { label: "Block",     value: `#${latest.blockHeight.toLocaleString()}`,  color: "var(--net-color, #2563eb)" },
                  { label: "Blobs",     value: fmtNum(latest.totalBlobs),                  color: "var(--gray-800)" },
                  { label: "Storage",   value: fmtBytes(latest.totalStorageUsedBytes),     color: "#16a34a" },
                  { label: "Events",    value: fmtNum(latest.totalBlobEvents),             color: "#9333ea" },
                  { label: "Slices",    value: fmtNum(latest.slices),                      color: "#d97706" },
                  { label: "Providers", value: String(latest.storageProviders ?? "—"),     color: "#6b7280" },
                ].map(({ label, value, color }) => (
                  <StatBadge key={label} label={label} value={value} color={color} />
                ))}
                <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>
                  {points.length} / {MAX_POINTS} pts · {POLL_MS/1000}s interval
                </div>
              </div>
            </div>
          )}

          {/* Block height */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Block height — live</div>
                <div className="card-subtitle">Aptos block progression on {config.label}</div>
              </div>
              {blockSeries.length > 1 && (
                <MiniStat label="Latest" value={`#${blockSeries[blockSeries.length-1].toLocaleString()}`} color="var(--net-color, #2563eb)" />
              )}
            </div>
            <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
              <LineChart data={blockSeries} color="var(--net-color, #2563eb)" height={120}
                formatY={v => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v.toLocaleString()} />
            </div>
          </div>

          {/* Total blobs */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Total blobs — live</div>
                <div className="card-subtitle">Files stored on {config.label} · via SDK getBlobsCount()</div>
              </div>
              {blobSeries.length > 0 && (
                <MiniStat label="Latest" value={fmtNum(blobSeries[blobSeries.length-1])} color="#2563eb" />
              )}
            </div>
            <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
              <LineChart data={blobSeries} color="#2563eb" height={140}
                formatY={v => v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)} />
            </div>
          </div>

          {/* Storage + Events side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Storage used</div>
                  <div className="card-subtitle">via SDK getTotalBlobsSize()</div>
                </div>
                {storageSeries.length > 0 && <MiniStat label="Latest" value={fmtBytes(storageSeries[storageSeries.length-1])} color="#16a34a" />}
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                <LineChart data={storageSeries} color="#16a34a" height={110} formatY={fmtBytes} />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Blob events</div>
                  <div className="card-subtitle">txns × 2.0</div>
                </div>
                {eventSeries.length > 0 && <MiniStat label="Latest" value={fmtNum(eventSeries[eventSeries.length-1])} color="#9333ea" />}
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                <LineChart data={eventSeries} color="#9333ea" height={110}
                  formatY={v => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)} />
              </div>
            </div>
          </div>

          {/* Slices */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Slices — live</div>
                <div className="card-subtitle">Erasure-coded chunks (10+6 scheme)</div>
              </div>
              {sliceSeries.length > 0 && <MiniStat label="Latest" value={fmtNum(sliceSeries[sliceSeries.length-1])} color="#d97706" />}
            </div>
            <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
              <LineChart data={sliceSeries} color="#d97706" height={100} />
            </div>
          </div>
        </>
      )}

      {/* ── BENCHMARK TAB ── */}
      {tab === "benchmark" && (
        <>
          {/* Period selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: "var(--gray-500)" }}>Period:</span>
            {(["hourly", "daily", "monthly"] as BenchPeriod[]).map(p => (
              <button key={p} onClick={() => setBenchPeriod(p)} style={{
                padding: "5px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                fontWeight: benchPeriod === p ? 600 : 400,
                border:     `1px solid ${benchPeriod === p ? "var(--net-color, #2563eb)" : "var(--gray-200)"}`,
                background: benchPeriod === p ? "var(--net-bg, #eff6ff)" : "transparent",
                color:      benchPeriod === p ? "var(--net-color, #2563eb)" : "var(--gray-500)",
              }}>{p}</button>
            ))}
            <span style={{ fontSize: 11, color: "var(--gray-400)", marginLeft: 8 }}>
              {benchPoints.length} data points
            </span>
          </div>

          {benchLoading && (
            <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--gray-200)", borderTopColor: "#2563eb", animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
              <div style={{ color: "var(--gray-400)", fontSize: 14 }}>Loading benchmark analytics…</div>
            </div>
          )}

          {!benchLoading && benchPoints.length === 0 && (
            <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 14, color: "var(--gray-400)", marginBottom: 8 }}>No benchmark data for this period</div>
              <div style={{ fontSize: 12, color: "var(--gray-300)" }}>Run benchmarks on the Benchmark page to populate charts</div>
            </div>
          )}

          {!benchLoading && benchPoints.length > 0 && (
            <>
              {/* Summary strip */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-body" style={{ padding: "12px 20px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
                  {(() => {
                    const totalRuns  = benchPoints.reduce((s, p) => s + p.count, 0);
                    const avgScore   = Math.round(benchPoints.reduce((s, p) => s + p.avgScore * p.count, 0) / Math.max(totalRuns, 1));
                    const avgUp      = Math.round(benchPoints.reduce((s, p) => s + p.avgUploadKbs * p.count, 0) / Math.max(totalRuns, 1));
                    const avgDown    = Math.round(benchPoints.reduce((s, p) => s + p.avgDownloadKbs * p.count, 0) / Math.max(totalRuns, 1));
                    return [
                      { label: "Total runs",     value: String(totalRuns),      color: "var(--gray-800)" },
                      { label: "Avg score",      value: `${avgScore}/1000`,     color: avgScore >= 700 ? "#16a34a" : avgScore >= 450 ? "#ca8a04" : "#dc2626" },
                      { label: "Avg upload",     value: fmtKbs(avgUp),          color: "#2563eb" },
                      { label: "Avg download",   value: fmtKbs(avgDown),        color: "#16a34a" },
                    ].map(({ label, value, color }) => <StatBadge key={label} label={label} value={value} color={color} />);
                  })()}
                </div>
              </div>

              {/* Score chart */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div>
                    <div className="card-title">Score — {benchPeriod}</div>
                    <div className="card-subtitle">Avg benchmark score per {benchPeriod.replace("ly","")}</div>
                  </div>
                  {benchPoints.length > 0 && (
                    <MiniStat label="Latest avg" value={`${benchPoints[benchPoints.length-1].avgScore}/1000`} color="#2563eb" />
                  )}
                </div>
                <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                  <LineChart data={benchPoints.map(p => p.avgScore)} color="#2563eb" height={140}
                    formatY={v => `${v}`} />
                </div>
                <div style={{ padding: "4px 20px 12px", display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--gray-400)" }}>
                  {benchPoints.map((p, i) => i % Math.max(1, Math.floor(benchPoints.length / 6)) === 0 ? (
                    <span key={i}>{p.window}</span>
                  ) : null)}
                </div>
              </div>

              {/* Upload + Download side by side */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Upload speed</div>
                      <div className="card-subtitle">Avg upload KB/s to Shelby</div>
                    </div>
                    {benchPoints.length > 0 && (
                      <MiniStat label="Latest" value={fmtKbs(benchPoints[benchPoints.length-1].avgUploadKbs)} color="#2563eb" />
                    )}
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={benchPoints.map(p => p.avgUploadKbs)} color="#2563eb" height={110} formatY={v => `${v.toFixed(0)}`} />
                  </div>
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Download speed</div>
                      <div className="card-subtitle">Avg download KB/s from Shelby</div>
                    </div>
                    {benchPoints.length > 0 && (
                      <MiniStat label="Latest" value={fmtKbs(benchPoints[benchPoints.length-1].avgDownloadKbs)} color="#16a34a" />
                    )}
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={benchPoints.map(p => p.avgDownloadKbs)} color="#16a34a" height={110} formatY={v => `${v.toFixed(0)}`} />
                  </div>
                </div>
              </div>

              {/* Latency + TX confirm side by side */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Blockchain latency</div>
                      <div className="card-subtitle">Avg ping to Shelbynet node</div>
                    </div>
                    {benchPoints.length > 0 && (
                      <MiniStat label="Latest" value={fmtMs(benchPoints[benchPoints.length-1].avgLatencyMs)} color="#9333ea" />
                    )}
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={benchPoints.map(p => p.avgLatencyMs)} color="#9333ea" height={110} formatY={v => `${v.toFixed(0)}ms`} />
                  </div>
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">TX confirm time</div>
                      <div className="card-subtitle">Avg Aptos transaction finality</div>
                    </div>
                    {benchPoints.length > 0 && (
                      <MiniStat label="Latest" value={fmtMs(benchPoints[benchPoints.length-1].avgConfirmMs)} color="#f59e0b" />
                    )}
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={benchPoints.map(p => p.avgConfirmMs)} color="#f59e0b" height={110} formatY={v => `${v.toFixed(0)}ms`} />
                  </div>
                </div>
              </div>

              {/* Runs count bar chart */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">Benchmark runs — {benchPeriod}</div>
                    <div className="card-subtitle">Number of runs per {benchPeriod.replace("ly","")}</div>
                  </div>
                </div>
                <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                  <BarChart
                    data={benchPoints.map(p => ({ label: p.window ?? "", values: { runs: p.count } }))}
                    keys={["runs"]} colors={["#2563eb"]} height={110}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}