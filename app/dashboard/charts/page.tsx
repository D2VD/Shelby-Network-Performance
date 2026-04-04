"use client";
/**
 * app/dashboard/charts/page.tsx — v7.0
 * FIX: Network tab dùng /api/network/stats/live (VPS cache, nhanh)
 * FIX: Benchmark tab lấy từ localStorage khi VPS không có benchmark-results
 * + Thêm latency, TX submit, TX confirm vào chart
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  mode: "adaptive" | "standard";
}

type Tab = "network" | "benchmark";

const MAX_POINTS = 120;
const POLL_MS    = 30_000;
const LOCAL_KEY  = "shelby_bench_history_v3";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
function LineChart({ data, color = "#2563eb", height = 140, formatY, label }: {
  data: number[]; color?: string; height?: number;
  formatY?: (v: number) => string; label?: string;
}) {
  if (data.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gray-400)", fontSize: 13, flexDirection: "column", gap: 8 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid #e5e7eb", borderTopColor: color, animation: "spin 1s linear infinite" }} />
      Collecting data…
    </div>
  );
  const W = 600, pad = { t: 10, b: 20, l: 56, r: 10 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const xs = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t + iH} ${line} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gId = `lc${color.replace(/[^a-z0-9]/gi, "")}`;
  const fmt = formatY ?? ((v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(Math.round(v));
  });
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
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

function StatBadge({ label, value, color = "var(--gray-800)" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color }}>{value}</div>
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const { network, config } = useNetwork();
  const [tab,     setTab]     = useState<Tab>("network");
  const [points,  setPoints]  = useState<LivePoint[]>([]);
  const [polling, setPolling] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Network: fetch từ VPS live endpoint ──
  const fetchLive = useCallback(async () => {
    setPolling(true);
    try {
      // Ưu tiên VPS live (có blob breakdown)
      const res = await fetch(`/api/network/stats/live?network=${network}`);
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
      setPoints(prev => [...prev, point].slice(-MAX_POINTS));
      setLastFetch(new Date());
      setLastError(null);
    } catch (e: any) {
      setLastError(e.message);
    } finally {
      setPolling(false);
    }
  }, [network]);

  useEffect(() => {
    setPoints([]);
    fetchLive();
    timerRef.current = setInterval(fetchLive, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLive]);

  // ── Benchmark: load từ localStorage (reliable) + try VPS ──
  useEffect(() => {
    if (tab !== "benchmark") return;
    // 1. Load từ localStorage ngay
    try {
      const s = localStorage.getItem(LOCAL_KEY);
      if (s) {
        const h = JSON.parse(s) as HistoryEntry[];
        setHistory(h);
      }
    } catch {}

    // 2. Try VPS benchmark-results
    fetch("/api/geo-sync/benchmark-results?type=all")
      .then(r => r.json())
      .catch(() => null)
      .then(j => {
        if (j?.ok && Array.isArray(j.data) && j.data.length > 0) {
          // Merge với localStorage
          setHistory(prev => {
            const merged = [...prev, ...j.data].filter((v, i, arr) =>
              arr.findIndex(x => x.runAt === v.runAt) === i
            ).sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());
            return merged.slice(-50);
          });
        }
      });
  }, [tab]);

  const latest = points[points.length - 1];
  const blobSeries    = points.map(p => p.activeBlobs ?? 0).filter(Boolean);
  const storageSeries = points.map(p => p.totalStorageBytes ?? 0).filter(Boolean);
  const eventSeries   = points.map(p => p.totalBlobEvents ?? 0).filter(Boolean);
  const blockSeries   = points.map(p => p.blockHeight).filter(Boolean);
  const pendingSeries = points.map(p => p.pendingOrFailed ?? 0);
  const deletedSeries = points.map(p => p.deletedBlobs ?? 0);

  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0, letterSpacing: -0.5 }}>Network Charts</h1>
          <p style={{ fontSize: 13, color: "#9ca3af", margin: "4px 0 0" }}>
            {config.label} · polling every {POLL_MS/1000}s · {points.length} points
            {lastFetch && ` · ${lastFetch.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", background: "#f4f4f4", borderRadius: 10, padding: 3, gap: 2 }}>
            {(["network", "benchmark"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                fontWeight: tab === t ? 600 : 400,
                color: tab === t ? "#0a0a0a" : "#999",
                background: tab === t ? "#fff" : "transparent",
                boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                border: "none",
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
          {/* Live strip */}
          {latest && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ padding: "12px 20px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                  <span style={{ fontSize: 12, color: "var(--gray-500)" }}>Live</span>
                </div>
                {[
                  { label: "Block",     value: `#${latest.blockHeight.toLocaleString()}`,       color: "var(--net-color, #2563eb)" },
                  { label: "Blobs",     value: fmtNum(latest.activeBlobs),                       color: "var(--gray-800)" },
                  { label: "Storage",   value: fmtBytes(latest.totalStorageBytes),               color: "#16a34a" },
                  { label: "Events",    value: fmtNum(latest.totalBlobEvents),                   color: "#9333ea" },
                  { label: "Pending",   value: fmtNum(latest.pendingOrFailed),                   color: "#f59e0b" },
                  { label: "Deleted",   value: fmtNum(latest.deletedBlobs),                      color: "#ef4444" },
                ].map(({ label, value, color }) => (
                  <StatBadge key={label} label={label} value={value} color={color} />
                ))}
                <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>
                  {points.length}/{MAX_POINTS} pts · {POLL_MS/1000}s
                </div>
              </div>
            </div>
          )}

          {/* Charts grid */}
          {[
            { title: "Active Blobs", sub: "Files stored on-chain (Shelby Indexer)", data: blobSeries, color: "#2563eb", latest: fmtNum(blobSeries[blobSeries.length-1] || null), height: 140 },
            { title: "Block Height", sub: "Aptos block progression",               data: blockSeries, color: "#059669", latest: `#${(blockSeries[blockSeries.length-1] || 0).toLocaleString()}`, height: 120 },
            { title: "Storage Used", sub: "Actual bytes (Shelby Indexer sum)",     data: storageSeries, color: "#9333ea", latest: fmtBytes(storageSeries[storageSeries.length-1] || null), height: 120 },
            { title: "Blob Events",  sub: "blob_activities count",                 data: eventSeries, color: "#d97706", latest: fmtNum(eventSeries[eventSeries.length-1] || null), height: 120 },
            { title: "Pending/Failed Blobs", sub: "is_written=0, is_deleted=0",   data: pendingSeries.filter(Boolean), color: "#f59e0b", latest: fmtNum(pendingSeries[pendingSeries.length-1] || null), height: 110 },
            { title: "Deleted Blobs", sub: "is_deleted=1",                         data: deletedSeries.filter(Boolean), color: "#ef4444", latest: fmtNum(deletedSeries[deletedSeries.length-1] || null), height: 110 },
          ].map(({ title, sub, data, color, latest: lat, height }) => (
            <div key={title} className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">{title} — live</div>
                  <div className="card-subtitle">{sub}</div>
                </div>
                {data.length > 0 && <MiniStat label="Latest" value={lat} color={color} />}
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                <LineChart data={data} color={color} height={height} />
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── BENCHMARK TAB ── */}
      {tab === "benchmark" && (
        <>
          {history.length === 0 ? (
            <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 14, color: "var(--gray-400)", marginBottom: 8 }}>No benchmark data yet</div>
              <div style={{ fontSize: 12, color: "var(--gray-300)" }}>Run benchmarks on the Benchmark page to populate charts</div>
            </div>
          ) : (
            <>
              {/* Summary strip */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-body" style={{ padding: "12px 20px", display: "flex", gap: 24, flexWrap: "wrap" }}>
                  {(() => {
                    const totalRuns = history.length;
                    const avgScore  = Math.round(history.reduce((s, h) => s + h.score, 0) / totalRuns);
                    const avgUp     = Math.round(history.reduce((s, h) => s + h.avgUploadKbs, 0) / totalRuns);
                    const avgDown   = Math.round(history.reduce((s, h) => s + h.avgDownloadKbs, 0) / totalRuns);
                    const avgLat    = Math.round(history.reduce((s, h) => s + (h.latency?.avg ?? 0), 0) / totalRuns);
                    const avgTx     = Math.round(history.reduce((s, h) => s + (h.tx?.confirmTime ?? 0), 0) / totalRuns);
                    return [
                      { label: "Total runs",  value: String(totalRuns), color: "var(--gray-800)" },
                      { label: "Avg score",   value: `${avgScore}/1000`, color: avgScore >= 700 ? "#16a34a" : avgScore >= 450 ? "#ca8a04" : "#dc2626" },
                      { label: "Avg upload",  value: fmtKbs(avgUp),     color: "#2563eb" },
                      { label: "Avg download",value: fmtKbs(avgDown),   color: "#16a34a" },
                      { label: "Avg latency", value: fmtMs(avgLat),     color: "#9333ea" },
                      { label: "Avg TX",      value: fmtMs(avgTx),      color: "#f59e0b" },
                    ].map(({ label, value, color }) => <StatBadge key={label} label={label} value={value} color={color} />);
                  })()}
                </div>
              </div>

              {/* Score + Upload + Download */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div><div className="card-title">Benchmark Score</div><div className="card-subtitle">Score per run</div></div>
                  <MiniStat label="Latest" value={`${history[history.length-1]?.score ?? 0}/1000`} color="#2563eb" />
                </div>
                <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                  <LineChart data={history.map(h => h.score)} color="#2563eb" height={140} formatY={v => `${v}`} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">Upload Speed</div><div className="card-subtitle">KB/s per run</div></div>
                    <MiniStat label="Latest" value={fmtKbs(history[history.length-1]?.avgUploadKbs ?? 0)} color="#2563eb" />
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={history.map(h => h.avgUploadKbs)} color="#2563eb" height={110} />
                  </div>
                </div>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Download Speed</div>
                      <div className="card-subtitle">KB/s per run (0 = download not tested)</div>
                    </div>
                    <MiniStat label="Latest" value={fmtKbs(history[history.length-1]?.avgDownloadKbs ?? 0)} color="#16a34a" />
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={history.map(h => h.avgDownloadKbs)} color="#16a34a" height={110} />
                  </div>
                </div>
              </div>

              {/* Latency + TX submit + TX confirm */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">Avg Latency</div><div className="card-subtitle">Node ping ms</div></div>
                    <MiniStat label="Latest" value={fmtMs(history[history.length-1]?.latency?.avg ?? 0)} color="#9333ea" />
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={history.map(h => h.latency?.avg ?? 0)} color="#9333ea" height={100} formatY={v => `${v.toFixed(0)}ms`} />
                  </div>
                </div>
                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">TX Submit</div><div className="card-subtitle">Aptos submit ms</div></div>
                    <MiniStat label="Latest" value={fmtMs(history[history.length-1]?.tx?.submitTime ?? 0)} color="#f59e0b" />
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={history.map(h => h.tx?.submitTime ?? 0)} color="#f59e0b" height={100} formatY={v => `${v.toFixed(0)}ms`} />
                  </div>
                </div>
                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">TX Confirm</div><div className="card-subtitle">Aptos finality ms</div></div>
                    <MiniStat label="Latest" value={fmtMs(history[history.length-1]?.tx?.confirmTime ?? 0)} color="#ef4444" />
                  </div>
                  <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                    <LineChart data={history.map(h => h.tx?.confirmTime ?? 0)} color="#ef4444" height={100} formatY={v => `${v.toFixed(0)}ms`} />
                  </div>
                </div>
              </div>

              {/* History table */}
              <div className="card">
                <div className="card-header">
                  <div><div className="card-title">Run History</div><div className="card-subtitle">{history.length} runs</div></div>
                </div>
                <div className="card-body" style={{ padding: 0, overflowX: "auto" }}>
                  <table className="data-table" style={{ minWidth: 700 }}>
                    <thead>
                      <tr><th>#</th><th>Mode</th><th>Score</th><th>Upload</th><th>Download</th><th>Latency</th><th>TX Submit</th><th>TX Confirm</th><th>At</th></tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((h, i) => {
                        const TIER_COLOR: Record<string, string> = { "Blazing Fast": "#16a34a", "Excellent": "#059669", "Good": "#ca8a04", "Fair": "#d97706", "Poor": "#dc2626" };
                        const c = TIER_COLOR[h.tier] ?? "#6b7280";
                        return (
                          <tr key={h.id ?? i}>
                            <td><span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>#{h.id ?? i}</span></td>
                            <td><span style={{ fontSize: 10, fontWeight: 600, color: h.mode === "adaptive" ? "#2563eb" : "#9333ea", textTransform: "uppercase" }}>{h.mode}</span></td>
                            <td><span style={{ fontFamily: "monospace", fontWeight: 700, color: c }}>{h.score}</span></td>
                            <td><span style={{ fontFamily: "monospace", fontSize: 12 }}>{fmtKbs(h.avgUploadKbs)}</span></td>
                            <td><span style={{ fontFamily: "monospace", fontSize: 12 }}>{h.avgDownloadKbs > 0 ? fmtKbs(h.avgDownloadKbs) : <span style={{ color: "#d1d5db" }}>—</span>}</span></td>
                            <td><span style={{ fontFamily: "monospace", fontSize: 12 }}>{fmtMs(h.latency?.avg ?? 0)}</span></td>
                            <td><span style={{ fontFamily: "monospace", fontSize: 12 }}>{fmtMs(h.tx?.submitTime ?? 0)}</span></td>
                            <td><span style={{ fontFamily: "monospace", fontSize: 12 }}>{fmtMs(h.tx?.confirmTime ?? 0)}</span></td>
                            <td><span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>{h.runAt}</span></td>
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