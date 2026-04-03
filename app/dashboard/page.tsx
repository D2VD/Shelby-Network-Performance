"use client";
/**
 * app/dashboard/page.tsx — v4.0
 * Dashboard chính: metrics grid + block ticker + real-time charts
 * Data source: /api/network/stats → VPS SDK on-chain → GQL fallback
 * Hiển thị statsSource tag để debug khi số liệu lệch
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";
import { LineChart } from "@/components/charts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface NetworkStats {
  totalBlobs:            number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents:       number | null;
  slices:                number | null;
  placementGroups:       number | null;
  storageProviders:      number | null;
}
interface NodeInfo {
  blockHeight:   number;
  ledgerVersion: number;
  chainId:       number;
}
interface LivePoint {
  ts:                    number;
  blockHeight:           number;
  totalBlobs:            number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents:       number | null;
}

// ── Format helpers ─────────────────────────────────────────────────────────────
function fmtNum(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-US");
}
function fmtBytes(b: number | null): string {
  if (b == null || b === 0) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}
function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon, color, loading, delta,
}: {
  label: string; value: string; sub?: string;
  icon: string; color: string; loading: boolean;
  delta?: string | null;
}) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderTop: `3px solid ${color}`,
      borderRadius: 12,
      padding: "16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Background icon */}
      <span style={{
        position: "absolute", right: 14, top: 10,
        fontSize: 28, opacity: 0.06, userSelect: "none",
        color,
      }}>{icon}</span>

      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af" }}>
        {label}
      </div>

      <div style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: loading ? 20 : value.length > 8 ? 18 : 22,
        fontWeight: 700,
        color: loading ? "#e5e7eb" : "#111827",
        letterSpacing: -0.5,
        lineHeight: 1.2,
        transition: "color 0.3s",
      }}>
        {loading ? "···" : value}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {sub && (
          <div style={{ fontSize: 11, color: "#9ca3af" }}>{sub}</div>
        )}
        {delta && (
          <div style={{ fontSize: 10, color: "#16a34a", fontFamily: "monospace", background: "#f0fdf4", padding: "1px 6px", borderRadius: 4 }}>
            {delta}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Block Progress Ring ────────────────────────────────────────────────────────
function BlockTicker({ node, loading }: { node: NodeInfo | null; loading: boolean }) {
  if (loading || !node) {
    return (
      <div style={{
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
        padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          border: "3px solid #f0f0f0", borderTopColor: "#2563eb",
          animation: "spin 1s linear infinite", flexShrink: 0,
        }} />
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 4 }}>
            Blockchain
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#d1d5db" }}>Connecting…</div>
        </div>
      </div>
    );
  }

  const progress = ((node.blockHeight % 1000) / 1000) * 100;
  const epoch    = Math.floor(node.blockHeight / 1000);
  const r = 20, c = 2 * Math.PI * r;
  const dash = (progress / 100) * c;

  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
      padding: "16px 20px", display: "flex", alignItems: "center", gap: 16,
    }}>
      {/* Ring */}
      <svg width={52} height={52} viewBox="0 0 52 52" style={{ flexShrink: 0 }}>
        <circle cx={26} cy={26} r={r} fill="none" stroke="#f0f0f0" strokeWidth={4} />
        <circle cx={26} cy={26} r={r} fill="none" stroke="#2563eb" strokeWidth={4}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
          transform="rotate(-90 26 26)"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x={26} y={30} textAnchor="middle" fontSize={9} fontWeight={700}
          fill="#2563eb" fontFamily="monospace">
          {Math.round(progress)}%
        </text>
      </svg>

      <div>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 4 }}>
          Block Height
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 17, fontWeight: 700, color: "#111827", letterSpacing: -0.3 }}>
          #{node.blockHeight.toLocaleString()}
        </div>
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, fontFamily: "monospace" }}>
          Epoch ~{epoch.toLocaleString()} · Chain {node.chainId}
        </div>
      </div>
    </div>
  );
}

// ── Source Badge ──────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string }) {
  const isAccurate = source.includes("sdk") || source.includes("on-chain");
  const color = isAccurate ? "#16a34a" : source === "unknown" ? "#9ca3af" : "#d97706";
  const bg    = isAccurate ? "#f0fdf4"  : source === "unknown" ? "#f9fafb"  : "#fffbeb";

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 9px", borderRadius: 6, fontSize: 10, fontWeight: 600,
      background: bg, color, border: `1px solid ${isAccurate ? "#bbf7d0" : "#e5e7eb"}`,
      fontFamily: "monospace",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
      {source}
    </span>
  );
}

