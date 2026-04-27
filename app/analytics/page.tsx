"use client";
// app/analytics/page.tsx — v15.0 (Phase 2 Step 3)
//
// CHANGES v15.0:
//   - Toàn bộ layout dùng Tailwind classes thay inline styles
//   - StatCard dùng component mới từ @/components/ui với delta support
//   - BlobBreakdownBar mới: animated, với tooltip hint
//   - SectionHeader, DataGrid, LiveIndicator, MethodBadge từ ui.tsx
//   - Sparkline charts giữ nguyên (custom SVG, không đổi)
//   - Logic fetch data KHÔNG thay đổi

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import {
  StatCard, SectionHeader, DataGrid, LiveIndicator,
  MethodBadge, BlobBreakdownBar, RefreshButton, ErrorBanner,
  NetworkBadge, EmptyState,
} from "@/components/ui";

// ── Types (giữ nguyên từ v14) ─────────────────────────────────────────────────
interface LiveSnap {
  ts: string; tsMs: number; network?: string;
  totalBlobs: number; totalStorageBytes: number;
  totalStorageGB: number; totalStorageGiB: number;
  totalBlobEvents: number;
  activeBlobs: number; activeStorageBytes?: number; activeStorageGB?: number;
  pendingBlobs: number; pendingOrFailed: number;
  deletedBlobs: number; failedBlobs: number; emptyRecords: number;
  storageProviders: number; placementGroups: number; slices: number;
  blockHeight: number; ledgerVersion: number;
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

// ── Formatters ─────────────────────────────────────────────────────────────────
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

// ── Sparkline (custom SVG — giữ nguyên) ──────────────────────────────────────
function SparkLine({ data, color, height = 110 }: { data: number[]; color: string; height?: number }) {
  const valid = data.filter(v => v > 0);
  if (valid.length < 2) return (
    <div className="flex items-center justify-center text-xs text-[var(--text-dim)]" style={{ height }}>
      Collecting data…
    </div>
  );
  const W = 560, pad = { t: 8, b: 8, l: 44, r: 8 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...valid), max = Math.max(...valid), range = max - min || 1;
  const xs  = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys  = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t + iH} ${line} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gId  = `spk_${color.replace(/[^a-z0-9]/gi, "")}`;
  const fmtV = (v: number) =>
    v >= 1e9 ? `${(v/1e9).toFixed(1)}G` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` :
    v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.18}/>
          <stop offset="100%" stopColor={color} stopOpacity={0.01}/>
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => {
        const y = pad.t + iH - f * iH;
        return (
          <g key={f}>
            <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke="var(--border)"/>
            <text x={pad.l-4} y={y+3} textAnchor="end" fontSize={9} fill="var(--text-dim)">{fmtV(min+f*range)}</text>
          </g>
        );
      })}
      <polygon points={area} fill={`url(#${gId})`}/>
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"/>
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={4} fill={color} stroke="var(--bg-card)" strokeWidth={2}/>
    </svg>
  );
}

// ── Chart Card wrapper ────────────────────────────────────────────────────────
function ChartCard({ title, sub, latest, latestColor, data, color }: {
  title: string; sub: string; latest: string; latestColor: string;
  data: number[]; color: string;
}) {
  return (
    <div className="rounded-xl border bg-[var(--bg-card)] p-4 md:p-5 transition-colors duration-200">
      <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
        <div>
          <div className="text-sm font-bold text-[var(--text-primary)]">{title}</div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</div>
        </div>
        <div className="font-mono text-base font-bold tabular-nums" style={{ color: latestColor, fontFamily: "var(--font-mono)" }}>
          {latest}
        </div>
      </div>
      <SparkLine data={data} color={color} height={110}/>
    </div>
  );
}

