"use client";
/**
 * app/analytics/page.tsx — v14.0
 *
 * CHANGES v14.0:
 * - totalBlobs (is_written=1, kể cả deleted) → hiển thị là "Total Blobs" — match Explorer
 * - activeBlobs (is_written=1, is_deleted=0) → hiển thị là "Active Blobs" — blobs đang stored
 * - totalStorageBytes → "Storage Used" (match Explorer)
 * - activeStorageBytes → "Active Storage" (blobs chưa xóa)
 * - Blob Breakdown dùng totalBlobs làm base
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";

interface LiveSnap {
  ts: string; tsMs: number; network?: string;
  // Explorer-aligned
  totalBlobs: number;
  totalStorageBytes: number; totalStorageGB: number; totalStorageGiB: number;
  totalBlobEvents: number;
  // Breakdown
  activeBlobs: number;
  activeStorageBytes?: number; activeStorageGB?: number;
  pendingBlobs: number; pendingOrFailed: number;
  deletedBlobs: number; failedBlobs: number; emptyRecords: number;
  // On-chain
  storageProviders: number; placementGroups: number; slices: number;
  blockHeight: number; ledgerVersion: number;
  // Testnet extras
  waitlistedProviders?: number; chainId?: number; indexerStatus?: string;
  method: string;
}

interface LivePoint {
  ts: number;
  totalBlobs:        number | null;
  totalStorageBytes: number | null;
  totalBlobEvents:   number | null;
  blockHeight:       number;
  storageProviders:  number | null;
}

const MAX_POINTS = 60;
const POLL_MS    = 30_000;

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}
function fmtBytes(b: number | null | undefined): string {
  if (b == null || b === 0) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// Merge: prefer non-zero values from same network
function mergeSnap(prev: LiveSnap | null, next: LiveSnap): LiveSnap {
  if (!prev) return next;
  if (next.totalBlobs > 0 || next.blockHeight > 0) return next;
  return { ...next, totalBlobs: prev.totalBlobs || next.totalBlobs, totalStorageBytes: prev.totalStorageBytes || next.totalStorageBytes, totalBlobEvents: prev.totalBlobEvents || next.totalBlobEvents, activeBlobs: prev.activeBlobs || next.activeBlobs };
}

function SparkLine({ data, color, height = 110 }: { data: number[]; color: string; height?: number }) {
  const valid = data.filter(v => v > 0);
  if (valid.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>Collecting data…</div>
  );
  const W = 560, pad = { t: 8, b: 8, l: 44, r: 8 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...valid), max = Math.max(...valid), range = max - min || 1;
  const xs  = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys  = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t + iH} ${line} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gId  = `spk_${color.replace(/[^a-z0-9]/gi, "")}`;
  const fmtV = (v: number) => v >= 1e9 ? `${(v/1e9).toFixed(1)}G` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
      <defs><linearGradient id={gId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.18}/><stop offset="100%" stopColor={color} stopOpacity={0.01}/></linearGradient></defs>
      {[0, 0.5, 1].map(f => { const y = pad.t + iH - f * iH; return <g key={f}><line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke="var(--border)"/><text x={pad.l-4} y={y+3} textAnchor="end" fontSize={9} fill="var(--text-dim)">{fmtV(min+f*range)}</text></g>; })}
      <polygon points={area} fill={`url(#${gId})`}/>
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"/>
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={4} fill={color} stroke="var(--bg-card)" strokeWidth={2}/>
    </svg>
  );
}

function StatCard({ label, value, sub, icon, color, loading }: {
  label: string; value: string; sub?: string; icon: string; color: string; loading: boolean;
}) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px", borderTop: `3px solid ${color}`, transition: "background 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 15, opacity: 0.4 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 27, fontWeight: 800, color: loading ? "var(--text-dim)" : "var(--text-primary)", letterSpacing: -0.8, lineHeight: 1.1, fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
        {loading ? "…" : value}
      </div>
      {sub != null && sub !== "" && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function ChartCard({ title, sub, latest, latestColor, data, color }: {
  title: string; sub: string; latest: string; latestColor: string; data: number[]; color: string;
}) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{title}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: latestColor }}>{latest}</div>
      </div>
      <SparkLine data={data} color={color} height={110} />
    </div>
  );
}

export default function AnalyticsPage() {
  const { network } = useNetwork();
  const isTestnet   = network === "testnet";
  const accentColor = isTestnet ? "#9333ea" : "#2563eb";
  const alive       = useRef(true);
  const snapNetworkRef = useRef<string>("");

  const [snap,      setSnap]      = useState<LiveSnap | null>(null);
  const [series,    setSeries]    = useState<LivePoint[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastAtStr, setLastAtStr] = useState<string>("");
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (alive.current) {
      setSnap(null); setSeries([]); setError(null); setLoading(true);
      snapNetworkRef.current = network;
    }
  }, [network]);

  const applyData = useCallback((data: LiveSnap, forNetwork: string) => {
    if (!alive.current || snapNetworkRef.current !== forNetwork) return;
    setSnap(prev => mergeSnap(prev, data));
    setLastAtStr(new Date().toLocaleTimeString());
    setSeries(prev => {
      const pt: LivePoint = {
        ts:                Date.now(),
        totalBlobs:        data.totalBlobs        || null,
        totalStorageBytes: data.totalStorageBytes || null,
        totalBlobEvents:   data.totalBlobEvents   || null,
        blockHeight:       data.blockHeight       || 0,
        storageProviders:  data.storageProviders  || null,
      };
      const next = [...prev, pt];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
  }, []);

  const seedFromTimeseries = useCallback(async (forNetwork: string): Promise<LiveSnap | null> => {
    try {
      const j = await fetch(`/api/network/stats/timeseries?network=${forNetwork}&resolution=5m&range=24h`, { signal: AbortSignal.timeout(10_000) });
      if (!j.ok) return null;
      const d = await j.json() as any;
      const seriesArr = d?.data?.series as any[];
      if (!Array.isArray(seriesArr) || seriesArr.length === 0) return null;
      const latest = seriesArr[seriesArr.length - 1];
      if (!latest || (!latest.totalBlobs && !latest.activeBlobs)) return null;
      return {
        ts: latest.ts ?? new Date().toISOString(), tsMs: latest.tsMs ?? Date.now(), network: forNetwork,
        totalBlobs:        Number(latest.totalBlobs        ?? latest.activeBlobs ?? 0),
        totalStorageBytes: Number(latest.totalStorageBytes ?? 0) || Number(latest.totalStorageGB ?? 0) * 1e9,
        totalStorageGB:    Number(latest.totalStorageGB    ?? 0),
        totalStorageGiB:   Number(latest.totalStorageGiB   ?? 0),
        totalBlobEvents:   Number(latest.totalBlobEvents   ?? 0),
        activeBlobs:       Number(latest.activeBlobs       ?? 0),
        pendingBlobs:      Number(latest.pendingBlobs      ?? 0),
        pendingOrFailed:   Number(latest.pendingOrFailed   ?? 0),
        deletedBlobs:      Number(latest.deletedBlobs      ?? 0),
        failedBlobs:       Number(latest.failedBlobs       ?? 0),
        emptyRecords:      Number(latest.emptyRecords      ?? 0),
        storageProviders:  Number(latest.storageProviders  ?? 0),
        placementGroups:   Number(latest.placementGroups   ?? 0),
        slices:            Number(latest.slices             ?? 0),
        blockHeight:       Number(latest.blockHeight       ?? 0),
        ledgerVersion:     Number(latest.ledgerVersion     ?? 0),
        method: "ts-seeded",
      } as LiveSnap;
    } catch { return null; }
  }, []);

  const fetchStats = useCallback(async () => {
    const forNetwork = network;

    try {
      const res = await fetch(`/api/network/stats/live?network=${forNetwork}`, { signal: AbortSignal.timeout(18_000) });
      if (res.ok) {
        const j    = await res.json() as any;
        const data = j.data ?? j;
        if (data && (data.blockHeight != null || data.storageProviders != null || data.totalBlobs != null)) {
          if (alive.current) setError(null);
          applyData(data as LiveSnap, forNetwork);
          if (alive.current) setLoading(false);
          // Nếu totalBlobs = 0 (node-only fallback), thử timeseries
          if ((data.totalBlobs ?? 0) === 0 && !isTestnet) {
            const tsSnap = await seedFromTimeseries(forNetwork);
            if (tsSnap) applyData(tsSnap, forNetwork);
          }
          return;
        }
      }
    } catch { /* fall through */ }

    // Fallback: /stats cached
    try {
      const r2 = await fetch(`/api/network/stats?network=${forNetwork}`, { signal: AbortSignal.timeout(12_000) });
      if (r2.ok) {
        const j2 = await r2.json() as any;
        const d2 = j2.data ?? {};
        const s  = d2.stats ?? {};
        const nd = d2.node  ?? {};
        if (nd.blockHeight || s.totalBlobs || s.activeBlobs) {
          const fb: LiveSnap = {
            ts: new Date().toISOString(), tsMs: Date.now(), network: forNetwork,
            totalBlobs:        Number(s.totalBlobs        ?? s.activeBlobs ?? 0),
            totalStorageBytes: Number(s.totalStorageUsedBytes ?? 0),
            totalStorageGB:    Number(s.totalStorageGB    ?? 0) || Number(s.totalStorageUsedBytes ?? 0) / 1e9,
            totalStorageGiB:   Number(s.totalStorageGiB   ?? 0),
            totalBlobEvents:   Number(s.totalBlobEvents   ?? 0),
            activeBlobs:       Number(s.activeBlobs       ?? 0),
            pendingBlobs:      Number(s.pendingBlobs      ?? 0),
            pendingOrFailed:   Number(s.pendingOrFailed   ?? s.pendingBlobs ?? 0),
            deletedBlobs:      Number(s.deletedBlobs      ?? 0),
            failedBlobs:       Number(s.failedBlobs       ?? 0),
            emptyRecords:      Number(s.emptyRecords      ?? 0),
            storageProviders:  Number(s.storageProviders  ?? 0),
            waitlistedProviders: Number(s.waitlistedProviders ?? 0),
            placementGroups:   Number(s.placementGroups   ?? 0),
            slices:            Number(s.slices             ?? 0),
            blockHeight:       Number(nd.blockHeight      ?? 0),
            ledgerVersion:     Number(nd.ledgerVersion    ?? 0),
            chainId:           Number(nd.chainId          ?? 2),
            method:            String(d2.statsSource ?? s.statsMethod ?? "cached"),
          };
          applyData(fb, forNetwork);
          if (alive.current) setLoading(false);
          if (fb.totalBlobs === 0 && !isTestnet) {
            const tsSnap = await seedFromTimeseries(forNetwork);
            if (tsSnap) applyData(tsSnap, forNetwork);
          }
          return;
        }
      }
    } catch { /* ignore */ }

    // Timeseries seed
    if (!isTestnet) {
      const tsSnap = await seedFromTimeseries(forNetwork);
      if (tsSnap) {
        applyData(tsSnap, forNetwork);
        if (alive.current) { setError("Live sync unavailable — using cached data"); setLoading(false); }
        return;
      }
    }

    if (alive.current) { setError("Backend temporarily unavailable — retrying"); setLoading(false); }
  }, [network, isTestnet, applyData, seedFromTimeseries]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  const hasData = snap !== null && (snap.blockHeight > 0 || snap.totalBlobs > 0 || snap.storageProviders > 0);
  const showError = error && !hasData;

  // === Metric cards (6 cards) ===
  // Unified layout cho cả 2 networks, chỉ khác label/sub
  const METRICS = [
    {
      label: "Total Blobs",
      value: fmt(snap?.totalBlobs),
      sub:   isTestnet ? "is_written=1 (Indexer)" : "is_written=1 (matches Explorer)",
      icon:  "◈",
      color: isTestnet ? "#0891b2" : "#2563eb",
    },
    {
      label: "Storage Used",
      value: fmtBytes(snap?.totalStorageBytes),
      sub:   snap?.totalStorageGiB ? `${Number(snap.totalStorageGiB).toFixed(2)} GiB` : isTestnet ? "From Indexer" : "",
      icon:  "▣",
      color: "#059669",
    },
    {
      label: "Active Blobs",
      value: fmt(snap?.activeBlobs),
      sub:   "is_written=1, is_deleted=0",
      icon:  "◎",
      color: "#22c55e",
    },
    {
      label: "Storage Providers",
      value: fmt(snap?.storageProviders),
      sub:   isTestnet ? `+${snap?.waitlistedProviders ?? 0} waitlisted` : "Active SPs on-chain",
      icon:  "◎",
      color: "#0891b2",
    },
    {
      label: "Placement Groups",
      value: fmt(snap?.placementGroups),
      sub:   isTestnet ? "Epoch registry" : "Erasure code groups",
      icon:  "▦",
      color: "#d97706",
    },
    {
      label: "Slices",
      value: fmt(snap?.slices),
      sub:   "Slice registry count",
      icon:  "⬡",
      color: "#7c3aed",
    },
  ];

  // === Sparkline charts (4 charts) ===
  const CHARTS = [
    {
      title: "Total Blobs",
      sub:   isTestnet ? "is_written=1 (all ever)" : "is_written=1 — matches Explorer",
      latest: fmt(snap?.totalBlobs),
      data:  series.map(p => p.totalBlobs ?? 0).filter(Boolean),
      color: isTestnet ? "#0891b2" : "#2563eb",
    },
    {
      title: "Block Height",
      sub:   "Chain progress",
      latest: snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—",
      data:  series.map(p => p.blockHeight).filter(v => v > 0),
      color: isTestnet ? accentColor : "#059669",
    },
    {
      title: "Storage Used",
      sub:   isTestnet ? "is_written=1 total" : "sum{size} where is_written=1",
      latest: fmtBytes(snap?.totalStorageBytes),
      data:  series.map(p => p.totalStorageBytes ?? 0).filter(Boolean),
      color: "#9333ea",
    },
    {
      title: "Blob Events",
      sub:   "blob_activities count",
      latest: fmt(snap?.totalBlobEvents),
      data:  series.map(p => p.totalBlobEvents ?? 0).filter(Boolean),
      color: "#d97706",
    },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 4px" }}>
      <style>{`@media(max-width:768px){.ag2{grid-template-columns:1fr!important}.ag3{grid-template-columns:1fr 1fr!important}.ag4{grid-template-columns:1fr!important}}@media(max-width:480px){.ag3{grid-template-columns:1fr!important}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.8 }}>
            {isTestnet ? "Testnet Dashboard" : "Network Dashboard"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "5px 0 0", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {isTestnet ? "Shelby Testnet · Aptos Testnet RPC" : "Shelbynet"} · Poll every {POLL_MS/1000}s
            {snap?.method && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>
                {snap.method}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "var(--text-dim)" : "#22c55e", boxShadow: !loading ? "0 0 6px #22c55e" : "none", display: "inline-block" }} />
            {loading ? "Syncing…" : (lastAtStr || "Live")}
          </div>
          <button onClick={fetchStats} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>⟳ Refresh</button>
        </div>
      </div>

      {isTestnet && (
        <div style={{ background: "rgba(147,51,234,0.07)", border: "1px solid rgba(147,51,234,0.25)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#c084fc", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚗</span><span>Shelby Testnet · Contract: 0x85fdb9a1… · Chain ID: {snap?.chainId ?? 2}</span>
        </div>
      )}

      {showError && (
        <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#d97706", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚠</span><span>{error}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>Retrying every {POLL_MS/1000}s</span>
        </div>
      )}

      {/* Block + Breakdown */}
      <div className="ag2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8 }}>Block Height</div>
          <div style={{ fontFamily: "monospace", fontSize: 30, fontWeight: 800, color: accentColor, fontVariantNumeric: "tabular-nums", wordBreak: "break-all" }}>
            {snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : loading ? "…" : "—"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5 }}>
            Ledger v{snap?.ledgerVersion ? snap.ledgerVersion.toLocaleString("en-US") : "—"}
            {isTestnet && snap?.chainId != null && <span style={{ marginLeft: 10, color: "var(--text-dim)" }}>Chain ID: {snap.chainId}</span>}
          </div>
        </div>

        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 12 }}>
            Blob Breakdown
          </div>
          {!snap ? (
            <div style={{ color: "var(--text-dim)", fontSize: 14 }}>{loading ? "Loading…" : "No data"}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { label: "Active",   v: snap.activeBlobs,   color: "#22c55e", hint: "is_written=1, is_deleted=0" },
                { label: "Pending",  v: snap.pendingBlobs,  color: "#f59e0b", hint: "is_written=0, is_deleted=0" },
                { label: "Deleted",  v: snap.deletedBlobs,  color: "#ef4444", hint: "is_deleted=1" },
                { label: "Empty",    v: snap.emptyRecords,  color: "#9ca3af", hint: "size=0" },
              ].map(({ label, v, color, hint }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }} title={hint}>{label}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</span>
                </div>
              ))}
              <div style={{ marginTop: 4, paddingTop: 6, borderTop: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Total (is_written=1)</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: accentColor, fontFamily: "monospace" }}>{fmt(snap.totalBlobs)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 6 stat cards */}
      <div className="ag3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 22 }}>
        {METRICS.map(m => <StatCard key={m.label} loading={loading && !snap} {...m} />)}
      </div>

      {/* 4 sparkline charts */}
      <div className="ag4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 22 }}>
        {CHARTS.map(c => (
          <ChartCard key={c.title} title={c.title} sub={c.sub} latest={c.latest} latestColor={c.color} data={c.data} color={c.color} />
        ))}
      </div>

      {series.length > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace", marginBottom: 8, padding: "0 2px" }}>
          <span>{fmtTime(series[0].ts)}</span><span>{fmtTime(series[series.length - 1].ts)}</span>
        </div>
      )}

      <div style={{ background: "var(--bg-card2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "monospace" }}>
        {isTestnet
          ? "Source: Aptos Testnet REST API + Indexer · Total Blobs = is_written=1 (matches Explorer)"
          : "Source: Shelby Dedicated Indexer · Total Blobs = is_written=1 (matches shelby.xyz Explorer)"}
      </div>
    </div>
  );
}