// ── Mini Metric Row ───────────────────────────────────────────────────────────
function MetricRow({ label, value, color = "#6b7280" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f5f5f5" }}>
      <span style={{ fontSize: 12, color: "#6b7280" }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const MAX_POINTS = 60; // 30 min @ 30s
const POLL_MS    = 30_000;

export default function DashboardPage() {
  const { network } = useNetwork();
  const [stats,       setStats]       = useState<NetworkStats>({ totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, slices: null, placementGroups: null, storageProviders: null });
  const [node,        setNode]        = useState<NodeInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [lastAt,      setLastAt]      = useState<Date | null>(null);
  const [statsSource, setStatsSource] = useState("—");
  const [series,      setSeries]      = useState<LivePoint[]>([]);
  const [errors,      setErrors]      = useState<string[]>([]);
  const prevStats = useRef<NetworkStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/stats?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as any;

      if (d.data?.stats) {
        const s = d.data.stats as NetworkStats;
        setStats(s);
        prevStats.current = s;
        setNode(d.data.node ?? null);
        setStatsSource(d.data.statsSource ?? d.data.statsMethod ?? "unknown");
        setLastAt(new Date());
        setErrors(d.data._errors ?? []);

        // Append to live series
        setSeries(prev => {
          const point: LivePoint = {
            ts:                    Date.now(),
            blockHeight:           d.data.node?.blockHeight ?? 0,
            totalBlobs:            s.totalBlobs,
            totalStorageUsedBytes: s.totalStorageUsedBytes,
            totalBlobEvents:       s.totalBlobEvents,
          };
          const next = [...prev, point];
          return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
        });
      }
    } catch (e: any) {
      setErrors([e.message]);
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setLoading(true);
    setStats({ totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, slices: null, placementGroups: null, storageProviders: null });
    setNode(null);
    setSeries([]);
    setErrors([]);
    fetchStats();
    const id = setInterval(fetchStats, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  if (network === "testnet") return <TestnetBanner />;

  // Compute deltas vs previous for blob count
  const blobDelta = (() => {
    if (series.length < 2) return null;
    const last = series[series.length - 1].totalBlobs;
    const prev = series[series.length - 2].totalBlobs;
    if (last == null || prev == null) return null;
    const d = last - prev;
    return d !== 0 ? `${d > 0 ? "+" : ""}${d.toLocaleString()}` : null;
  })();

  const METRICS = [
    {
      label:  "Total Blobs",
      value:  fmtNum(stats.totalBlobs),
      sub:    "Files stored on-chain",
      icon:   "◈",
      color:  "#2563eb",
      delta:  blobDelta,
    },
    {
      label:  "Storage Used",
      value:  fmtBytes(stats.totalStorageUsedBytes),
      sub:    "Actual bytes (SDK)",
      icon:   "▣",
      color:  "#059669",
      delta:  null,
    },
    {
      label:  "Blob Events",
      value:  fmtNum(stats.totalBlobEvents),
      sub:    "account_txns × 2",
      icon:   "↯",
      color:  "#9333ea",
      delta:  null,
    },
    {
      label:  "Storage Providers",
      value:  stats.storageProviders != null ? String(stats.storageProviders) : "—",
      sub:    "Active SPs on-chain",
      icon:   "◎",
      color:  "#0891b2",
      delta:  null,
    },
    {
      label:  "Placement Groups",
      value:  stats.placementGroups != null ? String(stats.placementGroups) : "—",
      sub:    "Erasure code groups",
      icon:   "▦",
      color:  "#d97706",
      delta:  null,
    },
    {
      label:  "Slices",
      value:  stats.slices != null ? String(stats.slices) : "—",
      sub:    "Slice registry count",
      icon:   "⬡",
      color:  "#7c3aed",
      delta:  null,
    },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: 1280, margin: "0 auto" }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0, letterSpacing: -0.5 }}>
            Network Dashboard
          </h1>
          <p style={{ fontSize: 13, color: "#9ca3af", margin: "5px 0 0" }}>
            Shelbynet · Live metrics · Polling every {POLL_MS / 1000}s
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SourceBadge source={statsSource} />
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "#9ca3af", fontFamily: "monospace",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: loading ? "#d1d5db" : "#22c55e",
              boxShadow: loading ? "none" : "0 0 6px #22c55e",
              display: "inline-block",
            }} />
            {loading ? "Syncing…" : lastAt ? lastAt.toLocaleTimeString() : "Live"}
          </div>
          <button
            onClick={fetchStats}
            style={{
              padding: "5px 12px", borderRadius: 7,
              border: "1px solid #e5e7eb", background: "#fff",
              fontSize: 11, color: "#6b7280", cursor: "pointer",
            }}
          >
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {errors.length > 0 && (
        <div style={{
          background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 8, padding: "10px 14px", marginBottom: 16,
          fontSize: 11, color: "#92400e", fontFamily: "monospace",
        }}>
          ⚠ Source fallbacks triggered: {errors.join(" · ")}
        </div>
      )}

      {/* ── Block ticker + chain info ────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <BlockTicker node={node} loading={loading} />

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 10 }}>
            Chain Info
          </div>
          <MetricRow label="Network"       value="Shelbynet"                             color="#2563eb" />
          <MetricRow label="Chain ID"      value={node ? String(node.chainId) : "—"}    color="#374151" />
          <MetricRow label="Ledger"        value={node ? fmtNum(node.ledgerVersion) : "—"} color="#374151" />
          <MetricRow label="Data source"   value={statsSource}                           color={statsSource.includes("sdk") ? "#16a34a" : "#d97706"} />
          <MetricRow label="Last updated"  value={lastAt ? lastAt.toLocaleTimeString() : "—"} color="#9ca3af" />
        </div>
      </div>

      {/* ── Metrics grid ────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12,
        marginBottom: 24,
      }}>
        {METRICS.map(m => (
          <StatCard key={m.label} loading={loading} {...m} />
        ))}
      </div>

      {/* ── Live charts ──────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>

        {/* Blob count over time */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Total Blobs</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>30min window · {POLL_MS/1000}s poll</div>
            </div>
            {stats.totalBlobs != null && (
              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#2563eb" }}>
                {fmtNum(stats.totalBlobs)}
              </div>
            )}
          </div>
          <LineChart
            data={series.map(p => p.totalBlobs ?? 0).filter(v => v > 0)}
            color="#2563eb"
            height={120}
          />
          {series.length > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#d1d5db", fontFamily: "monospace", marginTop: 4 }}>
              <span>{timeLabel(series[0].ts)}</span>
              <span>{timeLabel(series[series.length - 1].ts)}</span>
            </div>
          )}
        </div>

        {/* Block height over time */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Block Height</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>Chain progress</div>
            </div>
            {node && (
              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#059669" }}>
                #{node.blockHeight.toLocaleString()}
              </div>
            )}
          </div>
          <LineChart
            data={series.map(p => p.blockHeight).filter(v => v > 0)}
            color="#059669"
            height={120}
          />
          {series.length > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#d1d5db", fontFamily: "monospace", marginTop: 4 }}>
              <span>{timeLabel(series[0].ts)}</span>
              <span>{timeLabel(series[series.length - 1].ts)}</span>
            </div>
          )}
        </div>

        {/* Storage used */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Storage Used</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>SDK getTotalBlobsSize()</div>
            </div>
            {stats.totalStorageUsedBytes != null && (
              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#9333ea" }}>
                {fmtBytes(stats.totalStorageUsedBytes)}
              </div>
            )}
          </div>
          <LineChart
            data={series.map(p => p.totalStorageUsedBytes ?? 0).filter(v => v > 0)}
            color="#9333ea"
            height={120}
          />
        </div>

        {/* Blob events */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Blob Events</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>account_txns × 2.0</div>
            </div>
            {stats.totalBlobEvents != null && (
              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#d97706" }}>
                {fmtNum(stats.totalBlobEvents)}
              </div>
            )}
          </div>
          <LineChart
            data={series.map(p => p.totalBlobEvents ?? 0).filter(v => v > 0)}
            color="#d97706"
            height={120}
          />
        </div>
      </div>

      {/* ── Data source explanation ─────────────────────────────────────── */}
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 20px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Data Sources
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "totalBlobs + storageUsed", source: "SDK getBlobsCount({}) + getTotalBlobsSize({})", priority: "1st", color: "#16a34a" },
            { label: "storageProviders / slices / placementGroups", source: "On-chain RPC resource read", priority: "1st", color: "#16a34a" },
            { label: "blobEvents", source: "Indexer GQL account_transactions_aggregate × 2", priority: "1st", color: "#2563eb" },
          ].map(item => (
            <div key={item.label} style={{ padding: "10px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: item.color, marginBottom: 4, textTransform: "uppercase" }}>
                {item.priority} priority
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", lineHeight: 1.4 }}>{item.source}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
          ⚠ Explorer UI (explorer.shelby.xyz) không có public API — tất cả data lấy trực tiếp từ Shelbynet RPC/Indexer
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}