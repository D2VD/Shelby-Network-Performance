"use client";
/**
 * app/analytics/page.tsx — v12.0
 * FIXES:
 * 1. CRITICAL: Reset snap to null on network change — prevents cross-network contamination
 *    (switching testnet→shelbynet was keeping testnet block height 711M on shelbynet)
 * 2. mergeSnap only preserves values WITHIN the same network fetch cycle
 * 3. Handles node-only-fallback gracefully: if new data has 0 blobs but prev has real data, keep prev
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";

interface LiveSnap {
  ts: string; tsMs: number; network?: string;
  activeBlobs: number; pendingOrFailed: number; deletedBlobs: number; emptyRecords: number;
  totalBlobEvents: number; totalStorageBytes: number; totalStorageGB: number; totalStorageGiB: number;
  storageProviders: number; placementGroups: number; slices: number;
  blockHeight: number; ledgerVersion: number; method: string;
  waitlistedProviders?: number; chainId?: number; indexerStatus?: string;
}

interface LivePoint {
  ts: number; activeBlobs: number | null; totalStorageBytes: number | null;
  totalBlobEvents: number | null; blockHeight: number;
  storageProviders: number | null; placementGroups: number | null;
}

const MAX_POINTS = 60;
const POLL_MS    = 30_000;

function fmt(n: number | null | undefined, fallback = "0"): string {
  if (n == null) return fallback;
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

// FIX: mergeSnap only preserves values if new data has non-meaningful zeros
// (i.e., from node-only-fallback) — uses || which treats 0 as falsy
function mergeSnap(prev: LiveSnap | null, next: LiveSnap): LiveSnap {
  if (!prev) return next;
  // Only preserve if blobs are 0 in next (node-only-fallback case)
  const isFallback = next.activeBlobs === 0 && prev.activeBlobs > 0;
  if (!isFallback) return next; // new data is real — use it as-is
  return {
    ...next,
    // Preserve blob data from previous successful fetch
    activeBlobs:       prev.activeBlobs,
    totalBlobEvents:   prev.totalBlobEvents,
    totalStorageBytes: prev.totalStorageBytes,
    totalStorageGB:    prev.totalStorageGB,
    totalStorageGiB:   prev.totalStorageGiB,
    pendingOrFailed:   prev.pendingOrFailed,
    deletedBlobs:      prev.deletedBlobs,
    emptyRecords:      prev.emptyRecords,
    // Always use new values for: blockHeight, SPs, PGs, slices (come from node, not indexer)
  };
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
  // FIX: Track which network the current snap belongs to
  const snapNetworkRef = useRef<string>("");

  const [snap,      setSnap]      = useState<LiveSnap | null>(null);
  const [series,    setSeries]    = useState<LivePoint[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastAtStr, setLastAtStr] = useState<string>("");
  const [error,     setError]     = useState<string | null>(null);
  const [isStale,   setIsStale]   = useState(false);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // FIX: Reset snap when network changes — prevents cross-network contamination
  useEffect(() => {
    if (alive.current) {
      setSnap(null);        // CRITICAL: clear previous network's data
      setSeries([]);
      setError(null);
      setIsStale(false);
      setLoading(true);
      snapNetworkRef.current = network;
    }
  }, [network]);

  const applyData = useCallback((data: LiveSnap, forNetwork: string) => {
    if (!alive.current) return;
    // FIX: Ignore data that arrived for a different network (race condition)
    if (snapNetworkRef.current !== forNetwork) {
      console.log(`[analytics] Ignoring stale response for ${forNetwork}, current network: ${snapNetworkRef.current}`);
      return;
    }
    setSnap(prev => mergeSnap(prev, data));
    setLastAtStr(new Date().toLocaleTimeString());
    setSeries(prev => {
      const pt: LivePoint = {
        ts:                Date.now(),
        activeBlobs:       data.activeBlobs       || null,
        totalStorageBytes: data.totalStorageBytes || null,
        totalBlobEvents:   data.totalBlobEvents   || null,
        blockHeight:       data.blockHeight       || 0,
        storageProviders:  data.storageProviders  || null,
        placementGroups:   data.placementGroups   || null,
      };
      const next = [...prev, pt];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
  }, []);

  const fetchStats = useCallback(async () => {
    const forNetwork = network; // capture at time of call

    // 1. Try live endpoint
    try {
      const res = await fetch(`/api/network/stats/live?network=${forNetwork}`, { signal: AbortSignal.timeout(18_000) });
      if (res.status !== 404 && res.status !== 503) {
        const j    = await res.json() as any;
        const data = j.data ?? j;
        if (data && (data.blockHeight != null || data.storageProviders != null)) {
          const method = String(data.method ?? "");
          const isNodeFallback = method.includes("node-only") || method.includes("fallback");
          if (alive.current) {
            setIsStale(method.includes("stale") || method.includes("cache") || isNodeFallback);
            setError(isNodeFallback ? "Indexer temporarily unavailable — showing cached blob data" : null);
          }
          applyData(data as LiveSnap, forNetwork);
          if (alive.current) setLoading(false);
          return;
        }
      }
    } catch { /* fall through */ }

    // 2. Fallback: cached /stats
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
            activeBlobs:         Number(s.totalBlobs ?? s.activeBlobs ?? 0),
            totalBlobEvents:     Number(s.totalBlobEvents ?? 0),
            totalStorageBytes:   Number(s.totalStorageUsedBytes ?? 0),
            totalStorageGB:      Number(s.totalStorageUsedBytes ?? 0) / 1e9,
            totalStorageGiB:     Number(s.totalStorageUsedBytes ?? 0) / (1024 ** 3),
            storageProviders:    Number(s.storageProviders ?? 0),
            waitlistedProviders: Number(s.waitlistedProviders ?? 0),
            placementGroups:     Number(s.placementGroups ?? 0),
            slices:              Number(s.slices ?? 0),
            blockHeight:         Number(nd.blockHeight ?? 0),
            ledgerVersion:       Number(nd.ledgerVersion ?? 0),
            chainId:             Number(nd.chainId ?? 2),
            pendingOrFailed:     Number(s.pendingOrFailed ?? s.pendingBlobs ?? 0),
            deletedBlobs:        Number(s.deletedBlobs ?? 0),
            emptyRecords:        Number(s.emptyRecords ?? 0),
            method:              String(d2.statsSource ?? s.statsMethod ?? "cached"),
          };
          if (alive.current) { setIsStale(true); setError("Live data temporarily unavailable — showing cached data"); }
          applyData(fb, forNetwork);
          if (alive.current) setLoading(false);
          return;
        }
      }
    } catch { /* ignore */ }

    if (alive.current) { setError("Backend temporarily unavailable — retrying"); setLoading(false); }
  }, [network, applyData]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  // Metrics — same 6 cards for both networks
  const METRICS = isTestnet ? [
    { label: "Active Blobs",      value: fmt(snap?.activeBlobs),          sub: "From Indexer (best-effort)",  icon: "◈", color: "#0891b2" },
    { label: "Storage Providers", value: fmt(snap?.storageProviders),     sub: "Active on testnet",           icon: "◎", color: "#22c55e" },
    { label: "Waitlisted SPs",    value: fmt(snap?.waitlistedProviders),  sub: "Awaiting activation",         icon: "◎", color: "#f59e0b" },
    { label: "Placement Groups",  value: fmt(snap?.placementGroups),      sub: "Epoch registry",              icon: "▦", color: "#d97706" },
    { label: "Slices",            value: fmt(snap?.slices),               sub: "Slice registry count",        icon: "⬡", color: "#7c3aed" },
    { label: "Block Height",      value: snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—", sub: `Ledger v${fmt(snap?.ledgerVersion)}`, icon: "⬡", color: accentColor },
  ] : [
    { label: "Active Blobs",      value: fmt(snap?.activeBlobs),          sub: "Files stored on-chain",       icon: "◈", color: "#2563eb" },
    { label: "Storage Used",      value: fmtBytes(snap?.totalStorageBytes), sub: snap?.totalStorageGiB ? `${Number(snap.totalStorageGiB).toFixed(2)} GiB` : "", icon: "▣", color: "#059669" },
    { label: "Blob Events",       value: fmt(snap?.totalBlobEvents),      sub: "blob_activities count",       icon: "↯", color: "#9333ea" },
    { label: "Storage Providers", value: fmt(snap?.storageProviders),     sub: "Active SPs on-chain",         icon: "◎", color: "#0891b2" },
    { label: "Placement Groups",  value: fmt(snap?.placementGroups),      sub: "Erasure code groups",         icon: "▦", color: "#d97706" },
    { label: "Slices",            value: fmt(snap?.slices),               sub: "Slice registry count",        icon: "⬡", color: "#7c3aed" },
  ];

  const CHARTS = isTestnet ? [
    { title: "Block Height",      sub: "Chain progress",       latest: snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—", data: series.map(p => p.blockHeight ?? 0).filter(v => v > 0), color: accentColor },
    { title: "Active Blobs",      sub: "Indexer (txn count)",  latest: fmt(snap?.activeBlobs), data: series.map(p => p.activeBlobs ?? 0), color: "#0891b2" },
    { title: "Storage Providers", sub: "Active on testnet",    latest: fmt(snap?.storageProviders), data: series.map(p => p.storageProviders ?? 0), color: "#22c55e" },
    { title: "Placement Groups",  sub: "Epoch registry",       latest: fmt(snap?.placementGroups), data: series.map(p => p.placementGroups ?? 0), color: "#d97706" },
  ] : [
    { title: "Active Blobs",      sub: `${POLL_MS/1000}s poll`, latest: fmt(snap?.activeBlobs), data: series.map(p => p.activeBlobs ?? 0).filter(Boolean), color: "#2563eb" },
    { title: "Block Height",      sub: "Chain progress",        latest: snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—", data: series.map(p => p.blockHeight).filter(v => v > 0), color: "#059669" },
    { title: "Storage Used",      sub: "Shelby Indexer bytes",  latest: fmtBytes(snap?.totalStorageBytes), data: series.map(p => p.totalStorageBytes ?? 0).filter(Boolean), color: "#9333ea" },
    { title: "Blob Events",       sub: "blob_activities count", latest: fmt(snap?.totalBlobEvents), data: series.map(p => p.totalBlobEvents ?? 0).filter(Boolean), color: "#d97706" },
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
              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: isStale ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.12)", color: isStale ? "#d97706" : "#16a34a" }}>
                {snap.method}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "var(--text-dim)" : error ? "#f59e0b" : "#22c55e", boxShadow: !loading && !error ? "0 0 6px #22c55e" : "none", display: "inline-block" }} />
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

      {error && (
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
            {isTestnet ? "Network Status" : "Blob Breakdown"}
          </div>
          {!snap ? (
            <div style={{ color: "var(--text-dim)", fontSize: 14 }}>{loading ? "Loading…" : "No data"}</div>
          ) : isTestnet ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { label: "Active SPs",       v: snap.storageProviders,    color: "#22c55e" },
                { label: "Waitlisted SPs",   v: snap.waitlistedProviders, color: "#f59e0b" },
                { label: "Placement Groups", v: snap.placementGroups,     color: "#9333ea" },
                { label: "Slices",           v: snap.slices,              color: "#06b6d4" },
              ].map(({ label, v, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} /><span style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</span></div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace" }}>{fmt(v)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { label: "Active",  v: snap.activeBlobs,     color: "#22c55e" },
                { label: "Pending", v: snap.pendingOrFailed, color: "#f59e0b" },
                { label: "Deleted", v: snap.deletedBlobs,    color: "#ef4444" },
                { label: "Empty",   v: snap.emptyRecords,    color: "#9ca3af" },
              ].map(({ label, v, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} /><span style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</span></div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</span>
                </div>
              ))}
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
        {CHARTS.map(c => <ChartCard key={c.title} title={c.title} sub={c.sub} latest={c.latest} latestColor={c.color} data={c.data} color={c.color} />)}
      </div>

      {series.length > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace", marginBottom: 8, padding: "0 2px" }}>
          <span>{fmtTime(series[0].ts)}</span><span>{fmtTime(series[series.length - 1].ts)}</span>
        </div>
      )}

      <div style={{ background: "var(--bg-card2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "monospace" }}>
        {isTestnet
          ? "Source: Aptos Testnet REST API · storage_provider_registry · placement_group_registry · slice_registry · account_transactions (V3 Indexer)"
          : "Source: Shelby Dedicated Indexer (blobs_aggregate · blob_activities_aggregate) · On-chain: Aptos RPC resource reads"}
      </div>
    </div>
  );
}