// app/dashboard/page.tsx
// Main network dashboard — fetches real blob stats and node health from Shelbynet RPC
"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Nav } from "@/components/nav";
import { StatCard, ErrorBanner, SectionHeader } from "@/components/ui";
import type { ApiResult } from "@/lib/types";

interface NetworkStatsData {
  node: { blockHeight: number; ledgerVersion: number; chainId: number } | null;
  stats: {
    totalBlobs: number | null;
    totalStorageUsedBytes: number | null;
    totalBlobEvents: number | null;
    slices: number | null;
    placementGroups: number | null;
    storageProviders: number | null;
  };
  errors: Record<string, string>;
}

interface HealthData {
  status: string;
  checks: Record<string, { ok: boolean; latencyMs: number; name: string }>;
  network: { blockHeight: number; nodeLatencyMs?: number };
}

// ── Animated Network Mesh Canvas ──────────────────────────────────────────────
function DataMesh() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const nodesRef  = useRef<{ x: number; y: number; vx: number; vy: number; pulse: number; size: number; type: string }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    nodesRef.current = [
      { x: W() * 0.5, y: H() * 0.45, vx: 0, vy: 0, pulse: 0, size: 8, type: "rpc" },
      ...Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        const r = Math.min(W(), H()) * 0.3 + (i % 3 - 1) * 28;
        return {
          x: W() * 0.5 + Math.cos(angle) * r,
          y: H() * 0.45 + Math.sin(angle) * r * 0.55,
          vx: i % 2 === 0 ? 0.07 : -0.07,
          vy: i % 3 === 0 ? 0.05 : -0.05,
          pulse: i * 0.4, size: 4 + i % 3, type: "storage",
        };
      }),
    ];

    const packets: { from: number; to: number; t: number; speed: number }[] = [];
    const spawn = () => {
      const si = Math.floor(Math.random() * 16) + 1;
      packets.push({ from: si, to: 0, t: 0, speed: 0.01 + Math.random() * 0.008 });
    };

    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W(), H());
      frame++;
      if (frame % 45 === 0 && packets.length < 10) spawn();

      const nodes = nodesRef.current;
      nodes.forEach(n => {
        if (n.type === "rpc") return;
        n.x += n.vx; n.y += n.vy; n.pulse += 0.025;
        const dx = n.x - W() * 0.5, dy = n.y - H() * 0.45;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const target = Math.min(W(), H()) * 0.3;
        const f = 0.0003 * (dist - target);
        n.vx -= dx / dist * f; n.vy -= dy / dist * f * 0.5;
        n.vx *= 0.995; n.vy *= 0.995;
        n.vx = Math.max(-0.3, Math.min(0.3, n.vx));
        n.vy = Math.max(-0.2, Math.min(0.2, n.vy));
      });

      nodes.slice(1).forEach(n => {
        const rpc = nodes[0];
        ctx.beginPath();
        ctx.moveTo(n.x, n.y); ctx.lineTo(rpc.x, rpc.y);
        ctx.strokeStyle = "rgba(5,150,105,0.1)"; ctx.lineWidth = 1;
        ctx.stroke();
      });

      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i]; p.t += p.speed;
        if (p.t >= 1) { packets.splice(i, 1); continue; }
        const from = nodes[p.from], to = nodes[p.to];
        const x = from.x + (to.x - from.x) * p.t;
        const y = from.y + (to.y - from.y) * p.t;
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(5,150,105,${0.8 - p.t * 0.5})`; ctx.fill();
      }

      nodes.forEach(n => {
        const alpha = 0.6 + Math.sin(n.pulse) * 0.4;
        if (n.type === "rpc") {
          [20, 14, 8].forEach((r, ri) => {
            ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(5,150,105,${0.04 + ri * 0.02})`; ctx.fill();
          });
          ctx.beginPath(); ctx.arc(n.x, n.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#059669"; ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(5,150,105,${alpha * 0.3})`; ctx.fill();
          ctx.beginPath(); ctx.arc(n.x, n.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(5,150,105,${alpha})`; ctx.fill();
        }
      });

      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TiB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
}
function fmtNum(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString();
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats,       setStats]       = useState<NetworkStatsData | null>(null);
  const [health,      setHealth]      = useState<HealthData | null>(null);
  const [statsErr,    setStatsErr]    = useState<string | null>(null);
  const [healthErr,   setHealthErr]   = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [statsRes, healthRes] = await Promise.allSettled([
      fetch("/api/network/stats").then(r => r.json()) as Promise<ApiResult<NetworkStatsData>>,
      fetch("/api/benchmark/health").then(r => r.json()) as Promise<HealthData>,
    ]);

    if (statsRes.status === "fulfilled") {
      const j = statsRes.value;
      if (j.ok) { setStats(j.data); setStatsErr(null); }
      else setStatsErr(j.error);
    } else {
      setStatsErr("Stats endpoint unreachable");
    }

    if (healthRes.status === "fulfilled") {
      setHealth(healthRes.value); setHealthErr(null);
    } else {
      setHealthErr("Health endpoint unreachable");
    }

    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 20_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const nodeUp = health?.status === "healthy" || health?.status === "degraded";
  const sc = nodeUp ? "#059669" : "#DC2626";
  const sl = !health ? "Checking…" : health.status === "healthy" ? "Operational" : health.status === "degraded" ? "Degraded" : "Down";

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", fontFamily: "'Outfit', sans-serif", color: "#0A0A0A" }}>
      <Nav />

      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: -1 }}>Network Dashboard</h1>
            <p style={{ fontSize: 13.5, color: "#AAA", margin: "6px 0 0" }}>
              Live data from Shelbynet RPC · refreshes every 20s
              {lastUpdated && <span style={{ marginLeft: 8, fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#CCC" }}>· {lastUpdated.toLocaleTimeString()}</span>}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: sc, boxShadow: nodeUp ? `0 0 0 3px ${sc}22` : "none" }} />
              <span style={{ fontSize: 13.5, color: sc, fontWeight: 500 }}>{sl}</span>
              {stats?.node?.chainId && <span style={{ fontSize: 12, color: "#CCC", fontFamily: "'DM Mono', monospace" }}>Chain {stats.node.chainId}</span>}
            </div>
            <button onClick={fetchAll} disabled={loading} style={{ padding: "8px 18px", background: "#F4F4F4", border: "1px solid #E8E8E8", borderRadius: 10, cursor: "pointer", fontSize: 13, color: "#555" }}>
              {loading ? "…" : "⟳ Refresh"}
            </button>
          </div>
        </div>

        {/* Errors */}
        {statsErr && <div style={{ marginBottom: 16 }}><ErrorBanner message="Network stats unavailable" detail={statsErr} onRetry={fetchAll} /></div>}
        {healthErr && <div style={{ marginBottom: 16 }}><ErrorBanner message="Health check unavailable" detail={healthErr} onRetry={fetchAll} /></div>}

        {/* Blob stats — the headline numbers from Shelby Explorer */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#AAA", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Network Statistics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
            <StatCard label="Total Blobs"       value={fmtNum(stats?.stats.totalBlobs ?? null)}                   sub={statsErr ? "API error" : "Blobs on network"}     color="#059669" />
            <StatCard label="Storage Used"      value={fmtBytes(stats?.stats.totalStorageUsedBytes ?? null)}       sub={statsErr ? "API error" : "Total data stored"}    color="#3B82F6" />
            <StatCard label="Blob Events"       value={fmtNum(stats?.stats.totalBlobEvents ?? null)}               sub={statsErr ? "API error" : "Cumulative events"}    color="#8B5CF6" />
            <StatCard label="Slices"            value={fmtNum(stats?.stats.slices ?? null)}                        sub={statsErr ? "API error" : "Erasure code slices"}  color="#D97706" />
            <StatCard label="Placement Groups"  value={fmtNum(stats?.stats.placementGroups ?? null)}               sub={statsErr ? "API error" : "Active PGs"}           color="#F97316" />
            <StatCard label="Storage Providers" value={fmtNum(stats?.stats.storageProviders ?? null)}              sub={statsErr ? "API error" : "Active on network"}    color="#059669" />
          </div>
        </div>

        {/* Chain stats */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#AAA", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Chain State</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <StatCard label="Block Height"   value={fmtNum(stats?.node?.blockHeight ?? null)}                          sub="Current chain head"           color="#059669" />
            <StatCard label="Ledger Version" value={fmtNum(stats?.node?.ledgerVersion ?? null)}                        sub="Aptos ledger version"         color="#3B82F6" />
            <StatCard label="Node Latency"   value={health?.checks?.node?.latencyMs != null ? `${health.checks.node.latencyMs}ms` : "—"} sub={health?.checks?.ledger?.latencyMs != null ? `Ledger: ${health.checks.ledger.latencyMs}ms` : "Measuring…"} color="#D97706" />
          </div>
        </div>

        {/* Network mesh + health checks */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, marginBottom: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 20, overflow: "hidden" }}>
            <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #F4F4F4" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Network Topology</div>
              <div style={{ fontSize: 12, color: "#AAA", marginTop: 2 }}>1 RPC fullnode + 16 storage providers (animated)</div>
            </div>
            <div style={{ height: 300 }}><DataMesh /></div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Endpoint checks */}
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "20px 22px", flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Endpoint Health</div>
              {health ? (
                Object.entries(health.checks).map(([key, c]: [string, any]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F8F8F8" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.ok ? "#059669" : "#DC2626" }} />
                      <span style={{ fontSize: 13.5, color: "#555" }}>{c.name ?? key}</span>
                    </div>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: c.ok ? "#059669" : "#DC2626", fontWeight: 600 }}>
                      {c.ok ? `${c.latencyMs}ms` : "Offline"}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ color: "#CCC", fontSize: 13 }}>{healthErr ?? "Loading…"}</div>
              )}
            </div>

            {/* Errors from stats */}
            {stats?.errors && Object.keys(stats.errors).length > 0 && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontWeight: 600, fontSize: 12.5, color: "#92400E", marginBottom: 8 }}>⚠️ Partial data</div>
                {Object.entries(stats.errors).map(([k, v]) => (
                  <div key={k} style={{ fontSize: 11.5, color: "#B45309", fontFamily: "'DM Mono', monospace", marginBottom: 3 }}>
                    {k}: {v}
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "#D97706", marginTop: 6 }}>Some stats may show "—" until the RPC method is available on Shelbynet.</div>
              </div>
            )}
          </div>
        </div>

        {/* CTA */}
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 16, padding: "22px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#065F46", marginBottom: 4 }}>Run a real benchmark</div>
            <div style={{ fontSize: 13, color: "#6EE7B7" }}>Upload actual blobs to Shelbynet and compare speed against AWS S3, GCP, and Azure</div>
          </div>
          <a href="/" style={{ padding: "11px 28px", borderRadius: 12, background: "#059669", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
            Run Benchmark →
          </a>
        </div>
      </div>
    </div>
  );
}