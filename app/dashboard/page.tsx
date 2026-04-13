"use client";
/**
 * app/dashboard/page.tsx — v11.0
 *
 * FIX ts(2345) "safeSet" errors:
 * Same root cause as charts-page: safeSet<T> infers T from the passed value literal,
 * not from Dispatch<SetStateAction<T>>. This causes:
 *   safeSet(setSnap, null)      → T=null ≠ LiveSnap|null       → ts(2345)
 *   safeSet(setLastAt, new Date()) → T=Date ≠ Date|null        → ts(2345)
 *   safeSet(setSeries, [])      → T=never[] ≠ LivePoint[]      → ts(2345)
 *   safeSet(setSeries, (prev: LivePoint[]) => ...) → functional updater mismatch
 *
 * Fix: Remove safeSet entirely. Call each setState directly with
 * `if (alive.current) setXxx(value)` — TypeScript infers types correctly
 * from each individual useState<T> declaration.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveSnap {
  ts?: string; tsMs?: number; network?: string;
  activeBlobs?: number; pendingOrFailed?: number; pendingBlobs?: number;
  deletedBlobs?: number; failedBlobs?: number; emptyRecords?: number;
  totalBlobEvents?: number; totalStorageBytes?: number;
  totalStorageGB?: number; totalStorageGiB?: number;
  storageProviders?: number; placementGroups?: number; slices?: number;
  blockHeight?: number; ledgerVersion?: number; method?: string;
  chainId?: number; waitlistedProviders?: number; indexerStatus?: string;
}
interface LivePoint {
  ts: number;
  activeBlobs:       number | null;
  totalStorageBytes: number | null;
  totalBlobEvents:   number | null;
  blockHeight:       number;
}

const MAX_POINTS = 60;
const POLL_MS    = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function str(v: unknown): string {
  if (v == null)             return "—";
  if (typeof v === "string") return v.trim() || "—";
  if (typeof v === "number") return isFinite(v) ? String(v) : "—";
  return "—";
}
function fmtFull(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return Math.round(n).toLocaleString("en-US");
}
function fmtBytes(b: number | null | undefined): string {
  if (b == null || b === 0) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}
function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ─── SparkLine ────────────────────────────────────────────────────────────────
function SparkLine({ data, color, height = 100 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
      Collecting data…
    </div>
  );
  const W = 560, pad = { t: 8, b: 8, l: 45, r: 8 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const xs  = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys  = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t + iH} ${line} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gId  = `spk_${color.replace(/[^a-z0-9]/gi, "_")}`;
  const fmt  = (v: number) => v >= 1e9 ? `${(v / 1e9).toFixed(1)}G` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + iH - f * iH} y2={pad.t + iH - f * iH} stroke="var(--border)" />
          <text x={pad.l - 5} y={pad.t + iH - f * iH + 3} textAnchor="end" fontSize={9} fill="var(--text-dim)">{fmt(min + f * range)}</text>
        </g>
      ))}
      <polygon points={area} fill={`url(#${gId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={4} fill={color} stroke="var(--bg-card)" strokeWidth={2} />
    </svg>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, color, loading }: {
  label: string; value: string; sub?: string; icon: string; color: string; loading: boolean;
}) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px", borderTop: `3px solid ${color}`, transition: "background 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{str(label)}</span>
        <span style={{ fontSize: 16, opacity: 0.5 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: loading ? "var(--text-dim)" : "var(--text-primary)", letterSpacing: -0.8, lineHeight: 1.1, fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
        {loading ? "…" : str(value)}
      </div>
      {sub != null && sub !== "" && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>{str(sub)}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { network } = useNetwork();
  const isTestnet   = network === "testnet";
  const alive       = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Explicit types on every useState so TS knows exact setter types
  const [snap,       setSnap]       = useState<LiveSnap | null>(null);
  const [series,     setSeries]     = useState<LivePoint[]>([]);
  const [loading,    setLoading]    = useState<boolean>(true);
  const [lastAt,     setLastAt]     = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // FIX ts(2345): No safeSet. Direct alive.current guards per setState.
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/stats/live?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} from stats/live`);
      const j    = await res.json() as Record<string, unknown>;
      const data = (j.data ?? j) as LiveSnap;
      if (data && (data.activeBlobs != null || data.blockHeight != null || data.storageProviders != null)) {
        if (alive.current) setSnap(data);
        if (alive.current) setLastAt(new Date());
        if (alive.current) setFetchError(null);
        if (alive.current) setSeries(prev => {
          const pt: LivePoint = {
            ts:                Date.now(),
            activeBlobs:       data.activeBlobs       ?? null,
            totalStorageBytes: data.totalStorageBytes ?? null,
            totalBlobEvents:   data.totalBlobEvents   ?? null,
            blockHeight:       data.blockHeight       ?? 0,
          };
          const next = [...prev, pt];
          return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
        });
        return;
      }
    } catch (e1: unknown) {
      const msg1 = (e1 as Error).message;
      console.warn("[dashboard] stats/live failed:", msg1);
      // Fallback: try cached /stats endpoint
      try {
        const r2  = await fetch(`/api/network/stats?network=${network}`);
        if (!r2.ok) throw new Error(`HTTP ${r2.status} from /stats`);
        const j2  = await r2.json() as Record<string, unknown>;
        const d2  = (j2.data as Record<string, unknown>) ?? {};
        const s   = (d2.stats as Record<string, unknown>) ?? {};
        const node = (d2.node as Record<string, unknown>) ?? {};
        if (s.totalBlobs != null || s.activeBlobs != null) {
          const fallback: LiveSnap = {
            ts: new Date().toISOString(), tsMs: Date.now(),
            activeBlobs:       Number(s.totalBlobs ?? s.activeBlobs ?? 0),
            totalBlobEvents:   Number(s.totalBlobEvents ?? 0),
            totalStorageBytes: Number(s.totalStorageUsedBytes ?? 0),
            totalStorageGB:    Number(s.totalStorageUsedBytes ?? 0) / 1e9,
            totalStorageGiB:   Number(s.totalStorageUsedBytes ?? 0) / (1024 ** 3),
            storageProviders:  Number(s.storageProviders  ?? 0),
            placementGroups:   Number(s.placementGroups   ?? 0),
            slices:            Number(s.slices             ?? 0),
            blockHeight:       Number(node.blockHeight    ?? 0),
            ledgerVersion:     Number(node.ledgerVersion  ?? 0),
            pendingOrFailed:   0, deletedBlobs: 0, emptyRecords: 0,
            method: String(d2.statsSource ?? "cached"),
          };
          if (alive.current) setSnap(fallback);
          if (alive.current) setLastAt(new Date());
          if (alive.current) setFetchError(`Live data unavailable (${msg1}), using cache`);
          return;
        }
      } catch (e2: unknown) {
        if (alive.current) setFetchError(`Backend unreachable: ${(e2 as Error).message}`);
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    if (alive.current) setLoading(true);
    if (alive.current) setSnap(null);
    if (alive.current) setSeries([]);
    if (alive.current) setFetchError(null);
    fetchStats();
    const id = setInterval(() => { if (alive.current) fetchStats(); }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  // ── Metric cards ─────────────────────────────────────────────────────────────
  const METRICS = isTestnet ? [
    { label: "Active Blobs",      value: fmtFull(snap?.activeBlobs),         sub: "From Indexer (best-effort)", icon: "◈", color: "#2563eb" },
    { label: "Block Height",      value: snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—", sub: `Ledger v${fmtFull(snap?.ledgerVersion)}`, icon: "⬡", color: "#9333ea" },
    { label: "Storage Providers", value: fmtFull(snap?.storageProviders),    sub: "Active on Testnet",          icon: "◎", color: "#0891b2" },
    { label: "Waitlisted SPs",    value: fmtFull(snap?.waitlistedProviders), sub: "In waitlist queue",           icon: "◎", color: "#f59e0b" },
    { label: "Placement Groups",  value: fmtFull(snap?.placementGroups),     sub: "From Epoch registry",         icon: "▦", color: "#d97706" },
    { label: "Slices",            value: fmtFull(snap?.slices),               sub: "From Epoch registry",         icon: "⬡", color: "#7c3aed" },
  ] : [
    { label: "Active Blobs",      value: fmtFull(snap?.activeBlobs),         sub: "Files stored on-chain",       icon: "◈", color: "#2563eb" },
    { label: "Storage Used",      value: fmtBytes(snap?.totalStorageBytes),  sub: snap?.totalStorageGiB ? `${Number(snap.totalStorageGiB).toFixed(2)} GiB` : "", icon: "▣", color: "#059669" },
    { label: "Blob Events",       value: fmtFull(snap?.totalBlobEvents),     sub: "blob_activities count",       icon: "↯", color: "#9333ea" },
    { label: "Storage Providers", value: fmtFull(snap?.storageProviders),    sub: "Active SPs on-chain",         icon: "◎", color: "#0891b2" },
    { label: "Placement Groups",  value: fmtFull(snap?.placementGroups),     sub: "Erasure code groups",         icon: "▦", color: "#d97706" },
    { label: "Slices",            value: fmtFull(snap?.slices),               sub: "Slice registry count",        icon: "⬡", color: "#7c3aed" },
  ];

  const methodLabel = snap?.method ? String(snap.method) : "";

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 4px" }}>
      <style>{`
        @media (max-width: 768px) {
          .dash-grid-2   { grid-template-columns: 1fr !important; }
          .dash-grid-3   { grid-template-columns: 1fr 1fr !important; }
          .dash-chart-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 480px) { .dash-grid-3 { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.8 }}>
            {isTestnet ? "Testnet Dashboard" : "Network Dashboard"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "5px 0 0", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {isTestnet ? "Aptos Testnet" : "Shelbynet"} · Poll every {POLL_MS / 1000}s
            {methodLabel && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: methodLabel.includes("shelby") ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)", color: methodLabel.includes("shelby") ? "#16a34a" : "#d97706" }}>
                {methodLabel}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "var(--text-dim)" : "#22c55e", boxShadow: loading ? "none" : "0 0 6px #22c55e", display: "inline-block" }} />
            {loading ? "Syncing…" : (lastAt ? lastAt.toLocaleTimeString() : "Live")}
          </div>
          <button onClick={fetchStats} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* Testnet notice */}
      {isTestnet && (
        <div style={{ background: "rgba(147,51,234,0.07)", border: "1px solid rgba(147,51,234,0.25)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#c084fc", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚗</span><span>Shelby Testnet · Live data from Aptos Testnet RPC</span>
        </div>
      )}

      {/* Error banner */}
      {fetchError && (
        <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#d97706", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚠</span><span>{str(fetchError)}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>Retrying every {POLL_MS / 1000}s</span>
        </div>
      )}

      {/* Block + breakdown */}
      <div className="dash-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8 }}>Block Height</div>
          <div style={{ fontFamily: "monospace", fontSize: 30, fontWeight: 800, color: isTestnet ? "#9333ea" : "#2563eb", fontVariantNumeric: "tabular-nums", wordBreak: "break-all" }}>
            {snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>
            Ledger v{snap?.ledgerVersion ? snap.ledgerVersion.toLocaleString("en-US") : "—"}
            {isTestnet && snap?.chainId != null && <span style={{ marginLeft: 10, color: "var(--text-dim)" }}>Chain ID: {snap.chainId}</span>}
          </div>
        </div>

        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 12 }}>
            {isTestnet ? "Network Status" : "Blob Breakdown"}
          </div>
          {loading ? (
            <div style={{ color: "var(--text-dim)", fontSize: 14 }}>Loading…</div>
          ) : !snap ? (
            <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{fetchError ? "Data unavailable — backend unreachable" : "No data yet"}</div>
          ) : isTestnet ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { label: "Active SPs",       v: snap.storageProviders,    color: "#22c55e" },
                { label: "Waitlisted SPs",   v: snap.waitlistedProviders, color: "#f59e0b" },
                { label: "Placement Groups", v: snap.placementGroups,     color: "#9333ea" },
                { label: "Slices",           v: snap.slices,              color: "#06b6d4" },
              ].map(({ label, v, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{str(label)}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace" }}>{fmtFull(v)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { label: "Active",  v: snap.activeBlobs,    color: "#22c55e" },
                { label: "Pending", v: snap.pendingOrFailed, color: "#f59e0b" },
                { label: "Deleted", v: snap.deletedBlobs,    color: "#ef4444" },
                { label: "Empty",   v: snap.emptyRecords,    color: "#9ca3af" },
              ].map(({ label, v, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{str(label)}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace" }}>{fmtFull(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Metrics grid */}
      <div className="dash-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 22 }}>
        {METRICS.map(m => <StatCard key={m.label} loading={loading} {...m} />)}
      </div>

      {/* Sparklines */}
      <div className="dash-chart-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 22 }}>
        {([
          { title: "Active Blobs",  sub: `${POLL_MS / 1000}s poll`, value: fmtFull(snap?.activeBlobs),       data: series.map(p => p.activeBlobs       ?? 0).filter(Boolean), color: isTestnet ? "#9333ea" : "#2563eb" },
          { title: "Block Height",  sub: "Chain progress",           value: snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—", data: series.map(p => p.blockHeight).filter(v => v > 0), color: isTestnet ? "#c084fc" : "#059669" },
          ...(!isTestnet ? [
            { title: "Storage Used",  sub: "Indexer bytes",          value: fmtBytes(snap?.totalStorageBytes), data: series.map(p => p.totalStorageBytes ?? 0).filter(Boolean), color: "#9333ea" },
            { title: "Blob Events",   sub: "blob_activities count",  value: fmtFull(snap?.totalBlobEvents),    data: series.map(p => p.totalBlobEvents   ?? 0).filter(Boolean), color: "#d97706" },
          ] : [
            { title: "Storage Providers", sub: "Active on testnet", value: fmtFull(snap?.storageProviders),  data: series.map(p => p.activeBlobs ?? 0), color: "#0891b2" },
            { title: "Placement Groups",  sub: "Epoch registry",    value: fmtFull(snap?.placementGroups),   data: series.map(p => p.blockHeight ?? 0),  color: "#d97706" },
          ]),
        ] as Array<{ title: string; sub: string; value: string; data: number[]; color: string }>).map(({ title, sub, value, data, color }) => (
          <div key={title} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{str(title)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{str(sub)}</div>
              </div>
              {snap && <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color, wordBreak: "break-all" }}>{str(value)}</div>}
            </div>
            <SparkLine data={data} color={color} height={110} />
            {series.length > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace", marginTop: 5 }}>
                <span>{timeLabel(series[0].ts)}</span>
                <span>{timeLabel(series[series.length - 1].ts)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Source */}
      <div style={{ background: "var(--bg-card2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "monospace" }}>
        {isTestnet
          ? "Source: Aptos Testnet REST API · epoch::Epoch resource · Indexer (best-effort)"
          : "Source: Shelby Dedicated Indexer (blobs_aggregate) · Aptos RPC resource reads"
        }
      </div>
    </div>
  );
}