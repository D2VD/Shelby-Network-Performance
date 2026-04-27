"use client";
// app/dashboard/charts/page.tsx — v27.0 (Phase 2 Step 4)
//
// CHANGES v27.0:
//   - Layout: Tailwind thay inline styles
//   - RangeSelector, SectionHeader, StatCard, RefreshButton, ErrorBanner từ ui.tsx
//   - EpochPanel (NEW): hiển thị epoch::Epoch data từ testnet snap
//   - TopologyChart (NEW): D3 force graph SP ↔ PG connections
//   - Stale banner chỉ show khi thực sự không có data
//   - Logic fetch: KHÔNG thay đổi từ v26

import { useEffect, useState, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import {
  SectionHeader, RangeSelector, RefreshButton,
  ErrorBanner, EmptyState, LiveIndicator,
} from "@/components/ui";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TsPoint {
  tsMs: number; activeBlobs: number; totalStorageGB: number;
  totalBlobEvents: number; pendingOrFailed: number; deletedBlobs: number;
  blockHeight: number; storageProviders?: number; placementGroups?: number;
  avgBlobSizeKB?: number;
}
interface ServerBench {
  id: string; ip?: string; deviceId?: string; ts: string; tsMs?: number;
  score: number; tier: string; avgUploadKbs: number; avgDownloadKbs: number;
  latencyAvg: number; txConfirmMs: number; mode: string; maxBytes?: number;
}
interface EpochInfo {
  currentAuditEpoch: number; currentPaymentEpoch: number; currentStakingEpoch: number;
  auditEpochStartTimes:   Array<{ key: string; value: string }>;
  paymentEpochStartTimes: Array<{ key: string; value: string }>;
  stakingEpochStartTimes: Array<{ key: string; value: string }>;
}
interface SpNode {
  address: string; addressShort: string; availabilityZone: string; health: string;
  designatedPgs?: Array<{ pg_address: string; slot_index: number }>;
}
type TimeRange = "1h" | "24h" | "7d" | "30d";

const POLL = 30_000;
const PG   = 15;

// ── Formatters ────────────────────────────────────────────────────────────────
function num(v: unknown, fb = 0): number { const n = Number(v); return isFinite(n) ? n : fb; }
function fmtN(v: unknown): string  { const n = num(v); return n === 0 ? "0" : Math.round(n).toLocaleString("en-US"); }
function fmtGB(v: unknown): string { const n = num(v); return n === 0 ? "—" : `${n.toFixed(2)} GB`; }
function fmtKbs(v: unknown): string { const n = num(v); if (!n) return "—"; return n >= 1024 ? `${(n/1024).toFixed(2)} MB/s` : `${n.toFixed(1)} KB/s`; }
function fmtMs(v: unknown): string  { const n = num(v); if (!n) return "—"; return n >= 1000 ? `${(n/1000).toFixed(2)}s` : `${n.toFixed(0)}ms`; }
function fmtKB(v: unknown): string  { const n = num(v); if (!n) return "—"; return n >= 1024 ? `${(n/1024).toFixed(1)} MB` : `${n.toFixed(0)} KB`; }
function tLbl(ts: number, r: TimeRange): string {
  const d = new Date(ts);
  return (r==="1h"||r==="24h")
    ? `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`
    : `${d.getUTCMonth()+1}/${d.getUTCDate()}`;
}
// Epoch timestamp: microseconds → human readable date
function fmtEpochTs(microStr: string): string {
  if (!microStr) return "—";
  const ms = Math.floor(Number(microStr) / 1000);
  if (!isFinite(ms) || ms === 0) return "—";
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── LiveClock ─────────────────────────────────────────────────────────────────
function LiveClock() {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const get = () => {
      const d = new Date();
      return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")} UTC`;
    };
    setClock(get());
    const id = setInterval(() => setClock(get()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!clock) return null;
  return (
    <span suppressHydrationWarning className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-mono text-[var(--text-dim)]">
      🕐 {clock}
    </span>
  );
}

// ── Device badge ──────────────────────────────────────────────────────────────
type DKind = "device" | "legacy" | "unknown";
function getDisplayId(h: Pick<ServerBench,"ip"|"deviceId">): { id: string; kind: DKind } {
  const dId = (h.deviceId ?? "").trim(), ip = (h.ip ?? "").trim();
  if (dId.startsWith("dev_")) return { id: dId, kind: "device" };
  if (dId.startsWith("usr_")) return { id: dId, kind: "legacy" };
  if (ip.startsWith("dev_"))  return { id: ip,  kind: "device" };
  if (ip.startsWith("usr_"))  return { id: ip,  kind: "legacy" };
  if (dId) return { id: dId, kind: "unknown" };
  if (ip)  return { id: ip,  kind: "unknown" };
  return { id: "—", kind: "unknown" };
}
function DeviceBadge({ h }: { h: Pick<ServerBench,"ip"|"deviceId"> }) {
  const { id, kind } = getDisplayId(h);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className={cn(
        kind === "legacy" ? "italic text-[var(--text-dim)]" : "text-[var(--text-muted)]"
      )}>{id}</span>
      {kind === "device" && (
        <span className="rounded bg-[var(--accent-bg)] px-1 py-px text-[9px] font-bold uppercase tracking-wider text-[var(--accent)]">device</span>
      )}
    </span>
  );
}

// ── Snap card ─────────────────────────────────────────────────────────────────
function SnapCard({ label, value, delta, from, color }: {
  label: string; value: string; delta: number | null; from: number | null; color?: string;
}) {
  const pos  = delta !== null && delta > 0;
  const neg  = delta !== null && delta < 0;
  const pct  = (delta !== null && from !== null && Math.abs(from) > 0) ? delta / Math.abs(from) * 100 : null;
  const safeP = pct !== null && isFinite(pct) ? pct : null;
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-[var(--bg-card)] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
      <div className="text-xl font-extrabold tabular-nums leading-none" style={{ color: color ?? "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
        {value}
      </div>
      {delta !== null && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold",
            pos ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
            neg ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                  "bg-slate-500/10 text-slate-400",
          )}>
            {delta > 0 ? "+" : ""}{Math.round(delta).toLocaleString("en-US")}
          </span>
          {safeP !== null && (
            <span className={cn("text-[10px] font-semibold",
              pos ? "text-emerald-500" : neg ? "text-red-500" : "text-[var(--text-dim)]"
            )}>
              ({safeP >= 0 ? "+" : ""}{safeP.toFixed(1)}%)
            </span>
          )}
          <span className="text-[10px] text-[var(--text-dim)]">vs prev 24h</span>
        </div>
      )}
    </div>
  );
}

