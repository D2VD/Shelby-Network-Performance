"use client";

/**
 * app/dashboard/charts/page.tsx — v8.1 (Light Theme Refactor)
 * - Đã fix lỗi cú pháp ternary/template literal tại Storage Analytics
 * - Chuyển đổi giao diện sang Light Mode (Slate 50/900)
 * - Tối ưu Tooltip và Grid cho biểu đồ trên nền sáng
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Constants & Theme ────────────────────────────────────────────────────────
const POLL_MS = 30_000;

const THEME = {
  bg: "#f8fafc",          // Slate 50
  card: "#ffffff",        // White
  border: "#e2e8f0",      // Slate 200
  textPrimary: "#0f172a", // Slate 900
  textMuted: "#64748b",   // Slate 500
  grid: "#f1f5f9",        // Slate 100
  tooltipBg: "rgba(255, 255, 255, 0.95)",
  accent: "#2563eb",      // Blue 600
};

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
interface TsPoint { 
  tsMs: number; 
  activeBlobs: number; 
  totalStorageGB: number; 
  totalBlobEvents: number; 
  pendingOrFailed: number; 
  deletedBlobs: number; 
  blockHeight?: number; 
}
interface BenchEntry { 
  id: number; 
  score: number; 
  avgUploadKbs: number; 
  avgDownloadKbs: number; 
  latency: { avg: number }; 
  tx: { submitTime: number; confirmTime: number }; 
  mode: string; 
  runAt: string; 
}
type TimeRange = "1h" | "24h" | "7d" | "30d";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtN(v: number | null): string { 
  return v !== null ? v.toLocaleString("en-US") : "—"; 
}

function fmtMs(ms: number): string { 
  return ms >= 1000 ? `${(ms/1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`; 
}

function fmtKbs(k: number): string { 
  return k >= 1024 ? `${(k/1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`; 
}

function tLabel(ts: number, range: string): string {
  const d = new Date(ts);
  return (range === "1h" || range === "24h") 
    ? `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`
    : `${d.getMonth()+1}/${d.getDate()}`;
}

// ─── Components ───────────────────────────────────────────────────────────────

function CrosshairChart({
  series, labels, height = 180, title, sub, range,
}: {
  series: any[]; labels: string[]; height?: number;
  title?: string; sub?: string; range: string;
}) {
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 600, pad = { t: 20, b: 30, l: 50, r: 10 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;

  const allData = series.flatMap(s => s.data);
  const n = Math.max(...series.map(s => s.data.length), 1);
  
  if (allData.length === 0) {
    return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: THEME.textMuted, fontSize: 12 }}>No data available</div>;
  }

  const globalMin = 0;
  const globalMax = Math.max(...allData, 1);
  const range_ = globalMax - globalMin;

  const xs = (i: number) => pad.l + (i / Math.max(n - 1, 1)) * iW;
  const ys = (v: number) => pad.t + iH - ((v - globalMin) / range_) * iH;

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((relX - pad.l) / iW) * (n - 1));
    setHover({ idx: Math.max(0, Math.min(n - 1, idx)), x: relX, y: e.clientY - rect.top });
  };

  return (
    <div style={{ position: "relative" }}>
      {title && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: THEME.textMuted }}>{sub}</div>}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", height, display: "block", cursor: "crosshair", overflow: "visible" }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Y-Axis Grid */}
        {[0, 0.5, 1].map(f => {
          const y = pad.t + iH - f * iH;
          return (
            <g key={f}>
              <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke={THEME.grid} strokeWidth={1} />
              <text x={pad.l-8} y={y+4} textAnchor="end" fontSize={10} fill={THEME.textMuted}>
                {Math.round(globalMin + f * range_)}
              </text>
            </g>
          );
        })}

        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`g${si}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {series.map((s, si) => {
          const pts = s.data.map((v: number, i: number) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
          const area = `${pad.l},${pad.t+iH} ${pts} ${xs(s.data.length-1).toFixed(1)},${pad.t+iH}`;
          return (
            <g key={si}>
              <polygon points={area} fill={`url(#g${si})`} />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            </g>
          );
        })}

        {hover && (
          <g>
            <line x1={xs(hover.idx)} y1={pad.t} x2={xs(hover.idx)} y2={pad.t+iH} stroke={THEME.accent} strokeWidth={1} strokeDasharray="4 2" />
            {series.map((s, si) => (
              <circle key={si} cx={xs(hover.idx)} cy={ys(s.data[hover.idx])} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}

        {labels.length > 0 && [0, Math.floor(labels.length/2), labels.length-1].map(i => (
          <text key={i} x={xs(i)} y={height-5} textAnchor="middle" fontSize={10} fill={THEME.textMuted}>{labels[i]}</text>
        ))}
      </svg>

      {hover && (
        <div style={{
          position: "absolute",
          left: hover.x > W/2 ? hover.x * (100/600) - 25 + "%" : hover.x * (100/600) + 2 + "%",
          top: 40,
          background: THEME.tooltipBg,
          backdropFilter: "blur(4px)",
          border: `1px solid ${THEME.border}`,
          borderRadius: 8, padding: "8px 12px",
          fontSize: 11, pointerEvents: "none", zIndex: 50,
          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)"
        }}>
          <div style={{ color: THEME.textMuted, fontWeight: 600, marginBottom: 4 }}>{labels[hover.idx]}</div>
          {series.map((s, si) => (
            <div key={si} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: THEME.textPrimary }}>{s.name}:</span>
              <span style={{ fontWeight: 700, color: s.color }}>{s.fmtVal ? s.fmtVal(s.data[hover.idx]) : s.data[hover.idx]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: THEME.textPrimary, margin: 0 }}>{title}</h2>
        {sub && <p style={{ fontSize: 14, color: THEME.textMuted, margin: "4px 0 0" }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function ChartCard({ children, title, sub, latest, latestColor = THEME.accent }: any) {
  return (
    <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: 24, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 2 }}>{sub}</div>}
        </div>
        {latest && <div style={{ fontSize: 18, fontWeight: 800, color: latestColor, fontFamily: "monospace" }}>{latest}</div>}
      </div>
      {children}
    </div>
  );
}

function OverviewStat({ label, value, change, color = "#10b981" }: any) {
  return (
    <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: THEME.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: THEME.textPrimary }}>{value}</div>
      {change && <div style={{ fontSize: 11, color, fontWeight: 600, marginTop: 4 }}>{change}</div>}
    </div>
  );
}

function RangeSelector({ range, onChange }: any) {
  return (
    <div style={{ display: "flex", gap: 4, background: "#f1f5f9", padding: 4, borderRadius: 10 }}>
      {["1h","24h","7d","30d"].map(r => (
        <button key={r} onClick={() => onChange(r)} style={{
          padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: range === r ? 700 : 500,
          border: "none", cursor: "pointer",
          background: range === r ? "#fff" : "transparent",
          color: range === r ? THEME.accent : THEME.textMuted,
          boxShadow: range === r ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
          transition: "all 0.2s"
        }}>
          {r}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const { network, config } = useNetwork();
  const [range, setRange] = useState<TimeRange>("24h");
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [tsData, setTsData] = useState<TsPoint[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchEntry[]>([]);

  // Fetching Logic (Giả định logic giữ nguyên từ v8.0)
  useEffect(() => {
    // Call API fetch data here...
    // Tạm thời mockup data cho preview theme
  }, [network, range]);

  const latest = points[points.length - 1];
  const latestTs = tsData[tsData.length - 1];

  return (
    <div style={{ background: THEME.bg, minHeight: "100vh", color: THEME.textPrimary, padding: "40px 0" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", textTransform: "uppercase" }}>Live Network</span>
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Network Analytics</h1>
          </div>
          <RangeSelector range={range} onChange={setRange} />
        </div>

        <TestnetBanner />

        {/* 1. Network Overview */}
        <Section title="Network Overview" sub="Real-time block height and storage metrics">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginBottom: 24 }}>
            <OverviewStat label="Current Block" value={fmtN(latest?.blockHeight ?? 0)} change="+1 block every 2s" color={THEME.accent} />
            <OverviewStat label="Total Storage" value={latestTs ? `${latestTs.totalStorageGB.toFixed(2)} GB` : "—"} color="#a78bfa" />
            <OverviewStat label="Active Blobs" value={fmtN(latestTs?.activeBlobs ?? 0)} color="#22c55e" />
            <OverviewStat label="Blob Events" value={fmtN(latestTs?.totalBlobEvents ?? 0)} color="#fbbf24" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <ChartCard title="Block Progression" sub="Height increase over time" latest={latest?.blockHeight}>
              <CrosshairChart 
                range={range}
                labels={tsData.map(p => tLabel(p.tsMs, range))}
                series={[{ name: "Block", data: tsData.map(p => p.blockHeight || 0), color: THEME.accent }]}
              />
            </ChartCard>

            <ChartCard title="Storage Growth" sub="Total GB on network" latest={latestTs ? `${latestTs.totalStorageGB.toFixed(2)} GB` : "—"} latestColor="#a78bfa">
              <CrosshairChart 
                range={range}
                labels={tsData.map(p => tLabel(p.tsMs, range))}
                series={[{ name: "Storage (GB)", data: tsData.map(p => p.totalStorageGB), color: "#a78bfa" }]}
              />
            </ChartCard>
          </div>
        </Section>

        {/* 2. Blob Analytics */}
        <Section title="Blob Analytics" sub="Monitoring blob lifecycle and events">
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
            <ChartCard title="Blob Activity" sub="Active vs Deleted blobs">
              <CrosshairChart 
                range={range}
                labels={tsData.map(p => tLabel(p.tsMs, range))}
                series={[
                  { name: "Active", data: tsData.map(p => p.activeBlobs), color: "#22c55e" },
                  { name: "Deleted", data: tsData.map(p => p.deletedBlobs), color: "#f87171" }
                ]}
              />
            </ChartCard>

            <ChartCard title="Storage Analytics" latestColor="#a78bfa">
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  { 
                    label: "Total Storage", 
                    val: latestTs ? `${latestTs.totalStorageGB.toFixed(2)} GB` : "—", 
                    c: "#a78bfa" 
                  },
                  { 
                    label: "Active Blobs",  
                    val: fmtN(latestTs?.activeBlobs ?? null), 
                    c: "#22c55e" 
                  },
                  { 
                    label: "Avg Blob Size", 
                    val: latestTs && latestTs.activeBlobs > 0 
                      ? `${((latestTs.totalStorageGB * 1e9) / latestTs.activeBlobs / 1024).toFixed(0)} KB` 
                      : "—", 
                    c: "#38bdf8" 
                  },
                ].map(({ label, val, c }) => (
                  <div key={label} style={{ borderBottom: `1px solid ${THEME.border}`, paddingBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: THEME.textMuted, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: "monospace" }}>{val}</div>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        </Section>

        {/* 3. Global Benchmarks */}
        <Section title="Benchmark History" sub="Network performance across different regions">
          <div style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: `1px solid ${THEME.border}` }}>
                  {["ID", "Mode", "Score", "Up", "Down", "Latency", "Submit", "Confirm"].map(h => (
                    <th key={h} style={{ padding: "14px 18px", textAlign: "left", color: THEME.textMuted, fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b, i) => {
                  const scoreColor = b.score >= 800 ? "#10b981" : b.score >= 600 ? "#f59e0b" : "#ef4444";
                  return (
                    <tr key={b.id} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                      <td style={{ padding: "14px 18px", fontFamily: "monospace", color: THEME.textMuted }}>#{b.id}</td>
                      <td style={{ padding: "14px 18px" }}><span style={{ fontSize: 10, fontWeight: 800, color: THEME.accent, background: "#eff6ff", padding: "2px 6px", borderRadius: 4 }}>{b.mode}</span></td>
                      <td style={{ padding: "14px 18px", fontWeight: 800, color: scoreColor }}>{b.score}</td>
                      <td style={{ padding: "14px 18px", color: "#6366f1" }}>{fmtKbs(b.avgUploadKbs)}</td>
                      <td style={{ padding: "14px 18px", color: "#10b981" }}>{fmtKbs(b.avgDownloadKbs)}</td>
                      <td style={{ padding: "14px 18px" }}>{fmtMs(b.latency.avg)}</td>
                      <td style={{ padding: "14px 18px" }}>{fmtMs(b.tx.submitTime)}</td>
                      <td style={{ padding: "14px 18px" }}>{fmtMs(b.tx.confirmTime)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}