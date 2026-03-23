"use client";
// app/dashboard/charts/page.tsx v4 — R2 snapshot charts + live latency
//
// THAY ĐỔI so với v3:
// - Historical charts từ R2 snapshots (totalBlobs, totalStorageUsed, blobEvents)
//   qua /api/analytics/snapshots — không còn placeholder "Run benchmark"
// - Tabs: Live | History
// - Testnet → TestnetBanner thay vì hiển thị data trống
// - Calibration info hiển thị trong footer card

import { useEffect, useState, useCallback, useMemo } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ── Types ────────────────────────────────────────────────────────────────────

type HealthData = {
  status: string;
  checks: Record<string, { ok: boolean; latencyMs: number; name: string }>;
  network: { blockHeight: number };
};

interface Snapshot {
  ts:                   string;
  blockHeight:          number;
  totalBlobs:           number;
  totalStorageUsedBytes: number;
  storageProviders:     number;
  placementGroups:      number;
  slices:               number;
  totalBlobEvents:      number;
  avgBlobSizeBytes?:    number;
}

type Tab = "live" | "history";

const MAX_LATENCY_PTS = 30;

// ── SVG Line Chart ────────────────────────────────────────────────────────────

function LineChart({
  data,
  color = "#2563eb",
  height = 140,
  formatY,
}: {
  data: number[];
  color?: string;
  height?: number;
  formatY?: (v: number) => string;
}) {
  if (data.length < 2)
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gray-400)", fontSize: 13 }}>
        Collecting data…
      </div>
    );

  const W = 560, pad = { t: 8, b: 28, l: 54, r: 10 };
  const iW = W - pad.l - pad.r, iH = height - pad.t - pad.b;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const xs = data.map((_, i) => pad.l + (i / (data.length - 1)) * iW);
  const ys = data.map(v => pad.t + iH - ((v - min) / range) * iH);
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t + iH} ${line} ${(pad.l + iW).toFixed(1)},${pad.t + iH}`;
  const gId  = `lg${color.replace(/[^a-z0-9]/gi, "")}`;

  const fmt = formatY ?? ((v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(Math.round(v));
  });

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.12} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => {
        const y = pad.t + iH - f * iH;
        return (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#f3f4f6" />
            <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">
              {fmt(min + f * range)}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill={`url(#${gId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {xs.length > 0 && (
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
      )}
    </svg>
  );
}

// ── Timestamp labels for X axis (hours ago) ──────────────────────────────────
function XAxisLabels({ timestamps, count = 5 }: { timestamps: string[]; count?: number }) {
  if (timestamps.length < 2) return null;
  const step  = Math.floor((timestamps.length - 1) / (count - 1));
  const picks = Array.from({ length: count }, (_, i) => Math.min(i * step, timestamps.length - 1));
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0 0", fontSize: 10, color: "#9ca3af", fontFamily: "var(--font-mono)" }}>
      {picks.map(idx => {
        const d = new Date(timestamps[idx]);
        return (
          <span key={idx}>{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
        );
      })}
    </div>
  );
}

// ── Stat mini card ────────────────────────────────────────────────────────────
function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

