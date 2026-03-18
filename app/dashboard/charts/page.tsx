"use client";
// app/dashboard/charts/page.tsx v3 · Light theme

import { useEffect, useState, useCallback } from "react";
import { useNetwork } from "@/components/network-context";

type HealthData = {
  status: string;
  checks: Record<string, { ok: boolean; latencyMs: number; name: string }>;
  network: { blockHeight: number };
};

const MAX_PTS = 30;

// Clean line chart on white background
function LineChart({ data, color = "#2563eb", height = 140 }: { data:number[]; color?:string; height?:number }) {
  if (data.length < 2) return (
    <div style={{ height, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--gray-400)", fontSize:13 }}>
      Collecting samples…
    </div>
  );
  const W = 560, pad = { t:8, b:24, l:40, r:10 };
  const iW = W-pad.l-pad.r, iH = height-pad.t-pad.b;
  const min = Math.min(...data), max = Math.max(...data), range = max-min||1;
  const xs = data.map((_,i) => pad.l + (i/(data.length-1))*iW);
  const ys = data.map(v  => pad.t + iH - ((v-min)/range)*iH);
  const line = xs.map((x,i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${pad.l},${pad.t+iH} ${line} ${(pad.l+iW).toFixed(1)},${pad.t+iH}`;
  const gId = `lg${color.replace(/[^a-z0-9]/gi,"")}`;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width:"100%", height, display:"block" }}>
      <defs>
        <linearGradient id={gId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.12}/>
          <stop offset="100%" stopColor={color} stopOpacity={0}/>
        </linearGradient>
      </defs>
      {[0,0.5,1].map(f => {
        const y = pad.t+iH-f*iH;
        return <g key={f}>
          <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke="#f3f4f6"/>
          <text x={pad.l-5} y={y+3} textAnchor="end" fontSize={9} fill="#9ca3af">{Math.round(min+f*range)}</text>
        </g>;
      })}
      <polygon points={area} fill={`url(#${gId})`}/>
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"/>
      {xs.length > 0 && (
        <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={4} fill={color} stroke="#fff" strokeWidth={2}/>
      )}
    </svg>
  );
}

export default function ChartsPage() {
  const { config } = useNetwork();
  const [latHistory, setLatHistory] = useState<number[]>([]);
  const [health,  setHealth]  = useState<HealthData|null>(null);
  const [error,   setError]   = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAt,  setLastAt]  = useState<Date|null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/benchmark/health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: HealthData = await r.json();
      setHealth(d); setError(null); setLastAt(new Date());
      const ms = d.checks?.node?.latencyMs ?? 0;
      if (ms > 0) setLatHistory(h => [...h.slice(-(MAX_PTS-1)), ms]);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 10_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const latAvg = latHistory.length ? Math.round(latHistory.reduce((a,b)=>a+b,0)/latHistory.length) : null;
  const latMin = latHistory.length ? Math.min(...latHistory) : null;
  const latMax = latHistory.length ? Math.max(...latHistory) : null;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 className="page-title">Network Charts</h1>
          <p className="page-subtitle">
            Real-time metrics · sampled every 10s · {latHistory.length}/{MAX_PTS} points
            {lastAt && <span style={{ marginLeft:8, fontFamily:"var(--font-mono)", fontSize:12, color:"var(--gray-400)" }}>
              · {lastAt.toLocaleTimeString()}
            </span>}
          </p>
        </div>
        <button onClick={fetchHealth} disabled={loading} className="btn btn-secondary">
          {loading ? "⟳ Loading…" : "⟳ Refresh"}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom:16 }}>Cannot reach {config.label}: {error}</div>}

      {/* Latency chart */}
      <div className="card" style={{ marginBottom:16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Node Latency — Live</div>
            <div className="card-subtitle">Real ping to {config.label} fullnode</div>
          </div>
          <div style={{ display:"flex", gap:20 }}>
            {[["Avg", latAvg ? `${latAvg}ms`:"—"], ["Min", latMin ? `${latMin}ms`:"—"], ["Max", latMax ? `${latMax}ms`:"—"]].map(([l,v]) => (
              <div key={l} style={{ textAlign:"right" }}>
                <div style={{ fontSize:10, color:"var(--gray-400)", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:2 }}>{l}</div>
                <div style={{ fontFamily:"var(--font-mono)", fontSize:16, fontWeight:600, color:"var(--gray-800)" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card-body" style={{ paddingTop:12, paddingBottom:12, opacity: loading&&latHistory.length===0 ? 0.4:1, transition:"opacity 0.3s" }}>
          <LineChart data={latHistory} color="#2563eb" height={140}/>
        </div>
      </div>

      {/* Endpoint status */}
      <div className="card" style={{ marginBottom:16 }}>
        <div className="card-header">
          <div className="card-title">Endpoint Status</div>
        </div>
        <div className="card-body">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px,1fr))", gap:20 }}>
            {[
              { label:"Status",       value: health ? health.status[0].toUpperCase()+health.status.slice(1) : "—",
                ok: health?.status==="healthy" },
              { label:"Block Height", value: health?.network.blockHeight.toLocaleString() ?? "—", ok:true },
              { label:"Fullnode",     value: health?.checks?.node?.ok ? `${health.checks.node.latencyMs}ms` : (error?"Error":"—"),
                ok: health?.checks?.node?.ok },
              { label:"Ledger",       value: health?.checks?.ledger?.ok ? `${health.checks.ledger.latencyMs}ms` : (error?"Error":"—"),
                ok: health?.checks?.ledger?.ok },
            ].map(m => (
              <div key={m.label}>
                <div style={{ fontSize:11, color:"var(--gray-400)", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600, marginBottom:6 }}>{m.label}</div>
                <div style={{ fontFamily:"var(--font-mono)", fontSize:20, fontWeight:600, color: m.ok===false ? "var(--danger)" : m.ok===true && m.value!=="—" ? "var(--success)" : "var(--gray-800)" }}>
                  {loading&&!health ? <span style={{color:"var(--gray-200)"}}>—</span> : m.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Speed placeholder */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Upload & Download Speed</div>
          <div className="card-subtitle">Run the Benchmark tool to populate this chart</div>
        </div>
        <div className="card-body" style={{ textAlign:"center", padding:"40px 22px" }}>
          <div style={{ fontSize:13, color:"var(--gray-400)", marginBottom:16 }}>
            No speed data yet — run a benchmark to see real transfer measurements
          </div>
          <a href="/" className="btn btn-primary" style={{ display:"inline-flex" }}>▶ Run Benchmark →</a>
        </div>
      </div>
    </div>
  );
}