"use client";
/**
 * app/dashboard/charts/page.tsx — v7.1
 * Fix #5: Khôi phục time range filter 1h / 24h / 7d / 30d
 * Fix #4: Số đầy đủ, font lớn hơn
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LivePoint {
  ts: number;
  blockHeight: number;
  activeBlobs: number | null;
  totalStorageBytes: number | null;
  totalBlobEvents: number | null;
  pendingOrFailed: number | null;
  deletedBlobs: number | null;
}

interface HistoryEntry {
  id: number;
  latency: { avg: number; min: number; max: number };
  uploads: { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null }[];
  downloads: { bytes: number; elapsed: number; speedKbs: number }[];
  tx: { submitTime: number; confirmTime: number; txHash: string | null };
  avgUploadKbs: number;
  avgDownloadKbs: number;
  score: number;
  tier: string;
  runAt: string;
  maxSuccessfulBytes?: number;
  mode: string;
}

interface TsPoint { 
  tsMs: number; 
  activeBlobs: number; 
  totalStorageGB: number; 
  totalBlobEvents: number; 
  pendingOrFailed: number; 
  deletedBlobs: number; 
  blockHeight?: number; // Thêm dòng này (dấu ? để cho phép không bắt buộc có)
}

type Tab = "network" | "benchmark";
type TimeRange = "1h" | "24h" | "7d" | "30d";

const MAX_LOCAL = 120;
const POLL_MS   = 30_000;
const LOCAL_KEY = "shelby_bench_history_v3";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtFull(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US");
}
function fmtBytes(b: number | null): string {
  if (b == null || b === 0) return "0 B";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}
function fmtMs(ms: number): string { return ms >= 1000 ? `${(ms/1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`; }
function fmtKbs(k: number): string { return k >= 1024 ? `${(k/1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`; }
function tLabel(ts: number, range: TimeRange): string {
  const d = new Date(ts);
  if (range === "1h" || range === "24h") return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${d.getMonth()+1}/${d.getDate()}`;
}

// ─── Line Chart ───────────────────────────────────────────────────────────────
function LineChart({ data, color = "#2563eb", height = 140, fmtY }: {
  data: number[]; color?: string; height?: number; fmtY?: (v: number) => string;
}) {
  if (data.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#d1d5db", fontSize: 13, flexDirection: "column", gap: 8 }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid #e5e7eb", borderTopColor: color, animation: "spin 1s linear infinite" }} />
      Collecting data…
    </div>
  );
  const W = 600, pad = { t: 10, b: 20, l: 58, r: 10 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const xs = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t+iH} ${line} ${(pad.l+iW).toFixed(1)},${pad.t+iH}`;
  const gId = `lc${color.replace(/[^a-z0-9]/gi, "")}`;
  const fmt = fmtY ?? ((v: number) => {
    if (v >= 1e9) return `${(v/1e9).toFixed(1)}G`;
    if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`;
    return String(Math.round(v));
  });
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => {
        const y = pad.t + iH - f * iH;
        return (
          <g key={f}>
            <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke="#f0f0f0" />
            <text x={pad.l-5} y={y+3} textAnchor="end" fontSize={9} fill="#ccc">{fmt(min + f * range)}</text>
          </g>
        );
      })}
      <polygon points={area} fill={`url(#${gId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {xs.length > 0 && <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />}
    </svg>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function StatBadge({ label, value, color = "#374151" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ─── Time Range Selector ──────────────────────────────────────────────────────
function RangeBtn({ r, active, onClick }: { r: TimeRange; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 400,
      border: `1px solid ${active ? "var(--net-color, #2563eb)" : "var(--gray-200, #e5e7eb)"}`,
      background: active ? "var(--net-bg, #eff6ff)" : "transparent",
      color: active ? "var(--net-color, #2563eb)" : "var(--gray-500, #6b7280)",
      cursor: "pointer", transition: "all 0.1s",
    }}>
      {r}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();
  const [tab,      setTab]      = useState<Tab>("network");
  const [range,    setRange]    = useState<TimeRange>("24h"); // FIX #5: time range
  const [points,   setPoints]   = useState<LivePoint[]>([]);
  const [polling,  setPolling]  = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [history,  setHistory]  = useState<HistoryEntry[]>([]);
  // Timeseries from VPS Redis
  const [tsData,   setTsData]   = useState<TsPoint[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Network fetch ──
  const fetchLive = useCallback(async () => {
    setPolling(true);
    try {
      const res  = await fetch(`/api/network/stats/live?network=${network}`);
      const json = await res.json() as any;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const d = json.data ?? json;
      const point: LivePoint = {
        ts:                Date.now(),
        blockHeight:       d.blockHeight ?? d.node?.blockHeight ?? 0,
        activeBlobs:       d.activeBlobs  ?? d.stats?.totalBlobs ?? null,
        totalStorageBytes: d.totalStorageBytes ?? d.stats?.totalStorageUsedBytes ?? null,
        totalBlobEvents:   d.totalBlobEvents ?? d.stats?.totalBlobEvents ?? null,
        pendingOrFailed:   d.pendingOrFailed ?? null,
        deletedBlobs:      d.deletedBlobs ?? null,
      };
      setPoints(prev => [...prev, point].slice(-MAX_LOCAL));
      setLastFetch(new Date());
      setLastError(null);
    } catch (e: any) {
      setLastError(e.message);
    } finally {
      setPolling(false);
    }
  }, [network]);

  // ── Timeseries fetch (VPS Redis) ── FIX #5
  const fetchTimeseries = useCallback(async (r: TimeRange) => {
    try {
      const resolution = r === "1h" ? "5m" : r === "24h" ? "5m" : "1h";
      const res = await fetch(`/api/network/stats/timeseries?network=${network}&resolution=${resolution}&range=${r}`);
      if (!res.ok) return;
      const j = await res.json() as any;
      const series: TsPoint[] = (j.data?.series ?? []).map((s: any) => ({
        tsMs:            s.tsMs,
        activeBlobs:     s.activeBlobs ?? 0,
        totalStorageGB:  s.totalStorageGB ?? 0,
        totalBlobEvents: s.totalBlobEvents ?? 0,
        pendingOrFailed: s.pendingOrFailed ?? 0,
        deletedBlobs:    s.deletedBlobs ?? 0,
      }));
      setTsData(series);
    } catch {}
  }, [network]);

  useEffect(() => {
    setPoints([]);
    fetchLive();
    timerRef.current = setInterval(fetchLive, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLive]);

  useEffect(() => {
    if (tab === "network") fetchTimeseries(range);
  }, [tab, range, fetchTimeseries]);

  // ── Benchmark ──
  useEffect(() => {
    if (tab !== "benchmark") return;
    try {
      const s = localStorage.getItem(LOCAL_KEY);
      if (s) setHistory(JSON.parse(s) as HistoryEntry[]);
    } catch {}
  }, [tab]);

  // Chart data: nếu có timeseries từ VPS dùng đó, không thì dùng local points
  const chartData = tsData.length > 0 ? tsData : points.map(p => ({
    tsMs:            p.ts,
    activeBlobs:     p.activeBlobs ?? 0,
    totalStorageGB:  p.totalStorageBytes ? p.totalStorageBytes / 1e9 : 0,
    totalBlobEvents: p.totalBlobEvents ?? 0,
    pendingOrFailed: p.pendingOrFailed ?? 0,
    deletedBlobs:    p.deletedBlobs ?? 0,
  }));

  const latest = points[points.length - 1];

  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#111827", margin: 0, letterSpacing: -0.6 }}>Network Charts</h1>
          <p style={{ fontSize: 13, color: "#9ca3af", margin: "4px 0 0" }}>
            {config.label} · {POLL_MS/1000}s polling · {points.length} local pts
            {lastFetch && ` · ${lastFetch.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Tab */}
          <div style={{ display: "flex", background: "#f4f4f4", borderRadius: 10, padding: 3, gap: 2 }}>
            {(["network", "benchmark"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "6px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                fontWeight: tab === t ? 700 : 400, color: tab === t ? "#0a0a0a" : "#999",
                background: tab === t ? "#fff" : "transparent",
                boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none", border: "none",
              }}>
                {t === "network" ? "🌐 Network" : "⚡ Benchmark"}
              </button>
            ))}
          </div>
          <button onClick={fetchLive} disabled={polling} className="btn btn-secondary" style={{ fontSize: 12 }}>
            {polling ? "⟳ Fetching…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {lastError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {lastError}</div>
      )}

      {/* ── NETWORK TAB ── */}
      {tab === "network" && (
        <>
          {/* FIX #5: Time range selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Time range:</span>
            {(["1h", "24h", "7d", "30d"] as TimeRange[]).map(r => (
              <RangeBtn key={r} r={r} active={range === r} onClick={() => setRange(r)} />
            ))}
            <span style={{ fontSize: 11, color: "#d1d5db", fontFamily: "monospace" }}>
              {tsData.length > 0 ? `${tsData.length} pts (VPS timeseries)` : `${points.length} pts (local)`}
            </span>
          </div>

          {/* Live strip */}
          {latest && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-body" style={{ padding: "14px 22px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                  <span style={{ fontSize: 13, color: "#6b7280" }}>Live</span>
                </div>
                {[
                  { label: "Block",   value: `#${latest.blockHeight.toLocaleString("en-US")}`,        color: "var(--net-color, #2563eb)" },
                  { label: "Blobs",   value: fmtFull(latest.activeBlobs),                              color: "#374151" },
                  { label: "Storage", value: fmtBytes(latest.totalStorageBytes),                        color: "#16a34a" },
                  { label: "Events",  value: fmtFull(latest.totalBlobEvents),                           color: "#9333ea" },
                  { label: "Pending", value: fmtFull(latest.pendingOrFailed),                           color: "#f59e0b" },
                ].map(({ label, value, color }) => (
                  <StatBadge key={label} label={label} value={value} color={color} />
                ))}
                <div style={{ marginLeft: "auto", fontSize: 11, color: "#d1d5db", fontFamily: "monospace" }}>
                  Range: {range}
                </div>
              </div>
            </div>
          )}

          {/* Charts */}
          {[
            { title: "Active Blobs", sub: `${range} window`, key: "activeBlobs" as keyof TsPoint, color: "#2563eb", latest: fmtFull(latest?.activeBlobs ?? null), height: 140 },
            { title: "Block Height", sub: "Chain progress",  key: "blockHeight" as keyof TsPoint, color: "#059669", latest: latest ? `#${latest.blockHeight.toLocaleString("en-US")}` : "—", height: 120 },
            { title: "Storage Used (GB)", sub: "Shelby Indexer", key: "totalStorageGB" as keyof TsPoint, color: "#9333ea", latest: chartData.length > 0 ? `${chartData[chartData.length-1].totalStorageGB.toFixed(2)} GB` : "—", height: 120 },
            { title: "Blob Events",  sub: "blob_activities", key: "totalBlobEvents" as keyof TsPoint, color: "#d97706", latest: fmtFull(latest?.totalBlobEvents ?? null), height: 120 },
            { title: "Pending/Failed Blobs", sub: "is_written=0", key: "pendingOrFailed" as keyof TsPoint, color: "#f59e0b", latest: fmtFull(latest?.pendingOrFailed ?? null), height: 110 },
            { title: "Deleted Blobs", sub: "is_deleted=1",   key: "deletedBlobs" as keyof TsPoint,  color: "#ef4444", latest: fmtFull(latest?.deletedBlobs ?? null), height: 110 },
          ].map(({ title, sub, key, color, latest: lat, height }) => {
            const data = key === "blockHeight"
              ? points.map(p => p.blockHeight).filter(Boolean)
              : chartData.map(p => Number(p[key] ?? 0)).filter(v => v > 0);
            return (
              <div key={title} className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div>
                    <div className="card-title" style={{ fontSize: 15 }}>{title} — {range}</div>
                    <div className="card-subtitle">{sub}</div>
                  </div>
                  {data.length > 0 && <MiniStat label="Latest" value={lat} color={color} />}
                </div>
                <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                  <LineChart data={data} color={color} height={height} />
                </div>
                {/* X-axis labels */}
                {chartData.length > 1 && (
                  <div style={{ padding: "0 22px 10px", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#d1d5db", fontFamily: "monospace" }}>
                    <span>{tLabel(chartData[0].tsMs, range)}</span>
                    <span>{tLabel(chartData[chartData.length-1].tsMs, range)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── BENCHMARK TAB ── */}
      {tab === "benchmark" && (
        <>
          {history.length === 0 ? (
            <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>📊</div>
              <div style={{ fontSize: 15, color: "#9ca3af" }}>No benchmark data yet</div>
              <div style={{ fontSize: 12, color: "#d1d5db", marginTop: 6 }}>Run benchmarks on the Benchmark page</div>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-body" style={{ padding: "14px 22px", display: "flex", gap: 28, flexWrap: "wrap" }}>
                  {(() => {
                    const n   = history.length;
                    const avg = (fn: (h: HistoryEntry) => number) => Math.round(history.reduce((s, h) => s + fn(h), 0) / n);
                    return [
                      { label: "Total Runs",   value: String(n), color: "#374151" },
                      { label: "Avg Score",    value: `${avg(h => h.score)}/1000`, color: avg(h => h.score) >= 700 ? "#16a34a" : "#d97706" },
                      { label: "Avg Upload",   value: fmtKbs(avg(h => h.avgUploadKbs)), color: "#2563eb" },
                      { label: "Avg Download", value: fmtKbs(avg(h => h.avgDownloadKbs)), color: "#16a34a" },
                      { label: "Avg Latency",  value: fmtMs(avg(h => h.latency?.avg ?? 0)), color: "#9333ea" },
                      { label: "Avg TX",       value: fmtMs(avg(h => h.tx?.confirmTime ?? 0)), color: "#f59e0b" },
                    ].map(p => <StatBadge key={p.label} {...p} />);
                  })()}
                </div>
              </div>

              {/* Score chart */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div><div className="card-title" style={{ fontSize: 15 }}>Score per run</div></div>
                  <MiniStat label="Latest" value={`${history[history.length-1]?.score ?? 0}/1000`} color="#2563eb" />
                </div>
                <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                  <LineChart data={history.map(h => h.score)} color="#2563eb" height={140} fmtY={v => `${v}`} />
                </div>
              </div>

              {/* Upload + Download */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                {[
                  { title: "Upload Speed", data: history.map(h => h.avgUploadKbs), color: "#2563eb", fmt: fmtKbs },
                  { title: "Download Speed", data: history.map(h => h.avgDownloadKbs), color: "#16a34a", fmt: fmtKbs },
                ].map(({ title, data, color, fmt }) => (
                  <div key={title} className="card">
                    <div className="card-header">
                      <div><div className="card-title">{title}</div></div>
                      {data.length > 0 && <MiniStat label="Latest" value={fmt(data[data.length-1])} color={color} />}
                    </div>
                    <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                      <LineChart data={data} color={color} height={110} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Latency + TX Submit + TX Confirm */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                {[
                  { title: "Avg Latency",  data: history.map(h => h.latency?.avg ?? 0), color: "#9333ea" },
                  { title: "TX Submit",    data: history.map(h => h.tx?.submitTime ?? 0), color: "#f59e0b" },
                  { title: "TX Confirm",   data: history.map(h => h.tx?.confirmTime ?? 0), color: "#ef4444" },
                ].map(({ title, data, color }) => (
                  <div key={title} className="card">
                    <div className="card-header">
                      <div><div className="card-title">{title}</div></div>
                      {data.length > 0 && <MiniStat label="Latest" value={fmtMs(data[data.length-1])} color={color} />}
                    </div>
                    <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                      <LineChart data={data} color={color} height={100} fmtY={v => `${v.toFixed(0)}ms`} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Run history table */}
              <div className="card">
                <div className="card-header">
                  <div><div className="card-title" style={{ fontSize: 15 }}>Run History</div><div className="card-subtitle">{history.length} runs</div></div>
                </div>
                <div className="card-body" style={{ padding: 0, overflowX: "auto" }}>
                  <table className="data-table" style={{ minWidth: 750 }}>
                    <thead>
                      <tr><th>#</th><th>Mode</th><th>Score</th><th>Upload</th><th>Download</th><th>Latency</th><th>TX Submit</th><th>TX Confirm</th><th>At</th></tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((h, i) => {
                        const TIER_C: Record<string, string> = { "Blazing Fast": "#16a34a", "Excellent": "#059669", "Good": "#ca8a04", "Fair": "#d97706", "Poor": "#dc2626" };
                        const c = TIER_C[h.tier] ?? "#6b7280";
                        return (
                          <tr key={h.id ?? i}>
                            <td style={{ fontSize: 12 }}><span style={{ color: "#9ca3af", fontFamily: "monospace" }}>#{h.id ?? i}</span></td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", textTransform: "uppercase" }}>{h.mode}</span></td>
                            <td><span style={{ fontFamily: "monospace", fontWeight: 700, color: c, fontSize: 14 }}>{h.score}</span></td>
                            <td style={{ fontFamily: "monospace", fontSize: 13 }}>{fmtKbs(h.avgUploadKbs)}</td>
                            <td style={{ fontFamily: "monospace", fontSize: 13 }}>{h.avgDownloadKbs > 0 ? fmtKbs(h.avgDownloadKbs) : <span style={{ color: "#d1d5db" }}>—</span>}</td>
                            <td style={{ fontFamily: "monospace", fontSize: 13 }}>{fmtMs(h.latency?.avg ?? 0)}</td>
                            <td style={{ fontFamily: "monospace", fontSize: 13 }}>{fmtMs(h.tx?.submitTime ?? 0)}</td>
                            <td style={{ fontFamily: "monospace", fontSize: 13 }}>{fmtMs(h.tx?.confirmTime ?? 0)}</td>
                            <td style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{h.runAt}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}