// ── Chart component ───────────────────────────────────────────────────────────
function enrichPoint(s: Record<string, unknown>): TsPoint {
  const ab = num(s.activeBlobs), sg = num(s.totalStorageGB);
  return {
    tsMs: num(s.tsMs), activeBlobs: ab, totalStorageGB: sg,
    totalBlobEvents: num(s.totalBlobEvents), pendingOrFailed: num(s.pendingOrFailed),
    deletedBlobs: num(s.deletedBlobs), blockHeight: num(s.blockHeight),
    storageProviders: num(s.storageProviders), placementGroups: num(s.placementGroups),
    avgBlobSizeKB: (ab > 0 && sg > 0) ? (sg * 1e9) / ab / 1024 : 0,
  };
}

interface ChartSeries { data: number[]; color: string; name: string; fmt?: (v: number) => string; }

function Chart({ series, labels, height = 150, perScale = false }: {
  series: ChartSeries[]; labels: string[]; height?: number; perScale?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinIdx,   setPinIdx]   = useState<number | null>(null);
  const [inChart,  setInChart]  = useState(false);

  const VW=600,PL=56,PR=12,PT=16,PB=24,iW=VW-PL-PR,iH=height-PT-PB;
  const n=Math.max(...series.map(s=>s.data.length),2);

  const toIdx = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svgEl = svgRef.current; if (!svgEl) return 0;
    try {
      const pt = svgEl.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svgEl.getScreenCTM(); if (!ctm) throw new Error("no CTM");
      const sp = pt.matrixTransform(ctm.inverse());
      return Math.round(Math.max(0, Math.min(1, (sp.x - PL) / iW)) * (n - 1));
    } catch {
      const rect = svgEl.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, ((e.clientX - rect.left) / rect.width * VW - PL) / iW)) * (n - 1));
    }
  }, [n, iW]);

  const allV = series.flatMap(s => s.data.filter(v => isFinite(v) && v > 0));
  if (allV.length < 2) return (
    <div className="flex items-center justify-center text-xs text-[var(--text-dim)]" style={{ height }}>
      Collecting data…
    </div>
  );

  const doms = series.map(s => { const vs = s.data.filter(v => isFinite(v) && v > 0); if (!vs.length) return { mn: 0, mx: 1 }; const mn = Math.min(...vs), mx = Math.max(...vs), p = (mx - mn) * 0.08 || mn * 0.05 || 1; return { mn: Math.max(0, mn - p), mx: mx + p }; });
  const gMn = perScale ? 0 : Math.min(...allV) * 0.97;
  const gMx = perScale ? 0 : Math.max(...allV) * 1.03;
  const xp = (i: number) => PL + (i / Math.max(n - 1, 1)) * iW;
  const yp = (v: number, si = 0) => { if (!isFinite(v)) return PT + iH / 2; if (perScale) { const { mn, mx } = doms[si]; return PT + iH - ((v - mn) / (mx - mn || 1)) * iH; } return PT + iH - ((v - gMn) / (gMx - gMn || 1)) * iH; };
  const fY = (v: number) => !isFinite(v) || !v ? "" : v >= 1e9 ? `${(v/1e9).toFixed(1)}G` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(Math.round(v));
  const active = pinIdx ?? hoverIdx;
  const gc = "var(--border)"; const tc = "var(--text-dim)";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, v: perScale ? doms[0].mn + f * (doms[0].mx - doms[0].mn) : gMn + f * (gMx - gMn) }));
  const tipRight = active !== null ? active < n * 0.5 : true;

  return (
    <div className="relative" onMouseEnter={() => setInChart(true)} onMouseLeave={() => { setInChart(false); setHoverIdx(null); }}>
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${height}`} style={{ width: "100%", height, display: "block", cursor: "crosshair" }}
        onMouseMove={e => { if (inChart) setHoverIdx(toIdx(e)); }}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={e => { const i = toIdx(e); setPinIdx(p => p === i ? null : i); }}
      >
        {ticks.map(({ f, v }) => { const y = PT + iH - f * iH; return <g key={f}><line x1={PL} x2={VW-PR} y1={y} y2={y} stroke={gc} strokeWidth={1}/><text x={PL-5} y={y+3} textAnchor="end" fontSize={9} fill={tc}>{fY(v)}</text></g>; })}
        <defs>{series.map((s, si) => <linearGradient key={si} id={`cg${si}${s.color.replace(/[^a-z0-9]/gi,"")}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.22}/><stop offset="100%" stopColor={s.color} stopOpacity={0.02}/></linearGradient>)}</defs>
        {series.map((s, si) => { if (s.data.length < 2) return null; const pts = s.data.map((v,i) => `${xp(i).toFixed(2)},${yp(v,si).toFixed(2)}`).join(" "); const area = `${xp(0).toFixed(2)},${PT+iH} ${pts} ${xp(s.data.length-1).toFixed(2)},${PT+iH}`; return <g key={si}><polygon points={area} fill={`url(#cg${si}${s.color.replace(/[^a-z0-9]/gi,"")})`}/><polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"/>{s.data.length>0&&<circle cx={xp(s.data.length-1)} cy={yp(s.data[s.data.length-1],si)} r={4} fill={s.color} stroke="var(--bg-card)" strokeWidth={2}/>}</g>; })}
        {active !== null && inChart && (() => { const cx = xp(active); return <g><line x1={cx} y1={PT} x2={cx} y2={PT+iH} stroke="var(--text-dim)" strokeWidth={1} strokeOpacity={0.5} strokeDasharray="4 3"/>{series.map((s,si) => { const v = s.data[active]; if (!v || !isFinite(v)) return null; return <g key={si}><circle cx={cx} cy={yp(v,si)} r={7} fill={s.color} opacity={0.15}/><circle cx={cx} cy={yp(v,si)} r={4.5} fill={s.color} stroke="var(--bg-card)" strokeWidth={2}/></g>; })}</g>; })()}
        {labels.length > 0 && [0, Math.floor(labels.length/2), labels.length-1].map(i => i < labels.length && labels[i] ? <text key={i} x={xp(i)} y={height-4} textAnchor="middle" fontSize={9} fill={tc}>{labels[i]}</text> : null)}
      </svg>
      {active !== null && inChart && (
        <div className={cn(
          "absolute top-2 z-50 pointer-events-none rounded-xl border bg-[var(--bg-card)] p-3 text-xs shadow-lg min-w-[150px] whitespace-nowrap",
          tipRight ? "left-[calc(var(--x)+8px)]" : "right-[calc(var(--x)+8px)]",
        )} style={{ [tipRight ? "left" : "right"]: `calc(${xp(active)/VW*100}% + 8px)`, top: 8 }}>
          {pinIdx !== null && <div className="mb-1 text-[9px] font-semibold text-[var(--accent)] uppercase">📌 Pinned — click to unpin</div>}
          {labels[active] && <div className="mb-2 text-[10px] text-[var(--text-dim)] font-semibold">{labels[active]}</div>}
          {series.map((s, si) => { const v = s.data[active]; if (!v || !isFinite(v)) return null; return (
            <div key={si} className="flex justify-between gap-4 items-center mb-0.5">
              <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="font-bold font-mono" style={{ color: s.color }}>{s.fmt ? s.fmt(v) : fmtN(v)}</span>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Sec({ title, sub, children, right }: {
  title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-[19px] font-extrabold text-[var(--text-primary)]">{title}</h2>
          {sub && <p className="text-sm text-[var(--text-muted)] mt-0.5">{sub}</p>}
        </div>
        {right && <div>{right}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Chart card wrapper ────────────────────────────────────────────────────────
function ChartCard({ title, sub, latest, color, children }: {
  title: string; sub?: string; latest?: string; color?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-[var(--bg-card)] p-4 md:p-5">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-[var(--text-secondary)]">{title}</div>
          {sub && <div className="text-xs text-[var(--text-dim)] mt-0.5">{sub}</div>}
        </div>
        {latest && (
          <div className="font-mono text-base font-extrabold" style={{ color: color ?? "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            {latest}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Pager ─────────────────────────────────────────────────────────────────────
function Pager({ total, page, per, set }: { total: number; page: number; per: number; set: (p: number) => void }) {
  const pages = Math.ceil(total / per);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 mt-3">
      {[
        { label: "←", fn: () => set(page - 1), disabled: page === 0 },
        ...Array.from({ length: Math.min(pages, 8) }, (_, i) => ({
          label: String(i + 1), fn: () => set(i), disabled: false, active: i === page,
        })),
        { label: "→", fn: () => set(page + 1), disabled: page === pages - 1 },
      ].map((btn, i) => (
        <button key={i} onClick={btn.fn} disabled={btn.disabled}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            (btn as any).active
              ? "border-transparent bg-[var(--net-color)] text-white"
              : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
          )}
        >{btn.label}</button>
      ))}
      {pages > 8 && <span className="text-xs text-[var(--text-dim)]">…{pages}</span>}
    </div>
  );
}

// ── Epoch Panel (Phase 2 NEW) ─────────────────────────────────────────────────
function EpochPanel({ epochInfo }: { epochInfo: EpochInfo }) {
  const EPOCH_DURATION_HOURS: Record<string, number> = {
    audit:   1,    // 3600s
    payment: 24,   // 86400s
    staking: 168,  // 604800s = 7 days
  };

  const panels = [
    {
      label:   "Audit Epoch",
      current: epochInfo.currentAuditEpoch,
      times:   epochInfo.auditEpochStartTimes,
      color:   "#2563eb",
      period:  `${EPOCH_DURATION_HOURS.audit}h`,
    },
    {
      label:   "Payment Epoch",
      current: epochInfo.currentPaymentEpoch,
      times:   epochInfo.paymentEpochStartTimes,
      color:   "#22c55e",
      period:  `${EPOCH_DURATION_HOURS.payment}h`,
    },
    {
      label:   "Staking Epoch",
      current: epochInfo.currentStakingEpoch,
      times:   epochInfo.stakingEpochStartTimes,
      color:   "#9333ea",
      period:  `${EPOCH_DURATION_HOURS.staking}h (7d)`,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {panels.map(p => {
        const latest = p.times[p.times.length - 1];
        return (
          <div key={p.label} className="rounded-xl border bg-[var(--bg-card)] p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{p.label}</span>
              <span className="rounded px-2 py-0.5 text-[10px] font-semibold border" style={{ color: p.color, borderColor: p.color + "33", background: p.color + "11" }}>
                {p.period}
              </span>
            </div>

            {/* Current epoch number */}
            <div>
              <div className="text-[28px] font-extrabold tabular-nums leading-none" style={{ color: p.color, fontFamily: "var(--font-mono)" }}>
                #{p.current}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                Current epoch
              </div>
            </div>

            {/* Latest start time */}
            {latest && (
              <div className="rounded-lg bg-[var(--bg-card2)] border border-[var(--border)] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
                  Epoch {latest.key} started
                </div>
                <div className="text-xs font-mono text-[var(--text-primary)]">
                  {fmtEpochTs(latest.value)}
                </div>
              </div>
            )}

            {/* Timeline dots — last 5 epochs */}
            {p.times.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">History</div>
                {p.times.slice(-5).reverse().map((entry, i) => (
                  <div key={entry.key} className="flex items-center gap-2">
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ background: i === 0 ? p.color : p.color + "55" }}
                    />
                    <span className="text-[10px] font-mono text-[var(--text-dim)]">
                      #{entry.key} — {fmtEpochTs(entry.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Topology Chart (Phase 2 NEW) ──────────────────────────────────────────────
// D3 force-directed graph: SP nodes ↔ PG nodes
// Dynamic import tránh SSR issues với D3

import dynamic from "next/dynamic";

const TopologyChartInner = dynamic(
  () => import("@/components/topology-chart"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center text-sm text-[var(--text-muted)] rounded-xl border border-dashed border-[var(--border)]">
        <div className="flex flex-col items-center gap-3">
          <div className="size-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
          Loading topology…
        </div>
      </div>
    ),
  }
);

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();
  const isTestnet   = network === "testnet";
  const accentColor = isTestnet ? "#9333ea" : "var(--accent)";
  const alive       = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const [range,        setRange]        = useState<TimeRange>("24h");
  const [ts,           setTs]           = useState<TsPoint[]>([]);
  const [ts48h,        setTs48h]        = useState<TsPoint[]>([]);
  const [liveSnap,     setLiveSnap]     = useState<TsPoint | null>(null);
  const [localSeries,  setLocalSeries]  = useState<TsPoint[]>([]);
  const [epochInfo,    setEpochInfo]    = useState<EpochInfo | null>(null);
  const [spList,       setSpList]       = useState<SpNode[]>([]);
  const [bench,        setBench]        = useState<ServerBench[]>([]);
  const [pg,           setPg]           = useState(0);
  const [benchLoading, setBenchLoading] = useState(true);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (alive.current) {
      setLiveSnap(null); setTs([]); setTs48h([]); setLocalSeries([]);
      setEpochInfo(null); setSpList([]); setFetchError(null);
    }
  }, [network]);

  const fetchLive = useCallback(async (net: string) => {
    try {
      const r = await fetch(`/api/network/stats/live?network=${net}`);
      if (r.status === 404 || r.status === 503) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as Record<string, unknown>;
      const d = (j?.data ?? j ?? {}) as Record<string, unknown>;
      if (!d.blockHeight && !d.activeBlobs && !d.storageProviders) throw new Error("Empty");
      if (alive.current) {
        setFetchError(null);
        const pt: TsPoint = {
          tsMs: Date.now(), blockHeight: num(d.blockHeight),
          activeBlobs: num(d.activeBlobs), totalStorageGB: num(d.totalStorageBytes) / 1e9,
          totalBlobEvents: num(d.totalBlobEvents), pendingOrFailed: num(d.pendingOrFailed),
          deletedBlobs: num(d.deletedBlobs), storageProviders: num(d.storageProviders),
          placementGroups: num(d.placementGroups),
        };
        setLiveSnap(pt);
        // Phase 2: capture epochInfo from live snap
        if (d.epochInfo && net === "testnet") {
          setEpochInfo(d.epochInfo as EpochInfo);
        }
        if (net === "testnet") {
          setLocalSeries(prev => { const next = [...prev, pt]; return next.length > 120 ? next.slice(-120) : next; });
        }
      }
    } catch (e) {
      if (alive.current && !ts.length && !localSeries.length)
        setFetchError("Live fetch failed — using cached data");
    }
  }, [ts.length, localSeries.length]);

  const fetchTs = useCallback(async (net: string, r: TimeRange) => {
    try {
      const res_ = (r==="1h"||r==="24h") ? "5m" : "1h";
      const j    = await fetch(`/api/network/stats/timeseries?network=${net}&resolution=${res_}&range=${r}`).then(x => x.json()) as Record<string,unknown>;
      const arr  = ((j?.data as Record<string,unknown>)?.series ?? []) as Record<string,unknown>[];
      if (alive.current) setTs(arr.map(enrichPoint));
    } catch {}
  }, []);

  const fetchTs48h = useCallback(async (net: string) => {
    try {
      const j   = await fetch(`/api/network/stats/timeseries?network=${net}&resolution=1h&range=7d`).then(x => x.json()) as Record<string,unknown>;
      const arr = ((j?.data as Record<string,unknown>)?.series ?? []) as Record<string,unknown>[];
      if (alive.current) setTs48h(arr.map(enrichPoint).slice(-48));
    } catch {}
  }, []);

  // Phase 2: fetch providers for topology
  const fetchProviders = useCallback(async (net: string) => {
    try {
      const j   = await fetch(`/api/network/providers?network=${net}`).then(x => x.json()) as Record<string,unknown>;
      const raw = (j as any)?.data?.providers;
      if (Array.isArray(raw) && alive.current) {
        setSpList(raw.map((sp: any) => ({
          address:          String(sp.address ?? ""),
          addressShort:     String(sp.addressShort ?? ""),
          availabilityZone: String(sp.availabilityZone ?? ""),
          health:           String(sp.health ?? "Unknown"),
          designatedPgs:    Array.isArray(sp.designatedPgs) ? sp.designatedPgs : [],
        })));
      }
    } catch {}
  }, []);

  const fetchBench = useCallback(async () => {
    if (alive.current) setBenchLoading(true);
    try {
      const j = await fetch("/api/benchmark/results?limit=500").then(x => x.json()) as Record<string,unknown>;
      if (alive.current) setBench(Array.isArray(j?.results) ? j.results as ServerBench[] : []);
    } catch { if (alive.current) setBench([]); }
    finally { if (alive.current) setBenchLoading(false); }
  }, []);

  useEffect(() => {
    fetchLive(network); fetchTs(network, range); fetchTs48h(network);
    fetchBench(); fetchProviders(network);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (!alive.current) return;
      fetchLive(network); fetchTs48h(network); fetchBench();
    }, POLL);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  useEffect(() => { fetchTs(network, range); }, [range, network, fetchTs]);

  const cd     = ts.length > 0 ? ts : localSeries;
  const labels = cd.map(p => tLbl(p.tsMs, range));
  const latestTs = cd[cd.length - 1];

  const cur = {
    blockHeight:      liveSnap?.blockHeight      || latestTs?.blockHeight      || 0,
    activeBlobs:      liveSnap?.activeBlobs      || latestTs?.activeBlobs      || 0,
    totalStorageGB:   liveSnap?.totalStorageGB   || latestTs?.totalStorageGB   || 0,
    totalBlobEvents:  liveSnap?.totalBlobEvents  || latestTs?.totalBlobEvents  || 0,
    pendingOrFailed:  liveSnap?.pendingOrFailed  || latestTs?.pendingOrFailed  || 0,
    deletedBlobs:     liveSnap?.deletedBlobs     || latestTs?.deletedBlobs     || 0,
    storageProviders: liveSnap?.storageProviders || latestTs?.storageProviders || 0,
    placementGroups:  liveSnap?.placementGroups  || latestTs?.placementGroups  || 0,
    avgBlobSizeKB:    latestTs?.avgBlobSizeKB    || 0,
  };

  const mid48 = Math.floor(ts48h.length / 2);
  const prev48 = ts48h[mid48 - 1], curr48 = ts48h[ts48h.length - 1];
  function d48(key: keyof TsPoint) {
    if (!prev48 || !curr48) return { delta: null, from: null };
    const c = num(curr48[key]), p = num(prev48[key]);
    if (!c && !p) return { delta: null, from: null };
    return { delta: c - p, from: p };
  }

  const showStale = fetchError !== null && cur.activeBlobs === 0 && cur.blockHeight === 0;

  const allBench   = bench;
  const pagedBench = allBench.slice(pg * PG, (pg + 1) * PG);
  const benchChron = [...allBench].reverse();
  const bLabels    = benchChron.map(h => h.ts ? new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
  const avgScore   = allBench.length ? allBench.reduce((s, h) => s + num(h.score), 0) / allBench.length : 0;
  const avgUpload  = allBench.length ? allBench.reduce((s, h) => s + num(h.avgUploadKbs), 0) / allBench.length : 0;
  const avgLatency = allBench.length ? allBench.reduce((s, h) => s + num(h.latencyAvg), 0) / allBench.length : 0;
  const avgTxConf  = allBench.length ? allBench.reduce((s, h) => s + num(h.txConfirmMs), 0) / allBench.length : 0;

  return (
    <div className="bg-[var(--bg-primary)] min-h-screen px-5 md:px-9 py-7 pb-12">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <SectionHeader
        title="Network Analytics"
        subtitle={`${isTestnet ? "Shelby Testnet · Aptos Testnet RPC" : config?.label ?? "Shelbynet"} · Refresh every ${POLL/1000}s`}
        action={
          <div className="flex items-center gap-2.5">
            <LiveClock />
            <RefreshButton onClick={() => { fetchLive(network); fetchTs48h(network); fetchBench(); }} />
          </div>
        }
      />

      {isTestnet && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-purple-500/25 bg-purple-500/8 px-4 py-2.5 text-sm text-purple-400">
          <span>⚗</span><span>Early Testnet · Data from Aptos Testnet RPC</span>
          <span className="ml-auto text-[11px] opacity-70">Auto-refresh every {POLL/1000}s</span>
        </div>
      )}

      {showStale && (
        <ErrorBanner message={fetchError!} variant="warning" className="mb-5" />
      )}

      {/* ── Network Snapshot ───────────────────────────────────────────────── */}
      <Sec title="Network Snapshot" sub="Current values · % change vs previous 24h window">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SnapCard label="Block Height" value={cur.blockHeight ? `#${cur.blockHeight.toLocaleString("en-US")}` : "—"} color={accentColor} delta={null} from={null} />
          {(()=>{ const { delta, from } = d48("activeBlobs");    return <SnapCard label="Active Blobs"   value={fmtN(cur.activeBlobs)}     color="#22c55e" delta={delta} from={from} />; })()}
          {(()=>{ const { delta, from } = d48("totalStorageGB"); return <SnapCard label="Storage Used"   value={fmtGB(cur.totalStorageGB)}  color="#a78bfa" delta={delta} from={from} />; })()}
          {(()=>{ const { delta, from } = d48("totalBlobEvents");return <SnapCard label="Blob Events"    value={fmtN(cur.totalBlobEvents)}  color="#fb923c" delta={delta} from={from} />; })()}
          {(()=>{ const { delta, from } = d48("pendingOrFailed");return <SnapCard label="Pending Blobs"  value={fmtN(cur.pendingOrFailed)}  color="#fbbf24" delta={delta} from={from} />; })()}
          {(()=>{ const { delta, from } = d48("deletedBlobs");   return <SnapCard label="Deleted Blobs"  value={fmtN(cur.deletedBlobs)}     color="#f87171" delta={delta} from={from} />; })()}
        </div>
      </Sec>

      {/* ── Blob Analytics ─────────────────────────────────────────────────── */}
      <Sec
        title="Blob Analytics"
        sub="Blob count and activity over time"
        right={<RangeSelector value={range} onChange={r => { setRange(r); setPg(0); fetchTs(network, r); }} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <ChartCard title="Active Blobs"  sub={`${range} window`} latest={fmtN(cur.activeBlobs)} color="#22c55e">
            <Chart series={[{ data: cd.map(p => num(p.activeBlobs)), color: "#22c55e", name: "Active", fmt: fmtN }]} labels={labels} height={140}/>
          </ChartCard>
          <ChartCard title="Blob Events" sub="blob_activities_aggregate count" latest={fmtN(cur.totalBlobEvents)} color="#fb923c">
            <Chart series={[{ data: cd.map(p => num(p.totalBlobEvents)), color: "#fb923c", name: "Events", fmt: fmtN }]} labels={labels} height={140}/>
          </ChartCard>
        </div>
        <ChartCard title="Pending & Deleted Blobs" sub="Anomaly tracking · auto-scaled per series">
          <Chart perScale series={[
            { data: cd.map(p => num(p.pendingOrFailed)), color: "#fbbf24", name: "Pending", fmt: fmtN },
            { data: cd.map(p => num(p.deletedBlobs)),   color: "#f87171", name: "Deleted", fmt: fmtN },
          ]} labels={labels} height={120}/>
        </ChartCard>
      </Sec>

      {/* ── Storage ────────────────────────────────────────────────────────── */}
      <Sec title="Storage Analytics" sub="Capacity, utilization, and blob size">
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3 mb-3">
          <ChartCard title="Storage Used (GB)" latest={fmtGB(cur.totalStorageGB)} color="#a78bfa">
            <Chart series={[{ data: cd.map(p => num(p.totalStorageGB)), color: "#a78bfa", name: "GB", fmt: v => `${v.toFixed(2)} GB` }]} labels={labels} height={150}/>
          </ChartCard>
          <div className="flex flex-col gap-3">
            {[
              { label: "Total Storage",  val: fmtGB(cur.totalStorageGB),  color: "#a78bfa" },
              { label: "Active Blobs",   val: fmtN(cur.activeBlobs),      color: "#22c55e" },
              { label: "Avg Blob Size",  val: fmtKB(cur.avgBlobSizeKB),   color: accentColor, hint: "totalStorage / activeBlobs" },
            ].map(({ label, val, color, hint }) => (
              <div key={label} className="flex-1 rounded-xl border bg-[var(--bg-card)] p-4">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
                <div className="text-lg font-extrabold tabular-nums" style={{ color, fontFamily: "var(--font-mono)" }}>{val}</div>
                {hint && <div className="mt-0.5 text-[9px] text-[var(--text-dim)]">{hint}</div>}
              </div>
            ))}
          </div>
        </div>
        <ChartCard title="Avg Blob Size over Time" sub="totalStorageBytes / activeBlobs" latest={fmtKB(cur.avgBlobSizeKB)} color={accentColor}>
          <Chart series={[{ data: cd.map(p => num(p.avgBlobSizeKB ?? 0)), color: accentColor, name: "Avg Size", fmt: fmtKB }]} labels={labels} height={130}/>
        </ChartCard>
      </Sec>

      {/* ── Block Performance ──────────────────────────────────────────────── */}
      <Sec title="Block Performance" sub="Block height progression">
        <ChartCard title="Block Height" latest={cur.blockHeight ? `#${cur.blockHeight.toLocaleString("en-US")}` : "—"} color={accentColor}>
          <Chart series={[{ data: cd.map(p => num(p.blockHeight)).filter(v => v > 0), color: accentColor, name: "Block", fmt: v => `#${Math.round(v).toLocaleString("en-US")}` }]} labels={labels} height={130}/>
        </ChartCard>
      </Sec>

      {/* ── Epoch History (Testnet only, Phase 2 NEW) ──────────────────────── */}
      {isTestnet && (
        <Sec title="Epoch History" sub="Current audit, payment, and staking epoch status">
          {epochInfo ? (
            <EpochPanel epochInfo={epochInfo} />
          ) : (
            <EmptyState
              icon="⏱"
              title="Epoch data not yet loaded"
              description="Data loads with next sync cycle (every 10 minutes)"
            />
          )}
        </Sec>
      )}

      {/* ── Topology (Phase 2 NEW) ─────────────────────────────────────────── */}
      <Sec
        title="SP ↔ PG Topology"
        sub={`${spList.length} storage providers · force-directed graph · click to pin`}
      >
        {spList.length > 0 ? (
          <TopologyChartInner spList={spList} />
        ) : (
          <EmptyState
            icon="🕸"
            title="No topology data"
            description="Provider list loads on page open"
          />
        )}
      </Sec>

      {/* ── Benchmark Analytics ────────────────────────────────────────────── */}
      <Sec title="Benchmark Analytics" sub={isTestnet ? "Benchmarks run on Shelbynet only" : `${allBench.length} total runs · all time`}>
        {isTestnet ? (
          <EmptyState
            icon="🔬"
            title="Benchmarks run on Shelbynet only"
            description="Switch to Shelbynet to view global run history"
          />
        ) : benchLoading ? (
          <div className="flex h-24 items-center justify-center">
            <div className="size-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
          </div>
        ) : allBench.length === 0 ? (
          <EmptyState icon="📊" title="No benchmark runs yet" description="Run a benchmark on the home page first" />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { label: "Avg Score",      value: String(Math.round(avgScore)), color: "#818cf8" },
                { label: "Avg Upload",     value: fmtKbs(avgUpload),            color: accentColor },
                { label: "Avg Latency",    value: fmtMs(avgLatency),            color: "#c084fc" },
                { label: "Avg TX Confirm", value: fmtMs(avgTxConf),             color: "#fb923c" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border bg-[var(--bg-card)] p-4 text-center">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
                  <div className="text-xl font-extrabold tabular-nums" style={{ color, fontFamily: "var(--font-mono)" }}>{value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              <ChartCard title="Score History" sub="All users · all time" latest={String(allBench[0]?.score ?? "")} color="#818cf8">
                <Chart series={[{ data: benchChron.map(h => num(h.score)), color: "#818cf8", name: "Score", fmt: v => `${Math.round(v)}/1000` }]} labels={bLabels} height={130}/>
              </ChartCard>
              <ChartCard title="Avg Upload Speed" latest={fmtKbs(avgUpload)} color={accentColor}>
                <Chart series={[{ data: benchChron.map(h => num(h.avgUploadKbs)), color: accentColor, name: "Upload", fmt: fmtKbs }]} labels={bLabels} height={130}/>
              </ChartCard>
              <ChartCard title="Avg Latency" sub="Node ping" latest={fmtMs(avgLatency)} color="#c084fc">
                <Chart series={[{ data: benchChron.map(h => num(h.latencyAvg)), color: "#c084fc", name: "Latency", fmt: fmtMs }]} labels={bLabels} height={130}/>
              </ChartCard>
              <ChartCard title="TX Confirm Time" sub="Aptos transaction confirmation" latest={fmtMs(avgTxConf)} color="#fb923c">
                <Chart series={[{ data: benchChron.map(h => num(h.txConfirmMs)), color: "#fb923c", name: "TX Confirm", fmt: fmtMs }]} labels={bLabels} height={130}/>
              </ChartCard>
            </div>

            {/* Global run table */}
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] flex-wrap gap-2">
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)]">Global Run History</div>
                  <div className="text-xs text-[var(--text-muted)]">{allBench.length} runs · Page {pg+1}/{Math.max(1, Math.ceil(allBench.length/PG))}</div>
                </div>
                <button onClick={fetchBench} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
                  ⟳ Refresh
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--bg-card2)]">
                      {["Device","Time","Score","Tier","Upload","Download","Latency","TX Confirm","Mode"].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border)] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBench.map((h, i) => {
                      const sc = num(h.score);
                      const c  = sc >= 900 ? "#22c55e" : sc >= 600 ? "#fbbf24" : "#f87171";
                      const ts_ = h.ts ? new Date(h.ts).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
                      return (
                        <tr key={h.id || String(i)} className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-card2)] transition-colors">
                          <td className="px-3 py-2"><DeviceBadge h={h} /></td>
                          <td className="px-3 py-2 font-mono text-[var(--text-dim)] whitespace-nowrap">{ts_}</td>
                          <td className="px-3 py-2"><span className="font-bold text-sm" style={{ color: c, fontFamily: "var(--font-mono)" }}>{sc || "—"}</span></td>
                          <td className="px-3 py-2"><span className="font-semibold" style={{ color: c }}>{h.tier}</span></td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap" style={{ color: accentColor }}>{fmtKbs(h.avgUploadKbs)}</td>
                          <td className="px-3 py-2 font-mono text-emerald-500 whitespace-nowrap">{fmtKbs(h.avgDownloadKbs)}</td>
                          <td className="px-3 py-2 font-mono text-purple-400 whitespace-nowrap">{fmtMs(h.latencyAvg)}</td>
                          <td className="px-3 py-2 font-mono text-orange-400 whitespace-nowrap">{fmtMs(h.txConfirmMs)}</td>
                          <td className="px-3 py-2"><span className="text-[10px] font-bold uppercase text-indigo-400">{h.mode}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-[var(--border-soft)]">
                <Pager total={allBench.length} page={pg} per={PG} set={setPg} />
              </div>
            </div>
          </>
        )}
      </Sec>
    </div>
  );
}