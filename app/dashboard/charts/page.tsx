"use client";
/**
 * app/dashboard/charts/page.tsx — v22.0
 *
 * FIXES:
 * 1. Rules of Hooks violation: useCallback(toIdx) was called AFTER early return
 *    → moved ALL hooks to top of Chart(), early return converted to hasData flag
 * 2. Hydration mismatch: useLiveUTCClock rendered time on server ≠ client
 *    → clock initialized as "" (empty string), filled only after mount
 * 3. VPS confirmed working — revert route changes, keep direct VPS proxy
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TsPoint {
  tsMs: number; activeBlobs: number; totalStorageGB: number;
  totalBlobEvents: number; pendingOrFailed: number; deletedBlobs: number;
  blockHeight: number; avgBlobSizeKB?: number;
}
interface LivePt {
  ts: number; blockHeight: number; activeBlobs: number;
  totalStorageGB: number; totalBlobEvents: number;
  pendingOrFailed: number; deletedBlobs: number;
}
interface ServerBench {
  id: string; ip?: string; deviceId?: string; ts: string; tsMs?: number;
  score: number; tier: string; avgUploadKbs: number; avgDownloadKbs: number;
  latencyAvg: number; txConfirmMs: number; mode: string; maxBytes?: number;
}
interface TestnetStats {
  blockHeight: number; ledgerVersion: number; chainId: number;
  activeBlobs: number; slices: number; placementGroups: number;
  storageProviders: number; waitlistedProviders: number;
  indexerStatus: string;
}
type TimeRange = "1h" | "24h" | "7d" | "30d";

const POLL = 30_000;
const PG   = 15;
const TESTNET_CONTRACT = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function str(v: unknown): string {
  if (v == null)              return "—";
  if (typeof v === "string")  return v.trim() || "—";
  if (typeof v === "number")  return isFinite(v) ? String(v) : "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return "—";
}
function num(v: unknown, fb = 0): number { const n = Number(v); return isFinite(n) ? n : fb; }
function fmtN(v: unknown): string { const n = num(v); return n === 0 ? "—" : Math.round(n).toLocaleString("en-US"); }
function fmtGB(v: unknown): string { const n = num(v); return n === 0 ? "—" : `${n.toFixed(2)} GB`; }
function fmtKbs(v: unknown): string { const n = num(v); if (n === 0) return "—"; return n >= 1024 ? `${(n / 1024).toFixed(2)} MB/s` : `${n.toFixed(1)} KB/s`; }
function fmtMs(v: unknown): string { const n = num(v); if (n === 0) return "—"; return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n.toFixed(0)}ms`; }
function fmtKB(v: unknown): string { const n = num(v); if (n === 0) return "—"; return n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n.toFixed(0)} KB`; }

function tLbl(tsMs: number, range: TimeRange): string {
  try {
    const d = new Date(tsMs);
    if (range === "1h" || range === "24h")
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  } catch { return ""; }
}

function computeAvgBlobKB(a: number, gb: number): number {
  if (a <= 0 || gb <= 0) return 0;
  return (gb * 1e9) / a / 1024;
}

function enrichPoint(s: Record<string, unknown>): TsPoint {
  const activeBlobs = num(s.activeBlobs), totalStorageGB = num(s.totalStorageGB);
  return {
    tsMs:            num(s.tsMs),
    activeBlobs,
    totalStorageGB,
    totalBlobEvents: num(s.totalBlobEvents),
    pendingOrFailed: num(s.pendingOrFailed),
    deletedBlobs:    num(s.deletedBlobs),
    blockHeight:     num(s.blockHeight),
    avgBlobSizeKB:   computeAvgBlobKB(activeBlobs, totalStorageGB),
  };
}

// ─── Live UTC Clock ─────────────────────────────────────────────────────────────
// FIX hydration: initialize as "" so server and client both render ""
// then fill on client after mount. No more server/client mismatch.
function useLiveUTCClock(): string {
  const [clock, setClock] = useState<string>(""); // "" on both server and client initially
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const getUTC = () => {
      const d = new Date();
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} UTC`;
    };
    setClock(getUTC()); // set immediately after mount
    const id = setInterval(() => { if (alive.current) setClock(getUTC()); }, 1000);
    return () => { alive.current = false; clearInterval(id); };
  }, []);

  return clock;
}

// ─── Device Badge ─────────────────────────────────────────────────────────────
type DeviceKind = "device" | "legacy" | "unknown";
function getDisplayId(h: Pick<ServerBench, "ip" | "deviceId">): { id: string; kind: DeviceKind } {
  const dId = (h.deviceId ?? "").trim(), ip = (h.ip ?? "").trim();
  if (dId.startsWith("dev_")) return { id: dId, kind: "device" };
  if (dId.startsWith("usr_")) return { id: dId, kind: "legacy" };
  if (ip.startsWith("dev_"))  return { id: ip,  kind: "device" };
  if (ip.startsWith("usr_"))  return { id: ip,  kind: "legacy" };
  if (dId) return { id: dId, kind: "unknown" };
  if (ip)  return { id: ip,  kind: "unknown" };
  return { id: "—", kind: "unknown" };
}
function DeviceBadge({ h }: { h: Pick<ServerBench, "ip" | "deviceId"> }) {
  const { id, kind } = getDisplayId(h);
  const cfg: Record<DeviceKind, { bg: string; color: string; label: string; italic: boolean }> = {
    device:  { bg: "rgba(6,182,212,0.12)",   color: "var(--accent)", label: "device", italic: false },
    legacy:  { bg: "rgba(100,116,139,0.14)", color: "#94a3b8",       label: "legacy", italic: true  },
    unknown: { bg: "rgba(100,116,139,0.08)", color: "#64748b",       label: "",        italic: false },
  };
  const s = cfg[kind];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "monospace", fontSize: 11 }}>
      <span style={{ color: kind === "legacy" ? "#94a3b8" : "var(--text-muted)", fontStyle: s.italic ? "italic" : "normal" }}>{str(id)}</span>
      {s.label && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: s.bg, color: s.color, letterSpacing: "0.04em", textTransform: "uppercase" }}>{s.label}</span>}
    </span>
  );
}

// ─── Chart ────────────────────────────────────────────────────────────────────
// FIX Rules of Hooks: ALL hooks are declared at the top of the function,
// BEFORE any conditional logic or early returns.
// The early return (when data < 2) is now handled via a `hasData` variable
// checked AFTER all hooks are declared.
interface ChartSeries { data: number[]; color: string; name: string; fmt?: (v: number) => string; }
function Chart({ series, labels, height = 150, perScale = false }: {
  series: ChartSeries[]; labels: string[]; height?: number; perScale?: boolean;
}) {
  const { isDark } = useTheme();
  // ── ALL HOOKS FIRST — before any conditional returns ──────────────────────
  const svgRef   = useRef<SVGSVGElement>(null);
  const alive    = useRef(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinIdx,   setPinIdx]   = useState<number | null>(null);
  const [inChart,  setInChart]  = useState(false);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Compute layout constants (safe to compute always)
  const VW = 600, PL = 56, PR = 12, PT = 16, PB = 24;
  const iW = VW - PL - PR, iH = height - PT - PB;
  const n  = Math.max(...series.map(s => s.data.length), 2);

  // useCallback MUST be declared before any conditional return
  const toIdx = useCallback((e: React.MouseEvent<SVGSVGElement>): number => {
    const svgEl = svgRef.current;
    if (!svgEl) return 0;
    try {
      const pt = svgEl.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svgEl.getScreenCTM();
      if (!ctm) throw new Error("no CTM");
      const sp = pt.matrixTransform(ctm.inverse());
      return Math.round(Math.max(0, Math.min(1, (sp.x - PL) / iW)) * (n - 1));
    } catch {
      const rect = svgEl.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, ((e.clientX - rect.left) / rect.width * VW - PL) / iW)) * (n - 1));
    }
  }, [n, iW, PL, VW]);

  // ── NOW check data availability (after all hooks) ─────────────────────────
  const allV = series.flatMap(s => s.data.filter(v => isFinite(v) && v > 0));
  const hasData = allV.length >= 2;

  if (!hasData) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        Collecting data…
      </div>
    );
  }

  // ── Compute derived values (only when hasData) ────────────────────────────
  const doms = series.map(s => {
    const vs = s.data.filter(v => isFinite(v) && v > 0);
    if (!vs.length) return { mn: 0, mx: 1 };
    const mn = Math.min(...vs), mx = Math.max(...vs), p = (mx - mn) * 0.08 || mn * 0.05 || 1;
    return { mn: Math.max(0, mn - p), mx: mx + p };
  });
  const gMn = perScale ? 0 : Math.min(...allV) * 0.97;
  const gMx = perScale ? 0 : Math.max(...allV) * 1.03;

  const xp = (i: number) => PL + (i / Math.max(n - 1, 1)) * iW;
  const yp = (v: number, si = 0) => {
    if (!isFinite(v)) return PT + iH / 2;
    if (perScale) { const { mn, mx } = doms[si]; return PT + iH - ((v - mn) / (mx - mn || 1)) * iH; }
    return PT + iH - ((v - gMn) / (gMx - gMn || 1)) * iH;
  };
  const fY = (v: number) => {
    if (!isFinite(v) || v === 0) return "";
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(Math.round(v));
  };

  const active     = pinIdx ?? hoverIdx;
  const gc         = isDark ? "#1e3a5f" : "#e5e7eb";
  const tc         = "var(--text-dim)";
  const ticks      = [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, v: perScale ? doms[0].mn + f * (doms[0].mx - doms[0].mn) : gMn + f * (gMx - gMn) }));
  const tipOnRight = active !== null ? active < n * 0.5 : true;
  const tipXpct    = active !== null ? xp(active) / VW * 100 : 50;

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => { if (alive.current) setInChart(true); }}
      onMouseLeave={() => { if (alive.current) { setInChart(false); setHoverIdx(null); } }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${height}`}
        style={{ width: "100%", height, display: "block", cursor: "crosshair" }}
        onMouseMove={e => { if (inChart && alive.current) setHoverIdx(toIdx(e)); }}
        onMouseLeave={() => { if (alive.current) setHoverIdx(null); }}
        onClick={e => { const i = toIdx(e); if (alive.current) setPinIdx(p => p === i ? null : i); }}
      >
        {ticks.map(({ f, v }) => { const y = PT + iH - f * iH; return (
          <g key={f}>
            <line x1={PL} x2={VW - PR} y1={y} y2={y} stroke={gc} strokeWidth={1} />
            <text x={PL - 5} y={y + 3} textAnchor="end" fontSize={9} fill={tc}>{fY(v)}</text>
          </g>
        ); })}
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`cg${si}${s.color.replace(/[^a-z0-9]/gi, "")}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"   stopColor={s.color} stopOpacity={isDark ? 0.3 : 0.18} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {series.map((s, si) => {
          if (s.data.length < 2) return null;
          const pts  = s.data.map((v, i) => `${xp(i).toFixed(2)},${yp(v, si).toFixed(2)}`).join(" ");
          const area = `${xp(0).toFixed(2)},${PT + iH} ${pts} ${xp(s.data.length - 1).toFixed(2)},${PT + iH}`;
          return (
            <g key={si}>
              <polygon points={area} fill={`url(#cg${si}${s.color.replace(/[^a-z0-9]/gi, "")})`} />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.data.length > 0 && <circle cx={xp(s.data.length - 1)} cy={yp(s.data[s.data.length - 1], si)} r={4} fill={s.color} stroke={isDark ? "#0f172a" : "#fff"} strokeWidth={2} />}
            </g>
          );
        })}
        {active !== null && inChart && (() => {
          const cx = xp(active);
          return (
            <g>
              <line x1={cx} y1={PT} x2={cx} y2={PT + iH} stroke={isDark ? "rgba(148,163,184,0.6)" : "rgba(100,116,139,0.5)"} strokeWidth={1} strokeDasharray="4 3" />
              {series.map((s, si) => {
                const v = s.data[active];
                if (v == null || !isFinite(v)) return null;
                return (
                  <g key={si}>
                    <circle cx={cx} cy={yp(v, si)} r={7} fill={s.color} opacity={0.15} />
                    <circle cx={cx} cy={yp(v, si)} r={4.5} fill={s.color} stroke={isDark ? "#0f172a" : "#fff"} strokeWidth={2} />
                  </g>
                );
              })}
            </g>
          );
        })()}
        {labels.length > 0 && [0, Math.floor(labels.length / 2), labels.length - 1].map(i =>
          i < labels.length && labels[i]
            ? <text key={i} x={xp(i)} y={height - 4} textAnchor="middle" fontSize={9} fill={tc}>{str(labels[i])}</text>
            : null
        )}
      </svg>
      {active !== null && inChart && (
        <div style={{ position: "absolute", left: tipOnRight ? `calc(${tipXpct}% + 8px)` : "auto", right: tipOnRight ? "auto" : `calc(${100 - tipXpct}% + 8px)`, top: 8, zIndex: 50, pointerEvents: "none", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 13px", fontSize: 12, minWidth: 150, whiteSpace: "nowrap", boxShadow: "0 4px 20px var(--shadow-color)" }}>
          {pinIdx !== null && <div style={{ fontSize: 9, color: "var(--accent)", marginBottom: 4, fontWeight: 600 }}>📌 Pinned — click to unpin</div>}
          {labels[active] && <div style={{ color: "var(--text-dim)", fontSize: 10, marginBottom: 6, fontWeight: 600 }}>{str(labels[active])}</div>}
          {series.map((s, si) => {
            const v = s.data[active];
            if (v == null || !isFinite(v)) return null;
            return (
              <div key={si} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2, alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block", flexShrink: 0 }} />
                  {str(s.name)}
                </span>
                <span style={{ fontWeight: 700, fontFamily: "monospace", color: s.color }}>{str(s.fmt ? s.fmt(v) : fmtN(v))}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Testnet stats ─────────────────────────────────────────────────────────────
async function fetchTestnetStats(): Promise<TestnetStats | null> {
  try {
    const r = await fetch("/api/geo-sync/stats/live?network=testnet");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as Record<string, unknown>;
    const d  = (j?.data ?? {}) as Record<string, unknown>;
    return {
      blockHeight:         num(d.blockHeight),
      ledgerVersion:       num(d.ledgerVersion),
      chainId:             num(d.chainId) || 2,
      activeBlobs:         num(d.activeBlobs),
      slices:              num(d.slices),
      placementGroups:     num(d.placementGroups),
      storageProviders:    num(d.storageProviders),
      waitlistedProviders: num(d.waitlistedProviders),
      indexerStatus:       String(d.indexerStatus ?? "unknown"),
    };
  } catch (e) { console.warn("[testnet stats]", e); return null; }
}

// ─── UI Components ─────────────────────────────────────────────────────────────
function Sec({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>{str(title)}</h2>
          {sub && <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "3px 0 0" }}>{str(sub)}</p>}
        </div>
        {right && <div>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, sub, latest, color, children }: { title: string; sub?: string; latest?: string; color?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 13, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{str(title)}</div>
          {sub && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{str(sub)}</div>}
        </div>
        {latest && <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: color || "var(--text-primary)" }}>{str(latest)}</div>}
      </div>
      {children}
    </div>
  );
}

function RangeSel({ range, onChange }: { range: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <div style={{ display: "flex", gap: 3, background: "var(--bg-card2)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
      {(["1h", "24h", "7d", "30d"] as TimeRange[]).map(r => (
        <button key={r} onClick={() => onChange(r)} style={{ padding: "5px 13px", borderRadius: 6, fontSize: 12, fontWeight: r === range ? 700 : 400, border: "none", cursor: "pointer", background: r === range ? "var(--accent)" : "transparent", color: r === range ? "#fff" : "var(--text-muted)", transition: "all 0.1s" }}>
          {r}
        </button>
      ))}
    </div>
  );
}

function SnapCard({ label, value, delta, from, color }: { label: string; value: string; delta: number | null; from: number | null; color?: string }) {
  const safeColor  = color || "var(--text-primary)";
  const safeDelta  = (delta !== null && isFinite(delta)) ? delta : null;
  const pct        = safeDelta !== null && from !== null && isFinite(from) && Math.abs(from) > 0 ? (safeDelta / Math.abs(from)) * 100 : null;
  const safePct    = pct !== null && isFinite(pct) ? pct : null;
  const pos        = safeDelta !== null ? safeDelta > 0 : null;
  const deltaStr   = safeDelta !== null ? (safeDelta > 0 ? `+${Math.round(safeDelta).toLocaleString("en-US")}` : Math.round(safeDelta).toLocaleString("en-US")) : null;
  const pctStr     = safePct !== null ? `(${safePct >= 0 ? "+" : ""}${safePct.toFixed(1)}%)` : null;
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-muted)", textTransform: "uppercase" }}>{str(label)}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: safeColor, fontFamily: "monospace", lineHeight: 1.1 }}>{str(value)}</div>
      {deltaStr !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4, color: pos === true ? "#22c55e" : safeDelta! < 0 ? "#ef4444" : "var(--text-muted)", background: pos === true ? "rgba(34,197,94,0.1)" : safeDelta! < 0 ? "rgba(239,68,68,0.1)" : "rgba(0,0,0,0.04)" }}>
            {deltaStr}
          </span>
          {pctStr && <span style={{ fontSize: 10, color: pos === true ? "#22c55e" : safeDelta! < 0 ? "#ef4444" : "var(--text-muted)", fontWeight: 600 }}>{pctStr}</span>}
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>vs previous 24h</span>
        </div>
      )}
    </div>
  );
}

function Pager({ total, page, per, set }: { total: number; page: number; per: number; set: (p: number) => void }) {
  const pages = Math.ceil(total / per);
  if (pages <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 12 }}>
      <button onClick={() => set(page - 1)} disabled={page === 0} style={{ padding: "4px 11px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-muted)", cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1, fontSize: 13 }}>←</button>
      {Array.from({ length: Math.min(pages, 8) }, (_, i) => i).map(i => (
        <button key={i} onClick={() => set(i)} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid var(--border)", background: i === page ? "var(--accent)" : "var(--bg-card)", color: i === page ? "#fff" : "var(--text-muted)", cursor: "pointer", fontWeight: i === page ? 700 : 400, fontSize: 13, minWidth: 32 }}>
          {i + 1}
        </button>
      ))}
      {pages > 8 && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>…{pages}</span>}
      <button onClick={() => set(page + 1)} disabled={page === pages - 1} style={{ padding: "4px 11px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-muted)", cursor: page === pages - 1 ? "not-allowed" : "pointer", opacity: page === pages - 1 ? 0.4 : 1, fontSize: 13 }}>→</button>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();
  const networkLabel = config?.label ?? network ?? "Shelbynet";
  const clock        = useLiveUTCClock(); // "" on server, fills after mount
  const alive        = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const [range,          setRange]          = useState<TimeRange>("24h");
  const [ts,             setTs]             = useState<TsPoint[]>([]);
  const [ts48h,          setTs48h]          = useState<TsPoint[]>([]);
  const [live,           setLive]           = useState<LivePt[]>([]);
  const [bench,          setBench]          = useState<ServerBench[]>([]);
  const [pg,             setPg]             = useState<number>(0);
  const [benchLoading,   setBenchLoading]   = useState<boolean>(true);
  const [testnetStats,   setTestnetStats]   = useState<TestnetStats | null>(null);
  const [testnetLoading, setTestnetLoading] = useState<boolean>(false);
  const [fetchError,     setFetchError]     = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLive = useCallback(async (net: string) => {
    try {
      const r = await fetch(`/api/network/stats/live?network=${net}`);
      if (!r.ok) { if (alive.current) setFetchError(`Backend returned ${r.status}`); return; }
      if (alive.current) setFetchError(null);
      const j = await r.json() as Record<string, unknown>;
      const d  = (j?.data ?? j ?? {}) as Record<string, unknown>;
      if (alive.current) setLive(prev => [...prev, {
        ts:              Date.now(),
        blockHeight:     num(d.blockHeight),
        activeBlobs:     num(d.activeBlobs),
        totalStorageGB:  num(d.totalStorageBytes) / 1e9,
        totalBlobEvents: num(d.totalBlobEvents),
        pendingOrFailed: num(d.pendingOrFailed),
        deletedBlobs:    num(d.deletedBlobs),
      }].slice(-120));
    } catch (e) {
      if (alive.current) setFetchError(`Network error: ${(e as Error).message}`);
    }
  }, []);

  const fetchTs = useCallback(async (net: string, r: TimeRange) => {
    try {
      const res_ = r === "1h" || r === "24h" ? "5m" : "1h";
      const j    = await fetch(`/api/network/stats/timeseries?network=${net}&resolution=${res_}&range=${r}`).then(x => x.json()) as Record<string, unknown>;
      const arr  = ((j?.data as Record<string, unknown>)?.series ?? []) as Record<string, unknown>[];
      if (alive.current) setTs(arr.map(enrichPoint));
    } catch { /* silent */ }
  }, []);

  const fetchTs48h = useCallback(async (net: string) => {
    try {
      const j   = await fetch(`/api/network/stats/timeseries?network=${net}&resolution=1h&range=7d`).then(x => x.json()) as Record<string, unknown>;
      const arr = ((j?.data as Record<string, unknown>)?.series ?? []) as Record<string, unknown>[];
      if (alive.current) setTs48h(arr.map(enrichPoint).slice(-48));
    } catch { /* silent */ }
  }, []);

  const fetchBench = useCallback(async () => {
    if (alive.current) setBenchLoading(true);
    try {
      const j = await fetch("/api/benchmark/results?limit=500").then(x => x.json()) as Record<string, unknown>;
      if (alive.current) setBench(Array.isArray(j?.results) ? j.results as ServerBench[] : []);
    } catch {
      if (alive.current) setBench([]);
    } finally {
      if (alive.current) setBenchLoading(false);
    }
  }, []);

  const fetchTestnet = useCallback(async () => {
    if (alive.current) setTestnetLoading(true);
    const s = await fetchTestnetStats();
    if (alive.current) { setTestnetStats(s); setTestnetLoading(false); }
  }, []);

  useEffect(() => {
    if (alive.current) setLive([]);
    if (alive.current) setFetchError(null);
    fetchLive(network);
    fetchTs(network, range);
    fetchTs48h(network);
    fetchBench();
    if (network === "testnet") fetchTestnet();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (!alive.current) return;
      fetchLive(network);
      fetchTs48h(network);
      fetchBench();
      if (network === "testnet") fetchTestnet();
    }, POLL);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  useEffect(() => { fetchTs(network, range); }, [range, network, fetchTs]);

  const cd = ts.length > 0 ? ts : live.map(p => enrichPoint({
    tsMs: p.ts, activeBlobs: p.activeBlobs, totalStorageGB: p.totalStorageGB,
    totalBlobEvents: p.totalBlobEvents, pendingOrFailed: p.pendingOrFailed,
    deletedBlobs: p.deletedBlobs, blockHeight: p.blockHeight,
  }));
  const labels   = cd.map(p => tLbl(p.tsMs, range));
  const latest   = live[live.length - 1];
  const latestTs = cd[cd.length - 1];
  const currentAvgBlobKB = computeAvgBlobKB(num(latestTs?.activeBlobs), num(latestTs?.totalStorageGB));

  const mid48    = Math.floor(ts48h.length / 2);
  const prevLast = ts48h[mid48 - 1];
  const currLast = ts48h[ts48h.length - 1];

  function d48(key: keyof TsPoint): { delta: number | null; from: number | null } {
    if (!prevLast || !currLast) return { delta: null, from: null };
    const curr = num(currLast[key]), prev = num(prevLast[key]);
    if (prev === 0 && curr === 0) return { delta: null, from: null };
    return { delta: curr - prev, from: prev };
  }

  const allBench           = bench;
  const pagedBench         = allBench.slice(pg * PG, (pg + 1) * PG);
  const benchChronological = [...allBench].reverse();
  const benchLabels        = benchChronological.map(h => h.ts ? new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
  const avgScore     = allBench.length ? allBench.reduce((s, h) => s + num(h.score),       0) / allBench.length : 0;
  const avgUpload    = allBench.length ? allBench.reduce((s, h) => s + num(h.avgUploadKbs), 0) / allBench.length : 0;
  const avgLatency   = allBench.length ? allBench.reduce((s, h) => s + num(h.latencyAvg),   0) / allBench.length : 0;
  const avgTxConfirm = allBench.length ? allBench.reduce((s, h) => s + num(h.txConfirmMs),  0) / allBench.length : 0;

  // ── Testnet view ──────────────────────────────────────────────────────────────
  if (network === "testnet") {
    const ts_ = testnetStats;
    return (
      <div style={{ background: "var(--bg-primary)", minHeight: "100vh", padding: "28px 36px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.5 }}>Testnet Analytics</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Shelby Testnet · Contract: <code style={{ fontSize: 11 }}>{TESTNET_CONTRACT.slice(0, 10)}…</code> · Chain ID: {str(ts_?.chainId ?? 2)}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* clock is "" on server, filled after mount → no hydration mismatch */}
            {clock && <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-dim)", background: "var(--bg-card)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: 7 }}>🕐 {clock}</span>}
            <button onClick={fetchTestnet} disabled={testnetLoading} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>
              {testnetLoading ? "Loading…" : "⟳ Refresh"}
            </button>
          </div>
        </div>

        <div style={{ background: "rgba(147,51,234,0.08)", border: "1px solid rgba(147,51,234,0.25)", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#c084fc", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚗</span>
          <span>Early Testnet · Data from Aptos Testnet RPC (REST API)</span>
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>Auto-refresh every {POLL / 1000}s</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 24 }}>
          {([
            { label: "Block Height",     value: ts_ ? `#${ts_.blockHeight.toLocaleString("en-US")}` : "—", color: "var(--accent)" },
            { label: "Active SPs",       value: fmtN(ts_?.storageProviders),    color: "#22c55e" },
            { label: "Waitlisted SPs",   value: fmtN(ts_?.waitlistedProviders), color: "#f59e0b" },
            { label: "Placement Groups", value: fmtN(ts_?.placementGroups),     color: "#fb923c" },
            { label: "Slices",           value: fmtN(ts_?.slices),              color: "#818cf8" },
            { label: "Active Blobs",     value: fmtN(ts_?.activeBlobs),         color: "#34d399" },
            { label: "Indexer Status",   value: str(ts_?.indexerStatus),        color: ts_?.indexerStatus === "live" ? "#22c55e" : "#f87171" },
          ] as Array<{ label: string; value: string; color: string }>).map(({ label, value, color }) => (
            <div key={label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{str(label)}</div>
              <div style={{ fontSize: testnetLoading ? 12 : 18, fontWeight: 800, color, fontFamily: "monospace" }}>
                {testnetLoading ? "Loading…" : str(value)}
              </div>
            </div>
          ))}
        </div>

        {ts_ ? (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 13, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 14 }}>Data Sources & Methods</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-card2)" }}>
                  {["Metric", "Value", "Source", "Method"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { metric: "Block Height",     value: `#${ts_.blockHeight.toLocaleString("en-US")}`, source: "Fullnode REST", method: "GET /v1/" },
                  { metric: "Ledger Version",   value: ts_.ledgerVersion.toLocaleString("en-US"),     source: "Fullnode REST", method: "GET /v1/ → ledger_version" },
                  { metric: "Active SPs",       value: fmtN(ts_.storageProviders),                    source: "Fullnode REST", method: "epoch::Epoch → active_providers.entries" },
                  { metric: "Waitlisted SPs",   value: fmtN(ts_.waitlistedProviders),                 source: "Fullnode REST", method: "epoch::Epoch → waitlisted_providers.entries" },
                  { metric: "Placement Groups", value: fmtN(ts_.placementGroups),                     source: "Fullnode REST", method: "epoch::Epoch → placement_groups" },
                  { metric: "Slices",           value: fmtN(ts_.slices),                               source: "Fullnode REST", method: "epoch::Epoch → slices" },
                  { metric: "Active Blobs",     value: fmtN(ts_.activeBlobs),                         source: "Aptos Indexer", method: "blobs_aggregate count (best-effort)" },
                ].map(({ metric, value, source, method }) => (
                  <tr key={metric} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-primary)" }}>{str(metric)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "var(--accent)" }}>{str(value)}</td>
                    <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-muted)" }}>{str(source)}</td>
                    <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>{str(method)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !testnetLoading && (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🔬</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>Testnet data unavailable</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              The backend may be unreachable or the Testnet contract is not yet deployed.
            </div>
            <button onClick={fetchTestnet} style={{ padding: "8px 18px", borderRadius: 8, background: "var(--accent)", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              ⟳ Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Shelbynet view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "var(--bg-primary)", minHeight: "100vh", padding: "28px 36px 48px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.5 }}>Network Analytics</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>{networkLabel} · Refresh every {POLL / 1000}s</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {clock && <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-dim)", background: "var(--bg-card)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: 7, minWidth: 110, textAlign: "center" }}>🕐 {clock}</span>}
          <button onClick={() => { fetchLive(network); fetchTs48h(network); fetchBench(); }} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>
            ⟳ Refresh
          </button>
        </div>
      </div>

      {fetchError && (
        <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 9, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#d97706", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚠</span><span>{str(fetchError)}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>Retrying every {POLL / 1000}s</span>
        </div>
      )}

      <Sec title="Network Snapshot" sub="Current values · % change vs previous 24h window">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          <SnapCard label="Block Height" value={str(latest ? `#${num(latest.blockHeight).toLocaleString("en-US")}` : undefined)} color="var(--accent)" delta={null} from={null} />
          {(() => { const { delta, from } = d48("activeBlobs");     return <SnapCard label="Active Blobs"   value={fmtN(latestTs?.activeBlobs)}    color="#22c55e" delta={delta} from={from} />; })()}
          {(() => { const { delta, from } = d48("totalStorageGB");  return <SnapCard label="Storage Used"   value={fmtGB(latestTs?.totalStorageGB)} color="#a78bfa" delta={delta} from={from} />; })()}
          {(() => { const { delta, from } = d48("totalBlobEvents"); return <SnapCard label="Blob Events"    value={fmtN(latestTs?.totalBlobEvents)} color="#fb923c" delta={delta} from={from} />; })()}
          {(() => { const { delta, from } = d48("pendingOrFailed"); return <SnapCard label="Pending Blobs" value={fmtN(latestTs?.pendingOrFailed)} color="#fbbf24" delta={delta} from={from} />; })()}
          {(() => { const { delta, from } = d48("deletedBlobs");    return <SnapCard label="Deleted Blobs" value={fmtN(latestTs?.deletedBlobs)}   color="#f87171" delta={delta} from={from} />; })()}
        </div>
      </Sec>

      <Sec title="Blob Analytics" sub="Blob count and activity over time" right={<RangeSel range={range} onChange={r => { setRange(r); setPg(0); }} />}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <Card title="Active Blobs" sub={`${range} window`} latest={fmtN(latestTs?.activeBlobs)} color="#22c55e">
            <Chart series={[{ data: cd.map(p => num(p.activeBlobs)), color: "#22c55e", name: "Active", fmt: v => fmtN(v) }]} labels={labels} height={140} />
          </Card>
          <Card title="Blob Events" sub="blob_activities_aggregate count" latest={fmtN(latestTs?.totalBlobEvents)} color="#fb923c">
            <Chart series={[{ data: cd.map(p => num(p.totalBlobEvents)), color: "#fb923c", name: "Events", fmt: v => fmtN(v) }]} labels={labels} height={140} />
          </Card>
        </div>
        <Card title="Pending & Deleted Blobs" sub="Anomaly tracking · auto-scaled per series">
          <Chart perScale series={[
            { data: cd.map(p => num(p.pendingOrFailed)), color: "#fbbf24", name: "Pending", fmt: v => fmtN(v) },
            { data: cd.map(p => num(p.deletedBlobs)),    color: "#f87171", name: "Deleted", fmt: v => fmtN(v) },
          ]} labels={labels} height={120} />
        </Card>
      </Sec>

      <Sec title="Storage Analytics" sub="Capacity, utilization, and blob size">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
          <Card title="Storage Used (GB)" latest={fmtGB(latestTs?.totalStorageGB)} color="#a78bfa">
            <Chart series={[{ data: cd.map(p => num(p.totalStorageGB)), color: "#a78bfa", name: "GB", fmt: v => `${v.toFixed(2)} GB` }]} labels={labels} height={150} />
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Total Storage", val: fmtGB(latestTs?.totalStorageGB),  c: "#a78bfa" },
              { label: "Active Blobs",  val: fmtN(latestTs?.activeBlobs),      c: "#22c55e" },
              { label: "Avg Blob Size", val: fmtKB(currentAvgBlobKB),          c: "var(--accent)", hint: "totalStorage / activeBlobs" },
            ].map(({ label, val, c, hint }) => (
              <div key={label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{str(label)}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: c, fontFamily: "monospace" }}>{str(val)}</div>
                {hint && <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 2 }}>{hint}</div>}
              </div>
            ))}
          </div>
        </div>
        <Card title="Avg Blob Size over Time" sub="totalStorageBytes / activeBlobs" latest={fmtKB(currentAvgBlobKB)} color="var(--accent)">
          <Chart series={[{ data: cd.map(p => num(p.avgBlobSizeKB)), color: "var(--accent)", name: "Avg Size", fmt: v => fmtKB(v) }]} labels={labels} height={130} />
        </Card>
      </Sec>

      <Sec title="Block Performance" sub="Block height progression">
        <Card title="Block Height" latest={str(latest ? `#${num(latest.blockHeight).toLocaleString("en-US")}` : undefined)} color="var(--accent)">
          <Chart series={[{ data: cd.map(p => num(p.blockHeight)).filter(v => v > 0), color: "var(--accent)", name: "Block", fmt: v => `#${Math.round(v).toLocaleString("en-US")}` }]} labels={labels} height={130} />
        </Card>
      </Sec>

      <Sec title="Benchmark Analytics" sub={`${allBench.length} total runs · all time`}>
        {benchLoading ? (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "36px 20px", textAlign: "center" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
          </div>
        ) : allBench.length === 0 ? (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "36px 20px", textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 14 }}>No benchmark runs yet</div>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
              {[
                { label: "Avg Score",      value: str(Math.round(avgScore)), color: "#818cf8" },
                { label: "Avg Upload",     value: fmtKbs(avgUpload),          color: "var(--accent)" },
                { label: "Avg Latency",    value: fmtMs(avgLatency),          color: "#c084fc" },
                { label: "Avg TX Confirm", value: fmtMs(avgTxConfirm),        color: "#fb923c" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{str(label)}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "monospace" }}>{str(value)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Card title="Score History" sub="All users · all time" latest={str(allBench[0]?.score)} color="#818cf8">
                <Chart series={[{ data: benchChronological.map(h => num(h.score)), color: "#818cf8", name: "Score", fmt: v => `${Math.round(v)}/1000` }]} labels={benchLabels} height={130} />
              </Card>
              <Card title="Avg Upload Speed" latest={fmtKbs(avgUpload)} color="var(--accent)">
                <Chart series={[{ data: benchChronological.map(h => num(h.avgUploadKbs)), color: "var(--accent)", name: "Upload", fmt: v => fmtKbs(v) }]} labels={benchLabels} height={130} />
              </Card>
              <Card title="Avg Latency" sub="Node ping" latest={fmtMs(avgLatency)} color="#c084fc">
                <Chart series={[{ data: benchChronological.map(h => num(h.latencyAvg)), color: "#c084fc", name: "Latency", fmt: v => fmtMs(v) }]} labels={benchLabels} height={130} />
              </Card>
              <Card title="TX Confirm Time" sub="Aptos transaction confirmation" latest={fmtMs(avgTxConfirm)} color="#fb923c">
                <Chart series={[{ data: benchChronological.map(h => num(h.txConfirmMs)), color: "#fb923c", name: "TX Confirm", fmt: v => fmtMs(v) }]} labels={benchLabels} height={130} />
              </Card>
            </div>
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Global Run History</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {allBench.length} runs · all time · Page {pg + 1}/{Math.max(1, Math.ceil(allBench.length / PG))}
                  </div>
                </div>
                <button onClick={fetchBench} style={{ padding: "4px 11px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>⟳</button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--bg-card2)" }}>
                      {["Device", "Time", "Score", "Tier", "Upload", "Download", "Latency", "TX Confirm", "Mode"].map(h => (
                        <th key={h} style={{ padding: "9px 13px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBench.map((h, i) => {
                      const sc = num(h.score);
                      const c  = sc >= 900 ? "#22c55e" : sc >= 600 ? "#fbbf24" : "#f87171";
                      const timeStr = h.ts ? str(new Date(h.ts).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })) : "—";
                      return (
                        <tr key={str(h.id) || String(i)} style={{ borderTop: "1px solid var(--border-soft)" }}>
                          <td style={{ padding: "8px 13px" }}><DeviceBadge h={h} /></td>
                          <td style={{ padding: "8px 13px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace", whiteSpace: "nowrap" }}>{timeStr}</td>
                          <td style={{ padding: "8px 13px" }}><span style={{ fontFamily: "monospace", fontWeight: 800, color: c, fontSize: 14 }}>{str(sc > 0 ? sc : undefined)}</span></td>
                          <td style={{ padding: "8px 13px" }}><span style={{ fontSize: 11, color: c, fontWeight: 600 }}>{str(h.tier)}</span></td>
                          <td style={{ padding: "8px 13px", fontFamily: "monospace", color: "var(--accent)",  whiteSpace: "nowrap" }}>{fmtKbs(h.avgUploadKbs)}</td>
                          <td style={{ padding: "8px 13px", fontFamily: "monospace", color: "#22c55e",        whiteSpace: "nowrap" }}>{fmtKbs(h.avgDownloadKbs)}</td>
                          <td style={{ padding: "8px 13px", fontFamily: "monospace", color: "#c084fc",        whiteSpace: "nowrap" }}>{fmtMs(h.latencyAvg)}</td>
                          <td style={{ padding: "8px 13px", fontFamily: "monospace", color: "#fb923c",        whiteSpace: "nowrap" }}>{fmtMs(h.txConfirmMs)}</td>
                          <td style={{ padding: "8px 13px" }}><span style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", textTransform: "uppercase" }}>{str(h.mode)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "8px 18px", borderTop: "1px solid var(--border-soft)" }}>
                <Pager total={allBench.length} page={pg} per={PG} set={setPg} />
              </div>
            </div>
          </>
        )}
      </Sec>
    </div>
  );
}