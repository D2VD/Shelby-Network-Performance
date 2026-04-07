"use client";
/**
 * app/dashboard/charts/page.tsx — v9.0
 * - Light theme (var CSS tokens từ ThemeContext)
 * - CrosshairChart: tooltip chỉ hiện khi mouse TRONG bounds SVG
 * - Click vào bất kỳ điểm nào cũng pin tooltip
 * - Full numbers: toLocaleString("en-US") — không M/K
 * - Pending/Deleted: per-series scale để thấy fluctuation nhỏ
 * - Stat strip: số đầy đủ
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme } from "@/components/theme-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LivePoint {
  ts: number; blockHeight: number;
  activeBlobs: number | null; totalStorageBytes: number | null;
  totalBlobEvents: number | null; pendingOrFailed: number | null; deletedBlobs: number | null;
}
interface TsPoint {
  tsMs: number; activeBlobs: number; totalStorageGB: number;
  totalBlobEvents: number; pendingOrFailed: number; deletedBlobs: number; blockHeight?: number;
}
interface BenchEntry {
  id: number; score: number; avgUploadKbs: number; avgDownloadKbs: number;
  latency: { avg: number }; tx: { submitTime: number; confirmTime: number }; mode: string; runAt: string;
}
type TimeRange = "1h" | "24h" | "7d" | "30d";

const MAX_LOCAL = 120;
const POLL_MS   = 30_000;
const LOCAL_KEY = "shelby_bench_history_v3";

// ─── Formatters ───────────────────────────────────────────────────────────────
// RULE: Stat cards & chart header — full numbers (no M/K)
function fmtFull(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("en-US");
}
function fmtGB(b: number | null | undefined): string {
  if (b == null) return "—";
  return `${b.toFixed(2)} GB`;
}
function fmtMs(ms: number): string { return ms >= 1000 ? `${(ms/1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`; }
function fmtKbs(k: number): string { return k >= 1024 ? `${(k/1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`; }
function tLabel(ts: number, range: TimeRange): string {
  const d = new Date(ts);
  if (range === "1h" || range === "24h") return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${d.getMonth()+1}/${d.getDate()}`;
}

// ─── Crosshair Chart ──────────────────────────────────────────────────────────
interface ChartSeries { data: number[]; color: string; name: string; fmtVal?: (v: number) => string; }

function CrosshairChart({
  series, labels, height = 160, range, perSeriesScale = false,
}: {
  series: ChartSeries[]; labels: string[]; height?: number;
  range: TimeRange; perSeriesScale?: boolean;
}) {
  const { isDark } = useTheme();
  const [hover,   setHover]   = useState<{ idx: number; x: number; y: number } | null>(null);
  const [pinned,  setPinned]  = useState<{ idx: number; x: number; y: number } | null>(null);
  const [inside,  setInside]  = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 600, pad = { t: 16, b: 24, l: 60, r: 12 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const n = Math.max(...series.map(s => s.data.length), 1);

  const allData = series.flatMap(s => s.data);
  if (allData.filter(v => v > 0).length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12, flexDirection: "column", gap: 6 }}>
      <div style={{ width: 20, height: 20, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "chart-spin 1s linear infinite" }} />
      Collecting data…
    </div>
  );

  // Per-series scale (for Pending/Deleted) OR global scale
  const globalMin = perSeriesScale ? 0 : Math.min(...allData.filter(v => v > 0)) * 0.97;
  const globalMax = perSeriesScale ? 0 : Math.max(...allData) * 1.03;

  // Per-series min/max per series for perSeriesScale
  const seriesDomains = series.map(s => {
    const vals = s.data.filter(v => v > 0);
    if (!vals.length) return { min: 0, max: 1 };
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const pad_ = (mx - mn) * 0.08 || mn * 0.05 || 1;
    return { min: Math.max(0, mn - pad_), max: mx + pad_ };
  });

  const xs = (i: number) => pad.l + (i / Math.max(n - 1, 1)) * iW;
  // When perSeriesScale, each series gets its own Y mapping
  const ys = (v: number, si = 0) => {
    if (perSeriesScale) {
      const { min, max } = seriesDomains[si];
      const r = max - min || 1;
      return pad.t + iH - ((v - min) / r) * iH;
    }
    const r = globalMax - globalMin || 1;
    return pad.t + iH - ((v - globalMin) / r) * iH;
  };

  const fmtY = (v: number) => {
    if (v >= 1e9)  return `${(v/1e9).toFixed(1)}G`;
    if (v >= 1e6)  return `${(v/1e6).toFixed(1)}M`;
    if (v >= 1e3)  return `${(v/1e3).toFixed(0)}K`;
    return String(Math.round(v));
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!inside) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    if (relX < pad.l || relX > W - pad.r) { setHover(null); return; }
    const idx = Math.round(((relX - pad.l) / iW) * (n - 1));
    const clamped = Math.max(0, Math.min(n - 1, idx));
    setHover({ idx: clamped, x: relX, y: e.clientY - rect.top });
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (hover) setPinned(p => p?.idx === hover.idx ? null : hover);
  };

  const activeHover = pinned ?? hover;

  const gridColor = isDark ? "#1e3a5f" : "#e5e7eb";
  const tickColor = "var(--text-dim)";

  // Y-axis labels
  const yLabels = perSeriesScale
    ? [0, 0.25, 0.5, 0.75, 1].map(f => {
        const { min, max } = seriesDomains[0];
        return { f, v: min + f * (max - min) };
      })
    : [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, v: globalMin + f * (globalMax - globalMin) }));

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setInside(true)}
      onMouseLeave={() => { setInside(false); setHover(null); }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", height, display: "block", cursor: "crosshair" }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      >
        <style>{`@keyframes chart-spin{to{transform:rotate(360deg)}}`}</style>

        {/* Grid */}
        {yLabels.map(({ f, v }) => {
          const y = pad.t + iH - f * iH;
          return (
            <g key={f}>
              <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke={gridColor} strokeWidth={1} />
              <text x={pad.l-5} y={y+3} textAnchor="end" fontSize={9} fill={tickColor}>{fmtY(v)}</text>
            </g>
          );
        })}

        {/* Gradient fills */}
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`cg${si}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={isDark ? 0.35 : 0.2} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>

        {/* Series */}
        {series.map((s, si) => {
          if (s.data.length < 2) return null;
          const pts = s.data.map((v, i) => `${xs(i).toFixed(1)},${ys(v, si).toFixed(1)}`).join(" ");
          const area = `${pad.l},${pad.t+iH} ${pts} ${xs(s.data.length-1).toFixed(1)},${pad.t+iH}`;
          return (
            <g key={si}>
              <polygon points={area} fill={`url(#cg${si})`} />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" />
            </g>
          );
        })}

        {/* Crosshair */}
        {activeHover && inside && (
          <g>
            <line
              x1={Math.min(Math.max(activeHover.x, pad.l), W-pad.r)}
              y1={pad.t}
              x2={Math.min(Math.max(activeHover.x, pad.l), W-pad.r)}
              y2={pad.t+iH}
              stroke={isDark ? "#64748b" : "#94a3b8"} strokeWidth={1} strokeDasharray="3 3"
            />
            {series.map((s, si) => {
              const v = s.data[activeHover.idx];
              if (v == null) return null;
              return <circle key={si} cx={xs(activeHover.idx)} cy={ys(v, si)} r={4} fill={s.color} stroke={isDark ? "#0f172a" : "#fff"} strokeWidth={2} />;
            })}
          </g>
        )}

        {/* X axis labels */}
        {labels.length > 0 && [0, Math.floor(labels.length/2), labels.length-1].map(i => (
          labels[i] ? (
            <text key={i} x={xs(i)} y={height-4} textAnchor="middle" fontSize={9} fill={tickColor}>{labels[i]}</text>
          ) : null
        ))}
      </svg>

      {/* Tooltip — only when inside SVG bounds */}
      {activeHover && inside && (
        <div style={{
          position: "absolute",
          left: Math.min(activeHover.x / W * 100 + 2, 55) + "%",
          top: Math.max(activeHover.y - 75, 4),
          background: "var(--bg-card)",
          border: `1px solid var(--border)`,
          borderRadius: 8, padding: "8px 12px",
          fontSize: 11, pointerEvents: "none", zIndex: 50,
          minWidth: 130,
          boxShadow: "0 4px 14px var(--shadow-color)",
        }}>
          {pinned && <div style={{ fontSize: 9, color: "var(--accent)", marginBottom: 3, fontWeight: 600 }}>📌 Pinned · click to unpin</div>}
          {labels[activeHover.idx] && <div style={{ color: "var(--text-dim)", fontSize: 10, marginBottom: 4 }}>{labels[activeHover.idx]}</div>}
          {series.map((s, si) => {
            const v = s.data[activeHover.idx];
            if (v == null) return null;
            const fv = s.fmtVal ? s.fmtVal(v) : fmtFull(v);
            return (
              <div key={si} style={{ display: "flex", justifyContent: "space-between", gap: 10, color: s.color, marginBottom: 2 }}>
                <span style={{ color: "var(--text-muted)" }}>{s.name}</span>
                <span style={{ fontWeight: 700, fontFamily: "monospace" }}>{fv}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>{title}</h2>
        {sub && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function ChartCard({ children, title, sub, latest, latestColor }: {
  children: React.ReactNode; title: string; sub?: string; latest?: string; latestColor?: string;
}) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "18px 20px",
      transition: "background 0.2s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{sub}</div>}
        </div>
        {latest && (
          <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: latestColor ?? "var(--text-primary)" }}>
            {latest}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function OverviewStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "14px 18px",
      transition: "background 0.2s",
    }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color ?? "var(--text-primary)", fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function RangeSelector({ range, onChange }: { range: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "var(--bg-card2)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
      {(["1h","24h","7d","30d"] as TimeRange[]).map(r => (
        <button key={r} onClick={() => onChange(r)} style={{
          padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: range === r ? 700 : 400,
          border: "none", cursor: "pointer",
          background: range === r ? "var(--accent)" : "transparent",
          color: range === r ? "#fff" : "var(--text-muted)",
          transition: "all 0.12s",
        }}>
          {r}
        </button>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();
  const { isDark } = useTheme();
  const [range,      setRange]     = useState<TimeRange>("24h");
  const [points,     setPoints]    = useState<LivePoint[]>([]);
  const [tsData,     setTsData]    = useState<TsPoint[]>([]);
  const [polling,    setPolling]   = useState(false);
  const [lastFetch,  setLastFetch] = useState<Date | null>(null);
  const [bench,      setBench]     = useState<BenchEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLive = useCallback(async () => {
    setPolling(true);
    try {
      const res  = await fetch(`/api/network/stats/live?network=${network}`);
      const json = await res.json() as any;
      const d = json.data ?? json;
      setPoints(prev => [...prev, {
        ts: Date.now(),
        blockHeight: d.blockHeight ?? 0,
        activeBlobs: d.activeBlobs ?? null,
        totalStorageBytes: d.totalStorageBytes ?? null,
        totalBlobEvents: d.totalBlobEvents ?? null,
        pendingOrFailed: d.pendingOrFailed ?? null,
        deletedBlobs: d.deletedBlobs ?? null,
      }].slice(-MAX_LOCAL));
      setLastFetch(new Date());
    } catch {}
    setPolling(false);
  }, [network]);

  const fetchTs = useCallback(async (r: TimeRange) => {
    try {
      const res_ = r === "1h" || r === "24h" ? "5m" : "1h";
      const res  = await fetch(`/api/network/stats/timeseries?network=${network}&resolution=${res_}&range=${r}`);
      if (!res.ok) return;
      const j = await res.json() as any;
      setTsData((j.data?.series ?? []).map((s: any) => ({
        tsMs: s.tsMs, activeBlobs: s.activeBlobs ?? 0,
        totalStorageGB: s.totalStorageGB ?? 0,
        totalBlobEvents: s.totalBlobEvents ?? 0,
        pendingOrFailed: s.pendingOrFailed ?? 0,
        deletedBlobs: s.deletedBlobs ?? 0,
        blockHeight: s.blockHeight ?? 0,
      })));
    } catch {}
  }, [network]);

  useEffect(() => {
    setPoints([]);
    fetchLive();
    timerRef.current = setInterval(fetchLive, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLive]);

  useEffect(() => { fetchTs(range); }, [range, fetchTs]);

  useEffect(() => {
    try { const s = localStorage.getItem(LOCAL_KEY); if (s) setBench(JSON.parse(s)); } catch {}
  }, []);

  const cd = tsData.length > 0 ? tsData : points.map(p => ({
    tsMs: p.ts, activeBlobs: p.activeBlobs ?? 0,
    totalStorageGB: p.totalStorageBytes ? p.totalStorageBytes/1e9 : 0,
    totalBlobEvents: p.totalBlobEvents ?? 0,
    pendingOrFailed: p.pendingOrFailed ?? 0,
    deletedBlobs: p.deletedBlobs ?? 0,
    blockHeight: p.blockHeight,
  }));

  const labels   = cd.map(p => tLabel(p.tsMs, range));
  const latest   = points[points.length - 1];
  const latestTs = cd[cd.length - 1];

  if (network === "testnet") return <TestnetBanner />;

  return (
    <div style={{
      background: "var(--bg-primary)", minHeight: "100vh",
      padding: "28px 36px 48px",
      transition: "background 0.2s",
    }}>
      <style>{`@keyframes chart-spin{to{transform:rotate(360deg)}}`}</style>

      {/* Page Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.5 }}>
            Network Analytics
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
            {config.label} · {POLL_MS/1000}s polling · {lastFetch ? lastFetch.toLocaleTimeString() : "—"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RangeSelector range={range} onChange={setRange} />
          <button onClick={fetchLive} disabled={polling} style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: "var(--bg-card)", border: "1px solid var(--border)",
            color: "var(--text-muted)", cursor: "pointer",
          }}>
            {polling ? "⟳ Syncing…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* ── Block Overview — FULL NUMBERS ── */}
      <Section title="Block Overview" sub="Last block stats from Shelbynet">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 18 }}>
          <OverviewStat label="Block Height"  value={latest ? `#${latest.blockHeight.toLocaleString("en-US")}` : "—"} color="var(--accent)" />
          <OverviewStat label="Active Blobs"  value={fmtFull(latestTs?.activeBlobs)}       color="#22c55e" />
          <OverviewStat label="Storage Used"  value={fmtGB(latestTs?.totalStorageGB)}       color="#a78bfa" />
          <OverviewStat label="Blob Events"   value={fmtFull(latestTs?.totalBlobEvents)}    color="#fb923c" />
          <OverviewStat label="Pending Blobs" value={fmtFull(latestTs?.pendingOrFailed)}    color="#fbbf24" />
          <OverviewStat label="Deleted Blobs" value={fmtFull(latestTs?.deletedBlobs)}       color="#f87171" />
        </div>
      </Section>

      {/* ── Blob Analytics ── */}
      <Section title="Blob Analytics" sub="Blob count and activity over time">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <ChartCard title="Active Blobs" sub={`${range} window`}
            latest={fmtFull(latestTs?.activeBlobs)} latestColor="#22c55e">
            <CrosshairChart range={range} series={[{ data: cd.map(p => p.activeBlobs), color: "#22c55e", name: "Active", fmtVal: fmtFull }]} labels={labels} height={150} />
          </ChartCard>
          <ChartCard title="Blob Events" sub="blob_activities_aggregate count"
            latest={fmtFull(latestTs?.totalBlobEvents)} latestColor="#fb923c">
            <CrosshairChart range={range} series={[{ data: cd.map(p => p.totalBlobEvents), color: "#fb923c", name: "Events", fmtVal: fmtFull }]} labels={labels} height={150} />
          </ChartCard>
        </div>

        {/* Pending & Deleted: perSeriesScale=true để hiện fluctuation dù nhỏ */}
        <ChartCard title="Pending & Deleted Blobs" sub="Anomaly tracking · auto-scaled per series to show small changes">
          <CrosshairChart range={range} height={130} labels={labels} perSeriesScale={true} series={[
            { data: cd.map(p => p.pendingOrFailed), color: "#fbbf24", name: "Pending", fmtVal: fmtFull },
            { data: cd.map(p => p.deletedBlobs),    color: "#f87171", name: "Deleted", fmtVal: fmtFull },
          ]} />
        </ChartCard>
      </Section>

      {/* ── Storage Analytics ── */}
      <Section title="Storage Analytics" sub="Storage capacity and utilization">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <ChartCard title="Storage Used (GB)" sub="Active blobs sum.size from Shelby Indexer"
            latest={latestTs ? `${latestTs.totalStorageGB.toFixed(2)} GB` : "—"} latestColor="#a78bfa">
            <CrosshairChart range={range} height={160} labels={labels} series={[
              { data: cd.map(p => p.totalStorageGB), color: "#a78bfa", name: "GB", fmtVal: v => `${v.toFixed(2)} GB` },
            ]} />
          </ChartCard>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Total Storage", val: latestTs ? `${latestTs.totalStorageGB.toFixed(2)} GB` : "—", c: "#a78bfa" },
              { label: "Active Blobs",  val: fmtFull(latestTs?.activeBlobs), c: "#22c55e" },
              { label: "Avg Blob Size", val: latestTs && latestTs.activeBlobs > 0 ? `${((latestTs.totalStorageGB*1e9)/latestTs.activeBlobs/1024).toFixed(0)} KB` : "—", c: "var(--accent)" },
            ].map(({ label, val, c }) => (
              <div key={label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: "monospace" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Block Performance ── */}
      <Section title="Block Performance" sub="Block height progression on Shelbynet">
        <ChartCard title="Block Height" sub="Aptos block progression"
          latest={latest ? `#${latest.blockHeight.toLocaleString("en-US")}` : "—"} latestColor="var(--accent)">
          <CrosshairChart range={range} height={140} labels={labels} series={[
            {
              data: cd.map(p => p.blockHeight ?? 0).some(v => v > 0)
                ? cd.map(p => p.blockHeight ?? 0)
                : points.map(p => p.blockHeight).filter(Boolean),
              color: "var(--accent)", name: "Block",
              fmtVal: v => `#${Math.round(v).toLocaleString("en-US")}`,
            },
          ]} />
        </ChartCard>
      </Section>

      {/* ── Benchmark Analytics ── */}
      {bench.length > 0 && (
        <Section title="Benchmark Analytics" sub="Historical performance from your benchmark runs">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 18 }}>
            {(() => {
              const n = bench.length;
              const avg = (fn: (h: BenchEntry) => number) => Math.round(bench.reduce((s,h) => s + fn(h), 0) / n);
              return [
                { label: "Total Runs",   val: String(n),                       c: "var(--text-muted)" },
                { label: "Avg Score",    val: `${avg(h=>h.score)}/1000`,        c: avg(h=>h.score)>=700?"#22c55e":"#fbbf24" },
                { label: "Avg Upload",   val: fmtKbs(avg(h=>h.avgUploadKbs)),  c: "var(--accent)" },
                { label: "Avg Download", val: fmtKbs(avg(h=>h.avgDownloadKbs)),c: "#34d399" },
                { label: "Avg Latency",  val: fmtMs(avg(h=>h.latency?.avg??0)),c: "#c084fc" },
                { label: "Avg TX",       val: fmtMs(avg(h=>h.tx?.confirmTime??0)),c:"#fb923c" },
              ].map(({ label, val, c }) => <OverviewStat key={label} label={label} value={val} color={c} />);
            })()}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <ChartCard title="Score per Run" sub="Benchmark score history"
              latest={`${bench[bench.length-1]?.score ?? 0}/1000`}
              latestColor={bench[bench.length-1]?.score >= 700 ? "#22c55e" : "#fbbf24"}>
              <CrosshairChart range={range} height={130} labels={bench.map(h => h.runAt.split(" ")[1]?.slice(0,5) ?? "")} series={[
                { data: bench.map(h => h.score), color: "#818cf8", name: "Score", fmtVal: v => `${Math.round(v)}/1000` },
              ]} />
            </ChartCard>
            <ChartCard title="Upload & Download Speed" sub="KB/s performance">
              <CrosshairChart range={range} height={130} labels={bench.map(h => h.runAt.split(" ")[1]?.slice(0,5) ?? "")} series={[
                { data: bench.map(h => h.avgUploadKbs),   color: "var(--accent)", name: "Upload",   fmtVal: fmtKbs },
                { data: bench.map(h => h.avgDownloadKbs), color: "#34d399", name: "Download", fmtVal: fmtKbs },
              ]} />
            </ChartCard>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 18 }}>
            {[
              { title: "Avg Latency", data: bench.map(h=>h.latency?.avg??0), color: "#c084fc", fmtV: fmtMs },
              { title: "TX Submit",   data: bench.map(h=>h.tx?.submitTime??0), color: "#fb923c", fmtV: fmtMs },
              { title: "TX Confirm",  data: bench.map(h=>h.tx?.confirmTime??0), color: "#f87171", fmtV: fmtMs },
            ].map(({ title, data, color, fmtV }) => (
              <ChartCard key={title} title={title} latest={data.length > 0 ? fmtV(data[data.length-1]) : "—"} latestColor={color}>
                <CrosshairChart range={range} height={100} labels={bench.map(h=>h.runAt.split(" ")[1]?.slice(0,5)??"") } series={[{ data, color, name: title, fmtVal: fmtV }]} />
              </ChartCard>
            ))}
          </div>

          {/* Run history table */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Run History</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{bench.length} runs</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--bg-card2)" }}>
                    {["#","Mode","Score","Upload","Download","Latency","TX Submit","TX Confirm","At"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...bench].reverse().map((h, i) => {
                    const c = h.score >= 900 ? "#22c55e" : h.score >= 600 ? "#fbbf24" : "#f87171";
                    return (
                      <tr key={h.id ?? i} style={{ borderTop: "1px solid var(--border-soft)" }}>
                        <td style={{ padding: "8px 12px", color: "var(--text-dim)", fontFamily: "monospace" }}>#{h.id ?? i}</td>
                        <td><span style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", textTransform: "uppercase" }}>{h.mode}</span></td>
                        <td><span style={{ fontFamily: "monospace", fontWeight: 800, color: c }}>{h.score}</span></td>
                        <td style={{ fontFamily: "monospace", color: "var(--accent)" }}>{fmtKbs(h.avgUploadKbs)}</td>
                        <td style={{ fontFamily: "monospace", color: "#34d399" }}>{h.avgDownloadKbs > 0 ? fmtKbs(h.avgDownloadKbs) : <span style={{ color: "var(--text-dim)" }}>—</span>}</td>
                        <td style={{ fontFamily: "monospace", color: "#c084fc" }}>{fmtMs(h.latency?.avg ?? 0)}</td>
                        <td style={{ fontFamily: "monospace", color: "#fb923c" }}>{fmtMs(h.tx?.submitTime ?? 0)}</td>
                        <td style={{ fontFamily: "monospace", color: "#f87171" }}>{fmtMs(h.tx?.confirmTime ?? 0)}</td>
                        <td style={{ color: "var(--text-dim)", fontFamily: "monospace", fontSize: 10 }}>{h.runAt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}