// ── Data merge helper (giữ nguyên từ v14) ─────────────────────────────────────
function mergeSnap(prev: LiveSnap | null, next: LiveSnap): LiveSnap {
  if (!prev) return next;
  if (next.totalBlobs > 0 || next.blockHeight > 0) return next;
  return {
    ...next,
    totalBlobs:        prev.totalBlobs        || next.totalBlobs,
    totalStorageBytes: prev.totalStorageBytes || next.totalStorageBytes,
    totalBlobEvents:   prev.totalBlobEvents   || next.totalBlobEvents,
    activeBlobs:       prev.activeBlobs       || next.activeBlobs,
  };
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { network } = useNetwork();
  const isTestnet   = network === "testnet";
  const accentColor = isTestnet ? "#9333ea" : "#2563eb";
  const alive       = useRef(true);
  const snapNetRef  = useRef<string>("");

  const [snap,      setSnap]      = useState<LiveSnap | null>(null);
  const [series,    setSeries]    = useState<LivePoint[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastAtStr, setLastAtStr] = useState<string>("");
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (alive.current) {
      setSnap(null); setSeries([]); setError(null); setLoading(true);
      snapNetRef.current = network;
    }
  }, [network]);

  const applyData = useCallback((data: LiveSnap, forNetwork: string) => {
    if (!alive.current || snapNetRef.current !== forNetwork) return;
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
      const d   = await j.json() as any;
      const arr = d?.data?.series as any[];
      if (!Array.isArray(arr) || arr.length === 0) return null;
      const latest = arr[arr.length - 1];
      if (!latest || (!latest.totalBlobs && !latest.activeBlobs)) return null;
      return {
        ts: latest.ts ?? new Date().toISOString(), tsMs: latest.tsMs ?? Date.now(), network: forNetwork,
        totalBlobs:        Number(latest.totalBlobs ?? latest.activeBlobs ?? 0),
        totalStorageBytes: Number(latest.totalStorageBytes ?? 0) || Number(latest.totalStorageGB ?? 0) * 1e9,
        totalStorageGB:    Number(latest.totalStorageGB ?? 0),
        totalStorageGiB:   Number(latest.totalStorageGiB ?? 0),
        totalBlobEvents:   Number(latest.totalBlobEvents ?? 0),
        activeBlobs:       Number(latest.activeBlobs ?? 0),
        pendingBlobs:      Number(latest.pendingBlobs ?? 0),
        pendingOrFailed:   Number(latest.pendingOrFailed ?? 0),
        deletedBlobs:      Number(latest.deletedBlobs ?? 0),
        failedBlobs:       Number(latest.failedBlobs ?? 0),
        emptyRecords:      Number(latest.emptyRecords ?? 0),
        storageProviders:  Number(latest.storageProviders ?? 0),
        placementGroups:   Number(latest.placementGroups ?? 0),
        slices:            Number(latest.slices ?? 0),
        blockHeight:       Number(latest.blockHeight ?? 0),
        ledgerVersion:     Number(latest.ledgerVersion ?? 0),
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
          if ((data.totalBlobs ?? 0) === 0 && !isTestnet) {
            const tsSnap = await seedFromTimeseries(forNetwork);
            if (tsSnap) applyData(tsSnap, forNetwork);
          }
          return;
        }
      }
    } catch { /* fall through */ }

    try {
      const r2  = await fetch(`/api/network/stats?network=${forNetwork}`, { signal: AbortSignal.timeout(12_000) });
      if (r2.ok) {
        const j2 = await r2.json() as any;
        const s  = j2.data?.stats ?? {};
        const nd = j2.data?.node  ?? {};
        if (nd.blockHeight || s.totalBlobs || s.activeBlobs) {
          const fb: LiveSnap = {
            ts: new Date().toISOString(), tsMs: Date.now(), network: forNetwork,
            totalBlobs:        Number(s.totalBlobs ?? s.activeBlobs ?? 0),
            totalStorageBytes: Number(s.totalStorageUsedBytes ?? 0),
            totalStorageGB:    Number(s.totalStorageGB ?? 0) || Number(s.totalStorageUsedBytes ?? 0) / 1e9,
            totalStorageGiB:   Number(s.totalStorageGiB ?? 0),
            totalBlobEvents:   Number(s.totalBlobEvents ?? 0),
            activeBlobs:       Number(s.activeBlobs ?? 0),
            pendingBlobs:      Number(s.pendingBlobs ?? 0),
            pendingOrFailed:   Number(s.pendingOrFailed ?? s.pendingBlobs ?? 0),
            deletedBlobs:      Number(s.deletedBlobs ?? 0),
            failedBlobs:       Number(s.failedBlobs ?? 0),
            emptyRecords:      Number(s.emptyRecords ?? 0),
            storageProviders:  Number(s.storageProviders ?? 0),
            waitlistedProviders: Number(s.waitlistedProviders ?? 0),
            placementGroups:   Number(s.placementGroups ?? 0),
            slices:            Number(s.slices ?? 0),
            blockHeight:       Number(nd.blockHeight ?? 0),
            ledgerVersion:     Number(nd.ledgerVersion ?? 0),
            chainId:           Number(nd.chainId ?? 2),
            method:            String(j2.data?.statsSource ?? s.statsMethod ?? "cached"),
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

  // ── Metric cards definition ─────────────────────────────────────────────────
  const METRICS = isTestnet ? [
    { label: "Total Blobs",       value: fmt(snap?.totalBlobs),            sub: "is_written=1",                 accent: "#0891b2", icon: "◈" },
    { label: "Storage Used",      value: fmtBytes(snap?.totalStorageBytes),sub: "From Indexer",                 accent: "#059669", icon: "▣" },
    { label: "Active Blobs",      value: fmt(snap?.activeBlobs),           sub: "is_written=1, is_deleted=0",   accent: "#22c55e", icon: "◎" },
    { label: "Storage Providers", value: fmt(snap?.storageProviders),      sub: `+${snap?.waitlistedProviders ?? 0} waitlisted`, accent: "#0891b2", icon: "◎" },
    { label: "Placement Groups",  value: fmt(snap?.placementGroups),       sub: "Epoch registry",               accent: "#d97706", icon: "▦" },
    { label: "Slices",            value: fmt(snap?.slices),                sub: "Slice registry",               accent: "#7c3aed", icon: "⬡" },
  ] : [
    { label: "Total Blobs",       value: fmt(snap?.totalBlobs),            sub: "is_written=1 — matches Explorer", accent: "#2563eb", icon: "◈", pulse: true },
    { label: "Storage Used",      value: fmtBytes(snap?.totalStorageBytes),sub: snap?.totalStorageGiB ? `${Number(snap.totalStorageGiB).toFixed(2)} GiB` : "", accent: "#059669", icon: "▣" },
    { label: "Active Blobs",      value: fmt(snap?.activeBlobs),           sub: "is_written=1, is_deleted=0",   accent: "#22c55e", icon: "◎" },
    { label: "Storage Providers", value: fmt(snap?.storageProviders),      sub: "Active SPs on-chain",          accent: "#0891b2", icon: "◎" },
    { label: "Placement Groups",  value: fmt(snap?.placementGroups),       sub: "Erasure code groups",          accent: "#d97706", icon: "▦" },
    { label: "Slices",            value: fmt(snap?.slices),                sub: "Slice registry count",         accent: "#7c3aed", icon: "⬡" },
  ];

  const CHARTS = [
    { title: "Total Blobs",   sub: isTestnet ? "is_written=1" : "is_written=1 — matches Explorer", latest: fmt(snap?.totalBlobs),            data: series.map(p => p.totalBlobs ?? 0).filter(Boolean),         color: accentColor },
    { title: "Block Height",  sub: "Chain progress",                                                 latest: snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : "—", data: series.map(p => p.blockHeight).filter(v => v > 0), color: isTestnet ? "#9333ea" : "#059669" },
    { title: "Storage Used",  sub: "sum{size} where active",                                          latest: fmtBytes(snap?.totalStorageBytes), data: series.map(p => p.totalStorageBytes ?? 0).filter(Boolean),  color: "#9333ea" },
    { title: "Blob Events",   sub: "blob_activities count",                                           latest: fmt(snap?.totalBlobEvents),        data: series.map(p => p.totalBlobEvents   ?? 0).filter(Boolean),  color: "#d97706" },
  ];

  return (
    <div className="max-w-[1280px] mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <SectionHeader
        title={isTestnet ? "Testnet Dashboard" : "Network Dashboard"}
        subtitle={`${isTestnet ? "Shelby Testnet · Aptos Testnet RPC" : "Shelbynet"} · Poll every ${POLL_MS / 1000}s`}
        badge={<NetworkBadge network={network as "shelbynet" | "testnet"} />}
        action={
          <div className="flex items-center gap-2.5">
            {snap?.method && <MethodBadge method={snap.method} />}
            {lastAtStr && (
              <span className="text-xs font-mono text-[var(--text-dim)]">{lastAtStr}</span>
            )}
            <RefreshButton onClick={fetchStats} loading={loading && !snap} />
          </div>
        }
      />

      {/* ── Testnet notice ─────────────────────────────────────────────────── */}
      {isTestnet && (
        <div className="flex items-center gap-2 rounded-xl border border-purple-500/25 bg-purple-500/8 px-4 py-2.5 text-sm text-purple-400 mb-5">
          <span>⚗</span>
          <span>Early Testnet · Live data from Aptos Testnet RPC</span>
          <LiveIndicator size="sm" label="" className="ml-auto" />
        </div>
      )}

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && !hasData && (
        <ErrorBanner message={error} variant="warning" onRetry={fetchStats} className="mb-5" />
      )}

      {/* ── Block + Breakdown grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {/* Block height */}
        <div className="rounded-xl border bg-[var(--bg-card)] p-5 transition-colors">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Block Height</div>
          <div
            className="text-[30px] font-extrabold tabular-nums leading-none break-all"
            style={{ color: accentColor, fontFamily: "var(--font-mono)" }}
          >
            {snap?.blockHeight ? `#${snap.blockHeight.toLocaleString("en-US")}` : loading ? "…" : "—"}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-2 flex items-center gap-3 flex-wrap">
            <span>Ledger v{snap?.ledgerVersion ? snap.ledgerVersion.toLocaleString("en-US") : "—"}</span>
            {isTestnet && snap?.chainId != null && (
              <span className="text-[var(--text-dim)]">Chain ID: {snap.chainId}</span>
            )}
          </div>
        </div>

        {/* Blob breakdown */}
        <div className="rounded-xl border bg-[var(--bg-card)] p-5 transition-colors">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3">
            {isTestnet ? "Network Status" : "Blob Composition"}
          </div>
          {loading && !snap ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-4 rounded bg-[var(--bg-card2)] animate-pulse" style={{ width: `${70 + i * 5}%` }} />
              ))}
            </div>
          ) : !snap ? (
            <div className="text-sm text-[var(--text-dim)]">No data</div>
          ) : isTestnet ? (
            <div className="space-y-2.5">
              {[
                { label: "Active SPs",       v: snap.storageProviders,    color: "bg-emerald-500" },
                { label: "Waitlisted SPs",   v: snap.waitlistedProviders, color: "bg-amber-400"   },
                { label: "Placement Groups", v: snap.placementGroups,     color: "bg-purple-500"  },
                { label: "Slices",           v: snap.slices,              color: "bg-cyan-500"    },
              ].map(({ label, v, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-sm ${color}`} />
                    <span className="text-sm text-[var(--text-muted)]">{label}</span>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-[var(--text-primary)]" style={{ fontFamily: "var(--font-mono)" }}>
                    {fmt(v)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <BlobBreakdownBar
              active={snap.activeBlobs}
              pending={snap.pendingOrFailed}
              deleted={snap.deletedBlobs}
              empty={snap.emptyRecords}
            />
          )}
        </div>
      </div>

      {/* ── 6 stat cards ──────────────────────────────────────────────────── */}
      <DataGrid cols={3} className="mb-5">
        {METRICS.map(m => (
          <StatCard
            key={m.label}
            label={m.label}
            value={loading && !snap ? "…" : m.value}
            sub={m.sub}
            accent={m.accent}
            icon={m.icon}
            pulse={(m as any).pulse}
            loading={loading && !snap}
          />
        ))}
      </DataGrid>

      {/* ── 4 sparkline charts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {CHARTS.map(c => (
          <ChartCard key={c.title} {...c} latestColor={c.color} />
        ))}
      </div>

      {/* Time axis labels */}
      {series.length > 1 && (
        <div className="flex justify-between text-[10px] font-mono text-[var(--text-dim)] mb-2 px-0.5">
          <span>{fmtTime(series[0].ts)}</span>
          <span>{fmtTime(series[series.length - 1].ts)}</span>
        </div>
      )}

      {/* ── Source footer ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-[var(--bg-card2)] px-4 py-3 text-xs font-mono text-[var(--text-dim)]">
        {isTestnet
          ? "Source: Aptos Testnet REST API + Indexer · Total Blobs = is_written=1 (matches Explorer)"
          : "Source: Shelby Dedicated Indexer · Total Blobs = is_written=1 (matches shelby.xyz Explorer)"
        }
      </div>
    </div>
  );
}