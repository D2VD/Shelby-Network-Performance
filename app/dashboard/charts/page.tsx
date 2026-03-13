// app/dashboard/charts/page.tsx
// Charts page — real-time latency from API, honest about what needs benchmark data
"use client";
import { useEffect, useState, useCallback } from "react";
import { Nav } from "@/components/nav";
import { StatCard, ErrorBanner } from "@/components/ui";
import { LineChart } from "@/components/charts";

type HealthData = {
  status: string;
  checks: Record<string, { ok: boolean; latencyMs: number; name: string }>;
  network: { blockHeight: number };
};

const MAX_POINTS = 30;

export default function ChartsPage() {
  const [latHistory, setLatHistory] = useState<number[]>([]);
  const [health,     setHealth]     = useState<HealthData | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [lastAt,     setLastAt]     = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/benchmark/health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: HealthData = await r.json();
      setHealth(d);
      setError(null);
      setLastAt(new Date());

      const ms = d.checks?.node?.latencyMs ?? 0;
      if (ms > 0) setLatHistory(h => [...h.slice(-(MAX_POINTS - 1)), ms]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 10_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const latAvg = latHistory.length ? Math.round(latHistory.reduce((a, b) => a + b, 0) / latHistory.length) : null;
  const latMin = latHistory.length ? Math.min(...latHistory) : null;
  const latMax = latHistory.length ? Math.max(...latHistory) : null;

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", fontFamily: "'Outfit', sans-serif", color: "#0A0A0A" }}>
      <Nav />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: -1 }}>Network Charts</h1>
            <p style={{ fontSize: 13.5, color: "#AAA", margin: "6px 0 0" }}>
              Real-time metrics sampled from Shelbynet API every 10s
              {lastAt && <span style={{ marginLeft: 8, fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#CCC" }}>· {lastAt.toLocaleTimeString()}</span>}
            </p>
          </div>
          <button onClick={fetchHealth} disabled={loading} style={{ padding: "8px 18px", background: "#F4F4F4", border: "1px solid #E8E8E8", borderRadius: 10, cursor: "pointer", fontSize: 13, color: "#555" }}>
            {loading ? "Loading…" : "⟳ Refresh"}
          </button>
        </div>

        {error && <div style={{ marginBottom: 20 }}><ErrorBanner message="Cannot reach Shelbynet API" detail={error} onRetry={fetchHealth} /></div>}

        {/* Live latency chart */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #F4F4F4", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Node Latency — Live</div>
              <div style={{ fontSize: 12, color: "#AAA", marginTop: 2 }}>Real ping to Shelbynet fullnode — sampled every 10s · {latHistory.length}/{MAX_POINTS} points</div>
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              {[["Avg", latAvg ? `${latAvg}ms` : "—"], ["Min", latMin ? `${latMin}ms` : "—"], ["Max", latMax ? `${latMax}ms` : "—"]].map(([l, v]) => (
                <div key={l} style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#CCC", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: "#0A0A0A" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: "16px 24px 12px" }}>
            <LineChart data={latHistory} color="#059669" height={140} />
          </div>
          <div style={{ padding: "0 24px 14px", fontSize: 11, color: "#CCC", fontFamily: "'DM Mono', monospace" }}>
            Collecting real-time samples · refreshes automatically
          </div>
        </div>

        {/* Live network status */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #F4F4F4" }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Endpoint Status — Live</div>
            <div style={{ fontSize: 12, color: "#AAA", marginTop: 2 }}>Real-time status of Shelbynet infrastructure endpoints</div>
          </div>
          <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 20 }}>
            {[
              { label: "Status",        value: health ? (health.status.charAt(0).toUpperCase() + health.status.slice(1)) : "—", color: health?.status === "healthy" ? "#059669" : health?.status === "degraded" ? "#D97706" : "#DC2626" },
              { label: "Block Height",  value: health?.network.blockHeight.toLocaleString() ?? "—", color: "#0A0A0A" },
              { label: "Fullnode",      value: health?.checks?.node?.ok   ? `${health.checks.node.latencyMs}ms`   : (error ? "Error" : "—"), color: health?.checks?.node?.ok   ? "#059669" : "#DC2626" },
              { label: "Ledger Check",  value: health?.checks?.ledger?.ok ? `${health.checks.ledger.latencyMs}ms` : (error ? "Error" : "—"), color: health?.checks?.ledger?.ok ? "#059669" : "#DC2626" },
            ].map(m => (
              <div key={m.label}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#AAA", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Placeholder for speed charts */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #F4F4F4" }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Upload & Download Speed</div>
            <div style={{ fontSize: 12, color: "#AAA", marginTop: 2 }}>Real transfer measurements — requires running a benchmark</div>
          </div>
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}></div>
            <div style={{ fontSize: 14, color: "#BBB", marginBottom: 20 }}>No speed data yet — run a benchmark to populate this chart with real transfer measurements</div>
            <a href="/" style={{ padding: "10px 24px", background: "#059669", color: "#fff", borderRadius: 10, fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}>
              Run Benchmark →
            </a>
          </div>
        </div>

        {/* Data note */}
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 14, padding: "18px 22px" }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: "#065F46", marginBottom: 6 }}>About this data</div>
          <div style={{ fontSize: 13, color: "#6EE7B7", lineHeight: 1.65 }}>
            Latency metrics are <strong style={{ color: "#059669" }}>real measurements</strong> from the Shelbynet API, sampled every 10 seconds.
            Upload/download charts require running the Benchmark tool which uploads actual blobs.
            No simulated or fake data is displayed — if an endpoint is unreachable, an error is shown instead.
          </div>
        </div>
      </div>
    </div>
  );
}