// ── fmtBytes ─────────────────────────────────────────────────────────────────
function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();

  // ── Tab state
  const [tab, setTab] = useState<Tab>("history");

  // ── Live latency
  const [latHistory, setLatHistory] = useState<number[]>([]);
  const [health,     setHealth]     = useState<HealthData | null>(null);
  const [liveError,  setLiveError]  = useState<string | null>(null);
  const [liveLoad,   setLiveLoad]   = useState(true);
  const [lastAt,     setLastAt]     = useState<Date | null>(null);

  // ── Historical snapshots
  const [snapshots,  setSnapshots]  = useState<Snapshot[]>([]);
  const [snapLoad,   setSnapLoad]   = useState(true);
  const [snapError,  setSnapError]  = useState<string | null>(null);
  const [snapSource, setSnapSource] = useState<string>("—");

  // ── Fetch live health (only when tab=live)
  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/benchmark/health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: HealthData = await r.json();
      setHealth(d); setLiveError(null); setLastAt(new Date());
      const ms = d.checks?.node?.latencyMs ?? 0;
      if (ms > 0) setLatHistory(h => [...h.slice(-(MAX_LATENCY_PTS - 1)), ms]);
    } catch (e: any) { setLiveError(e.message); }
    finally { setLiveLoad(false); }
  }, []);

  useEffect(() => {
    if (tab !== "live") return;
    fetchHealth();
    const id = setInterval(fetchHealth, 10_000);
    return () => clearInterval(id);
  }, [tab, fetchHealth]);

  // ── Fetch snapshots
  const fetchSnapshots = useCallback(async () => {
    setSnapLoad(true); setSnapError(null);
    try {
      const r = await fetch(`/api/analytics/snapshots?network=${network}&limit=48`);
      const d = await r.json() as any;
      if (d?.ok && d?.data?.snapshots?.length > 0) {
        setSnapshots(d.data.snapshots);
        setSnapSource(d.source ?? "unknown");
      } else if (d?.data?.snapshots?.length === 0) {
        setSnapshots([]);
        setSnapError(d.error ?? "No snapshot data yet — Worker cron runs hourly");
        setSnapSource("empty");
      } else {
        setSnapError(d.error ?? "Failed to load snapshots");
      }
    } catch (e: any) { setSnapError(e.message); }
    finally { setSnapLoad(false); }
  }, [network]);

  useEffect(() => {
    setSnapshots([]); setSnapError(null);
    fetchSnapshots();
  }, [fetchSnapshots]);

  // ── Derived data from snapshots
  const timestamps     = useMemo(() => snapshots.map(s => s.ts), [snapshots]);
  const blobData       = useMemo(() => snapshots.map(s => s.totalBlobs), [snapshots]);
  const storageData    = useMemo(() => snapshots.map(s => s.totalStorageUsedBytes), [snapshots]);
  const eventData      = useMemo(() => snapshots.map(s => s.totalBlobEvents), [snapshots]);
  const sliceData      = useMemo(() => snapshots.map(s => s.slices), [snapshots]);
  const latAvg  = latHistory.length ? Math.round(latHistory.reduce((a, b) => a + b, 0) / latHistory.length) : null;
  const latMin  = latHistory.length ? Math.min(...latHistory) : null;
  const latMax  = latHistory.length ? Math.max(...latHistory) : null;
  const latestSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  // ── Testnet gate ─────────────────────────────────────────────────────────
  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="page-title">Network Charts</h1>
          <p className="page-subtitle">
            {config.label} · {snapshots.length > 0 ? `${snapshots.length} hourly snapshots from R2` : "Loading data…"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Tab switcher */}
          <div style={{ display: "flex", background: "#f4f4f4", borderRadius: 10, padding: 3, gap: 2 }}>
            {(["history", "live"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 13,
                  fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? "#0a0a0a" : "#999",
                  background: tab === t ? "#fff" : "transparent",
                  boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                  border: "none", cursor: "pointer",
                }}
              >
                {t === "history" ? "📊 History" : "⚡ Live"}
              </button>
            ))}
          </div>
          <button
            onClick={tab === "live" ? fetchHealth : fetchSnapshots}
            disabled={tab === "live" ? liveLoad : snapLoad}
            className="btn btn-secondary"
          >
            {(tab === "live" ? liveLoad : snapLoad) ? "⟳ Loading…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* ── HISTORY TAB ───────────────────────────────────────────────────── */}
      {tab === "history" && (
        <>
          {snapError && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              {snapError}
              {snapError.includes("hourly") && (
                <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>
                  — Trigger manually:{" "}
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    POST /count?secret=…
                  </code>
                </span>
              )}
            </div>
          )}

          {/* Latest snapshot summary */}
          {latestSnap && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Latest snapshot</span>
                {[
                  { label: "Blobs",     value: latestSnap.totalBlobs.toLocaleString() },
                  { label: "Storage",   value: fmtBytes(latestSnap.totalStorageUsedBytes) },
                  { label: "Events",    value: latestSnap.totalBlobEvents.toLocaleString() },
                  { label: "Slices",    value: latestSnap.slices.toLocaleString() },
                  { label: "Providers", value: String(latestSnap.storageProviders) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--gray-700)", fontWeight: 500 }}>{value}</span>
                  </div>
                ))}
                <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>
                  {new Date(latestSnap.ts).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {/* Blob count chart */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Total blobs — hourly</div>
                <div className="card-subtitle">Files stored on {config.label}</div>
              </div>
              {blobData.length > 0 && (
                <MiniStat label="Latest" value={blobData[blobData.length - 1].toLocaleString()} color="#2563eb" />
              )}
            </div>
            <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4, opacity: snapLoad ? 0.4 : 1, transition: "opacity 0.3s" }}>
              <LineChart data={blobData} color="#2563eb" height={140} formatY={v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)} />
              <XAxisLabels timestamps={timestamps} />
            </div>
          </div>

          {/* Storage used chart */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Storage used — hourly</div>
                <div className="card-subtitle">Estimated (totalBlobs × avg blob size)</div>
              </div>
              {storageData.length > 0 && (
                <MiniStat label="Latest" value={fmtBytes(storageData[storageData.length - 1])} color="#16a34a" />
              )}
            </div>
            <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4, opacity: snapLoad ? 0.4 : 1, transition: "opacity 0.3s" }}>
              <LineChart data={storageData} color="#16a34a" height={120} formatY={fmtBytes} />
              <XAxisLabels timestamps={timestamps} />
            </div>
          </div>

          {/* Events + Slices side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Blob events</div>
                  <div className="card-subtitle">txns × 2.0</div>
                </div>
                {eventData.length > 0 && (
                  <MiniStat label="Latest" value={eventData[eventData.length - 1].toLocaleString()} color="#9333ea" />
                )}
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                <LineChart data={eventData} color="#9333ea" height={100} />
                <XAxisLabels timestamps={timestamps} count={3} />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Slices</div>
                  <div className="card-subtitle">Erasure-coded chunks</div>
                </div>
                {sliceData.length > 0 && (
                  <MiniStat label="Latest" value={sliceData[sliceData.length - 1].toLocaleString()} color="#d97706" />
                )}
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 4 }}>
                <LineChart data={sliceData} color="#d97706" height={100} />
                <XAxisLabels timestamps={timestamps} count={3} />
              </div>
            </div>
          </div>

          {/* Calibration info footer */}
          {latestSnap?.avgBlobSizeBytes && (
            <div className="card">
              <div className="card-body" style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Storage calibration</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gray-600)" }}>
                  avg blob size: {latestSnap.avgBlobSizeBytes.toLocaleString()} bytes
                </span>
                <span style={{ fontSize: 11, color: "var(--gray-400)" }}>
                  Data source: <strong>{snapSource}</strong>
                </span>
                <span style={{ fontSize: 11, color: "var(--gray-400)" }}>
                  After shelbynet wipe → run{" "}
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "#f4f4f4", padding: "1px 5px", borderRadius: 4 }}>
                    POST /calibrate?secret=…
                  </code>
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── LIVE TAB ──────────────────────────────────────────────────────── */}
      {tab === "live" && (
        <>
          {liveError && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              Cannot reach {config.label}: {liveError}
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Node latency — live</div>
                <div className="card-subtitle">
                  Real ping to {config.label} fullnode · sampled every 10s · {latHistory.length}/{MAX_LATENCY_PTS} points
                  {lastAt && (
                    <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gray-400)" }}>
                      · {lastAt.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 20 }}>
                {[["Avg", latAvg ? `${latAvg}ms` : "—"], ["Min", latMin ? `${latMin}ms` : "—"], ["Max", latMax ? `${latMax}ms` : "—"]].map(([l, v]) => (
                  <MiniStat key={l} label={l} value={v} color="var(--gray-800)" />
                ))}
              </div>
            </div>
            <div className="card-body" style={{ paddingTop: 12, paddingBottom: 12, opacity: liveLoad && latHistory.length === 0 ? 0.4 : 1, transition: "opacity 0.3s" }}>
              <LineChart data={latHistory} color="#2563eb" height={140} formatY={v => `${v}ms`} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><div className="card-title">Endpoint status</div></div>
            <div className="card-body">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 20 }}>
                {[
                  { label: "Status",       value: health ? health.status[0].toUpperCase() + health.status.slice(1) : "—", ok: health?.status === "healthy" },
                  { label: "Block height", value: health?.network.blockHeight.toLocaleString() ?? "—", ok: true },
                  { label: "Fullnode",     value: health?.checks?.node?.ok ? `${health.checks.node.latencyMs}ms` : (liveError ? "Error" : "—"), ok: health?.checks?.node?.ok },
                  { label: "Ledger",       value: health?.checks?.ledger?.ok ? `${health.checks.ledger.latencyMs}ms` : (liveError ? "Error" : "—"), ok: health?.checks?.ledger?.ok },
                ].map(m => (
                  <div key={m.label}>
                    <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 6 }}>{m.label}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600, color: m.ok === false ? "var(--danger)" : m.ok === true && m.value !== "—" ? "var(--success)" : "var(--gray-800)" }}>
                      {liveLoad && !health ? <span style={{ color: "var(--gray-200)" }}>—</span> : m.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Upload speed — still needs benchmark */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Upload & download speed</div>
              <div className="card-subtitle">Run the benchmark tool to populate this chart</div>
            </div>
            <div className="card-body" style={{ textAlign: "center", padding: "40px 22px" }}>
              <div style={{ fontSize: 13, color: "var(--gray-400)", marginBottom: 16 }}>
                No speed data yet — run a benchmark to see real transfer measurements
              </div>
              <a href="/" className="btn btn-primary" style={{ display: "inline-flex" }}>▶ Run Benchmark →</a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
