"use client";
/**
 * app/dashboard/page.tsx — v7.1
 * Fix #4: Số hiển thị đầy đủ (1,261,662 thay vì 1.26M), font lớn hơn
 * Fix: Blob breakdown hiển thị rõ ràng
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveSnap {
  ts: string; tsMs: number;
  activeBlobs: number; pendingOrFailed: number; deletedBlobs: number; emptyRecords: number;
  totalBlobEvents: number; totalStorageBytes: number; totalStorageGB: number; totalStorageGiB: number;
  storageProviders: number; placementGroups: number; slices: number;
  blockHeight: number; ledgerVersion: number; method: string;
}

interface LivePoint {
  ts: number;
  activeBlobs: number | null;
  totalStorageBytes: number | null;
  totalBlobEvents: number | null;
  blockHeight: number;
}

const MAX_POINTS = 60;
const POLL_MS    = 30_000;

// ─── Helpers — hiển thị số đầy đủ với dấu phẩy ───────────────────────────────
function fmtFull(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US"); // 1,261,662
}
function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}
function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
function SparkLine({ data, color, height = 100 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#d1d5db", fontSize: 13 }}>
      Collecting data…
    </div>
  );
  const W = 560, pad = { t: 8, b: 8, l: 45, r: 8 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const xs = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t + iH} ${line} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gId = `g${color.replace(/[^a-z0-9]/gi, "")}`;
  const fmt = (v: number) => {
    if (v >= 1e9) return `${(v/1e9).toFixed(1)}G`;
    if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`;
    return String(Math.round(v));
  };
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + iH - f * iH} y2={pad.t + iH - f * iH} stroke="#f0f0f0" />
          <text x={pad.l - 5} y={pad.t + iH - f * iH + 3} textAnchor="end" fontSize={9} fill="#ccc">{fmt(min + f * range)}</text>
        </g>
      ))}
      <polygon points={area} fill={`url(#${gId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
    </svg>
  );
}

// ─── Stat Card — số lớn, rõ ──────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, color, loading }: {
  label: string; value: string; sub?: string; icon: string; color: string; loading: boolean;
}) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14,
      padding: "20px 24px", borderTop: `3px solid ${color}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 18, opacity: 0.5 }}>{icon}</span>
      </div>
      {/* Số lớn hơn — fix #4 */}
      <div style={{
        fontSize: 32, fontWeight: 800, color: loading ? "#d1d5db" : "#111827",
        letterSpacing: -1, lineHeight: 1.1, fontFamily: "monospace",
        fontVariantNumeric: "tabular-nums",
      }}>
        {loading ? "…" : value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { network } = useNetwork();
  const [snap,    setSnap]    = useState<LiveSnap | null>(null);
  const [series,  setSeries]  = useState<LivePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastAt,  setLastAt]  = useState<Date | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/stats/live?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as any;
      const data: LiveSnap = j.data ?? j;
      if (data && (data.activeBlobs != null || data.blockHeight)) {
        setSnap(data);
        setLastAt(new Date());
        setError(null);
        setSeries(prev => {
          const pt: LivePoint = {
            ts: Date.now(),
            activeBlobs: data.activeBlobs,
            totalStorageBytes: data.totalStorageBytes,
            totalBlobEvents: data.totalBlobEvents,
            blockHeight: data.blockHeight,
          };
          const next = [...prev, pt];
          return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
        });
      }
    } catch (e: any) {
      setError(e.message);
      // Fallback
      try {
        const r2 = await fetch(`/api/network/stats?network=${network}`);
        const j2 = await r2.json() as any;
        if (j2.data?.stats?.totalBlobs != null) {
          const s = j2.data.stats;
          setSnap(prev => ({
            ...prev!,
            activeBlobs: s.totalBlobs,
            totalBlobEvents: s.totalBlobEvents ?? 0,
            totalStorageBytes: s.totalStorageUsedBytes ?? 0,
            totalStorageGB: s.totalStorageUsedBytes ? s.totalStorageUsedBytes / 1e9 : 0,
            totalStorageGiB: s.totalStorageUsedBytes ? s.totalStorageUsedBytes / (1024**3) : 0,
            storageProviders: s.storageProviders ?? 0,
            placementGroups: s.placementGroups ?? 0,
            slices: s.slices ?? 0,
            blockHeight: j2.data.node?.blockHeight ?? prev?.blockHeight ?? 0,
            ledgerVersion: j2.data.node?.ledgerVersion ?? prev?.ledgerVersion ?? 0,
            pendingOrFailed: 0, deletedBlobs: 0, emptyRecords: 0,
            method: j2.data.statsSource ?? "cached",
            ts: new Date().toISOString(), tsMs: Date.now(), network,
          } as LiveSnap));
          setLastAt(new Date());
          setError(null);
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setLoading(true);
    setSnap(null);
    setSeries([]);
    fetchStats();
    const id = setInterval(fetchStats, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  if (network === "testnet") return <TestnetBanner />;

  const totalBlobs = snap ? snap.activeBlobs + snap.pendingOrFailed + snap.deletedBlobs + snap.emptyRecords : 0;

  // Fix #4: số đầy đủ
  const METRICS = [
    { label: "Active Blobs",      value: fmtFull(snap?.activeBlobs),     sub: "Files stored on-chain",      icon: "◈", color: "#2563eb" },
    { label: "Storage Used",      value: fmtBytes(snap?.totalStorageBytes),sub: snap ? `${snap.totalStorageGiB.toFixed(2)} GiB binary` : undefined, icon: "▣", color: "#059669" },
    { label: "Blob Events",       value: fmtFull(snap?.totalBlobEvents),  sub: "blob_activities count",      icon: "↯", color: "#9333ea" },
    { label: "Storage Providers", value: fmtFull(snap?.storageProviders), sub: "Active SPs on-chain",        icon: "◎", color: "#0891b2" },
    { label: "Placement Groups",  value: fmtFull(snap?.placementGroups),  sub: "Erasure code groups",        icon: "▦", color: "#d97706" },
    { label: "Slices",            value: fmtFull(snap?.slices),           sub: "Slice registry count",       icon: "⬡", color: "#7c3aed" },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#111827", margin: 0, letterSpacing: -0.8 }}>Network Dashboard</h1>
          <p style={{ fontSize: 14, color: "#9ca3af", margin: "5px 0 0" }}>
            Shelbynet · Live metrics · Poll every {POLL_MS / 1000}s ·{" "}
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4,
              background: snap?.method?.includes("shelby") ? "#f0fdf4" : "#fffbeb",
              color: snap?.method?.includes("shelby") ? "#16a34a" : "#d97706",
            }}>
              {snap?.method ?? "loading"}
            </span>
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "#d1d5db" : "#22c55e", boxShadow: loading ? "none" : "0 0 6px #22c55e", display: "inline-block" }} />
            {loading ? "Syncing…" : lastAt?.toLocaleTimeString() ?? "Live"}
          </div>
          <button onClick={fetchStats} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 12, color: "#6b7280", cursor: "pointer" }}>
            ⟳ Refresh
          </button>
        </div>
      </div>

      {error && !snap && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          ⚠ {error}
        </div>
      )}

      {/* Block + Blob Breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 22 }}>
        {/* Block height */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 10 }}>Block Height</div>
          <div style={{ fontFamily: "monospace", fontSize: 34, fontWeight: 800, color: "#2563eb", fontVariantNumeric: "tabular-nums" }}>
            {snap ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—"}
          </div>
          <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 5 }}>Ledger v{snap ? snap.ledgerVersion.toLocaleString("en-US") : "—"}</div>
        </div>

        {/* Blob Breakdown */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 14 }}>Blob Breakdown</div>
          {snap ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Active",  v: snap.activeBlobs,     color: "#22c55e" },
                { label: "Pending", v: snap.pendingOrFailed, color: "#f59e0b" },
                { label: "Deleted", v: snap.deletedBlobs,    color: "#ef4444" },
                { label: "Empty",   v: snap.emptyRecords,    color: "#9ca3af" },
              ].map(({ label, v, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "#6b7280" }}>{label}</span>
                  </div>
                  {/* Số đầy đủ — fix #4 */}
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#374151", fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
                    {v?.toLocaleString("en-US") ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#d1d5db", fontSize: 14 }}>Loading…</div>
          )}
        </div>
      </div>

      {/* Metrics grid — 3 cols */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 26 }}>
        {METRICS.map(m => <StatCard key={m.label} loading={loading} {...m} />)}
      </div>

      {/* Live charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          { title: "Active Blobs",  sub: `${POLL_MS/1000}s poll`,       value: fmtFull(snap?.activeBlobs),    data: series.map(p => p.activeBlobs ?? 0).filter(Boolean),        color: "#2563eb" },
          { title: "Block Height",  sub: "Chain progress",               value: snap ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—", data: series.map(p => p.blockHeight).filter(Boolean), color: "#059669" },
          { title: "Storage Used",  sub: "Shelby Indexer bytes",         value: fmtBytes(snap?.totalStorageBytes), data: series.map(p => p.totalStorageBytes ?? 0).filter(Boolean), color: "#9333ea" },
          { title: "Blob Events",   sub: "blob_activities count",        value: fmtFull(snap?.totalBlobEvents), data: series.map(p => p.totalBlobEvents ?? 0).filter(Boolean),    color: "#d97706" },
        ].map(({ title, sub, value, data, color }) => (
          <div key={title} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "18px 22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{title}</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>{sub}</div>
              </div>
              {snap && <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color }}>{value}</div>}
            </div>
            <SparkLine data={data} color={color} height={120} />
            {series.length > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#d1d5db", fontFamily: "monospace", marginTop: 5 }}>
                <span>{timeLabel(series[0].ts)}</span>
                <span>{timeLabel(series[series.length - 1].ts)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Data source info */}
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 18px", fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>
        Source: Shelby Dedicated Indexer (blobs_aggregate · blob_activities_aggregate) · On-chain: Aptos RPC resource reads
      </div>
    </div>
  );
}