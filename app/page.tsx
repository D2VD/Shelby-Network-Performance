"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, BarChart, Bar, Cell, Legend } from "recharts";

// ── Types ─────────────────────────────────────────────────
type Phase = "idle" | "checking" | "latency" | "upload" | "download" | "txtime" | "done" | "error";
type LatencyResult  = { avg: number; min: number; max: number; samples: number[] };
type UploadResult   = { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null; blobId?: string | null; status?: string; blobSize?: number };
type DownloadResult = { bytes: number; elapsed: number; speedKbs: number };
type TxResult       = { submitTime: number; confirmTime: number; txHash: string | null };
type BenchResult    = { latency: LatencyResult; uploads: UploadResult[]; downloads: DownloadResult[]; tx: TxResult; avgUploadKbs: number; avgDownloadKbs: number; score: number };
type HistoryPt      = { run: number; score: number };

// ── Constants ─────────────────────────────────────────────
const CLOUD_REFS = {
  "AWS S3":  { upload: 85_000, download: 120_000, color: "#F97316" },
  "GCP GCS": { upload: 80_000, download: 115_000, color: "#3B82F6" },
  "Azure":   { upload: 78_000, download: 110_000, color: "#8B5CF6" },
};
const SIZE_LABELS: Record<number, string> = { 1024: "1 KB", 10240: "10 KB", 102400: "100 KB" };

// ── Helpers ───────────────────────────────────────────────
const fmt  = (k: number) => k >= 1024 ? `${(k / 1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
const fmtMs = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(2)}s` : `${m.toFixed(0)}ms`;
const pct  = (v: number, max: number) => Math.min(100, (v / max) * 100);

function score(r: { avgUploadKbs: number; avgDownloadKbs: number; latency: LatencyResult; tx: TxResult }) {
  return Math.round(pct(r.avgUploadKbs, 800) * 0.3 + pct(r.avgDownloadKbs, 1200) * 0.3 + Math.max(0, 100 - r.latency.avg / 4) * 0.25 + Math.max(0, 100 - r.tx.confirmTime / 20) * 0.15);
}

const call = async (url: string, body?: object) => {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); } catch {
    throw new Error(`Server error (${r.status}) — check that .env.local is configured with SHELBY_PRIVATE_KEY`);
  }
  if (!r.ok) throw new Error(j.error ?? `API ${r.status}`);
  return j;
};

// ── Sub-components ────────────────────────────────────────
const Tag = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: color + "15", color, border: `1px solid ${color}30` }}>{children}</span>
);

const MetricCard = ({ icon, label, value, sub, accent }: { icon: string; label: string; value: string; sub: string; accent: string }) => (
  <div style={{ padding: "20px 22px", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, borderTop: `3px solid ${accent}` }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", letterSpacing: 1, textTransform: "uppercase" }}>{label}</span>
    </div>
    <div style={{ fontSize: 26, fontWeight: 800, color: "#111827", letterSpacing: -0.5, marginBottom: 4 }}>{value}</div>
    <div style={{ fontSize: 12, color: "#6B7280" }}>{sub}</div>
  </div>
);

const LogLine = ({ text }: { text: string }) => {
  const isError   = text.startsWith("✗") || text.includes("Error") || text.includes("error");
  const isSuccess = text.startsWith("✓") || text.startsWith("Done");
  const isHeader  = text.startsWith("—");
  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 12, lineHeight: 1.8, color: isError ? "#EF4444" : isSuccess ? "#10B981" : isHeader ? "#6366F1" : "#374151", fontWeight: isHeader ? 600 : 400 }}>
      {text}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
export default function Home() {
  const [phase, setPhase]         = useState<Phase>("idle");
  const [log, setLog]             = useState<string[]>([]);
  const [progress, setProgress]   = useState(0);
  const [result, setResult]       = useState<BenchResult | null>(null);
  const [history, setHistory]     = useState<HistoryPt[]>([]);
  const [runCount, setRunCount]   = useState(0);
  const [balance, setBalance]     = useState<{ apt: number; shelbyusd: number; ready: boolean; address: string } | null>(null);
  const [balErr, setBalErr]       = useState(false);
  const [fauceting, setFauceting] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState("");
  const [health, setHealth]       = useState<any>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (t: string) => setLog(p => [...p.slice(-50), t]);

  const refreshBalance = useCallback(() => {
    call("/api/benchmark/balance")
      .then(b => { setBalance(b); setBalErr(false); })
      .catch(() => setBalErr(true));
  }, []);

  const handleFaucet = useCallback(async () => {
    setFauceting(true);
    setFaucetMsg("Requesting tokens from faucet...");
    try {
      const res = await call("/api/benchmark/faucet", {});
      if (res.errors?.length && !res.aptFauceted && !res.shelbyusdFauceted) {
        setFaucetMsg("⚠️ Auto-faucet failed. Run manually: shelby faucet --network shelbynet");
      } else {
        setFaucetMsg(res.message ?? "Faucet request sent!");
        // Refresh balance after 5s and again after 15s
        setTimeout(refreshBalance, 5000);
        setTimeout(refreshBalance, 15000);
      }
    } catch (e: any) {
      setFaucetMsg("⚠️ Faucet unavailable. Run: shelby faucet --network shelbynet");
    } finally {
      setFauceting(false);
    }
  }, [refreshBalance]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);
  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  const refreshHealth = useCallback(() => {
    fetch("/api/benchmark/health").then(r => r.json()).then(setHealth).catch(() => {});
  }, []);
  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 30_000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  const run = useCallback(async () => {
    setPhase("checking"); setLog([]); setProgress(0); setResult(null);
    try {
      addLog("— Checking wallet balance...");
      const bal = await call("/api/benchmark/balance");
      setBalance(bal); setBalErr(false);
      addLog(`  APT: ${bal.apt.toFixed(4)}    ShelbyUSD: ${bal.shelbyusd.toFixed(4)}`);
      if (!bal.ready) throw new Error(`Insufficient balance — APT: ${bal.apt.toFixed(4)}, ShelbyUSD: ${bal.shelbyusd.toFixed(4)}`);
      addLog("✓ Balance OK"); setProgress(8);

      setPhase("latency");
      addLog("— [1/4] Measuring blockchain latency...");
      const latency: LatencyResult = await call("/api/benchmark/latency");
      addLog(`  Min: ${fmtMs(latency.min)}  Avg: ${fmtMs(latency.avg)}  Max: ${fmtMs(latency.max)}`);
      addLog(`✓ Latency: ${fmtMs(latency.avg)}`); setProgress(22);

      setPhase("upload");
      addLog("— [2/4] Uploading blobs to Shelby...");
      const uploads: UploadResult[] = [];
      for (let i = 0; i < 3; i++) {
        const label = Object.values(SIZE_LABELS)[i];
        addLog(`  Uploading ${label}...`);
        // Retry up to 2 times — Shelby RPC may return 500 intermittently
        let uploadSuccess = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const u: UploadResult = await call("/api/benchmark/upload", { sizeIndex: i });
            uploads.push(u);
            addLog(`  ✓ ${label} → ${fmt(u.speedKbs)} in ${fmtMs(u.elapsed)}`);
            uploadSuccess = true;
            break;
          } catch (err: any) {
            const isServerErr = err.message?.includes("500") || err.message?.includes("Internal Server Error") || err.message?.includes("multipart");
            if (attempt < 2 && isServerErr) {
              addLog(`  ⚠ Shelby RPC error (attempt ${attempt}/2), retrying in 2s...`);
              await new Promise(r => setTimeout(r, 2000));
            } else {
              // Shelby server error — record as failed but don't crash benchmark
              addLog(`  ✗ ${label} upload failed: ${isServerErr ? "Shelby RPC server error (500)" : err.message}`);
              if (isServerErr) addLog(`  ℹ This is a Shelby network issue, not a code error`);
            }
          }
        }
        setProgress(22 + (i + 1) * 14);
      }
      if (uploads.length === 0) {
        addLog("✗ All uploads failed — Shelby RPC server is currently unavailable");
        addLog("  Continuing with latency & TX benchmark only...");
      }
      const avgUploadKbs = uploads.length > 0 ? uploads.reduce((a, b) => a + b.speedKbs, 0) / uploads.length : 0;
      if (uploads.length > 0) addLog(`✓ Avg upload: ${fmt(avgUploadKbs)} (${uploads.length}/3 succeeded)`);

      setPhase("download");
      addLog("— [3/4] Downloading blobs from Shelby...");
      const downloads: DownloadResult[] = [];
      if (uploads.length === 0) {
        addLog("  ⚠ Skipping download — no blobs were uploaded successfully");
      } else {
        for (const u of uploads) {
          addLog(`  Downloading ${SIZE_LABELS[u.bytes] ?? u.bytes + "B"}...`);
          try {
            const d: DownloadResult = await call("/api/benchmark/download", { blobName: u.blobName });
            downloads.push(d);
            addLog(`  ✓ → ${fmt(d.speedKbs)} in ${fmtMs(d.elapsed)}`);
          } catch (err: any) {
            addLog(`  ✗ Download failed: ${err.message}`);
          }
        }
      }
      const avgDownloadKbs = downloads.length > 0 ? downloads.reduce((a, b) => a + b.speedKbs, 0) / downloads.length : 0;
      if (downloads.length > 0) addLog(`✓ Avg download: ${fmt(avgDownloadKbs)}`);
      setProgress(78);

      setPhase("txtime");
      addLog("— [4/4] Measuring on-chain confirmation...");
      const tx: TxResult = await call("/api/benchmark/txtime");
      addLog(`  Submit: ${fmtMs(tx.submitTime)}  Confirm: ${fmtMs(tx.confirmTime)}`);
      if (tx.txHash) addLog(`  txHash: ${tx.txHash.slice(0, 22)}...`);
      addLog("✓ TX timing complete"); setProgress(95);

      const partial = { latency, avgUploadKbs, avgDownloadKbs, tx };
      const s = score(partial);
      const res: BenchResult = { latency, uploads, downloads, tx, avgUploadKbs, avgDownloadKbs, score: s };
      setResult(res);
      const n = runCount + 1;
      setHistory(h => [...h.slice(-9), { run: n, score: s }]);
      setRunCount(n);
      addLog(`Done  Score: ${s}/100`);
      setProgress(100); setPhase("done");
    } catch (err: any) {
      addLog(`✗ ${err.message}`); setPhase("error");
    }
  }, [runCount]);

  // ── Derived data ───────────────────────────────────────
  const radarData = result ? [
    { m: "Upload",        shelby: pct(result.avgUploadKbs, 800),    aws: 94, gcp: 89 },
    { m: "Download",      shelby: pct(result.avgDownloadKbs, 1200), aws: 97, gcp: 92 },
    { m: "Latency",       shelby: Math.max(0, 100 - result.latency.avg / 4), aws: 84, gcp: 80 },
    { m: "TX Speed",      shelby: Math.max(0, 100 - result.tx.confirmTime / 20), aws: 55, gcp: 52 },
    { m: "Cost",          shelby: 88, aws: 42, gcp: 45 },
    { m: "Decentralized", shelby: 100, aws: 0, gcp: 0 },
  ] : [];

  const barData = result ? [
    { name: "Shelby", upload: result.avgUploadKbs, download: result.avgDownloadKbs, color: "#10B981" },
    ...Object.entries(CLOUD_REFS).map(([n, v]) => ({ name: n, upload: v.upload, download: v.download, color: v.color })),
  ] : [];

  const sc = result?.score ?? 0;
  const scoreColor = sc >= 70 ? "#10B981" : sc >= 45 ? "#F59E0B" : "#EF4444";
  const scoreLabel = sc >= 80 ? "Excellent" : sc >= 65 ? "Good" : sc >= 45 ? "Average" : "Needs Work";
  const isRunning  = !["idle", "done", "error"].includes(phase);

  const phaseSteps = [
    { key: "checking", label: "Wallet check" },
    { key: "latency",  label: "Latency" },
    { key: "upload",   label: "Upload" },
    { key: "download", label: "Download" },
    { key: "txtime",   label: "TX confirm" },
  ];
  const stepIdx = phaseSteps.findIndex(s => s.key === phase);

  return (
    <div style={{ minHeight: "100vh", background: "#F9FAFB", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: "#111827" }}>

      {/* ── TOP NAV ── */}
      <nav style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Logo — thay file public/logo.png để đổi logo bất cứ lúc nào */}
          <img
            src="/logo.png"
            alt="Logo"
            width={32}
            height={32}
            style={{ borderRadius: 6, objectFit: "contain", display: "block" }}
          />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>Shelby Benchmark</span>
          <Tag color="#6366F1">Shelbynet</Tag>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
          {balance && !balErr && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Server wallet badge */}
              <div
                title={`Server wallet address: ${balance.address}\n\nThis is the backend wallet (SHELBY_PRIVATE_KEY) that pays for benchmark transactions.\nIt is different from your Petra/browser wallet.`}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", cursor: "help" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151" }}>
                  <span style={{ fontSize: 9, background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 3, padding: "1px 5px", color: "#6B7280", fontWeight: 600, letterSpacing: 0.3 }}>
                    SERVER
                  </span>
                  <span>
                    <span style={{ fontWeight: 700, color: "#111827" }}>{balance.apt.toFixed(3)}</span>
                    <span style={{ color: "#9CA3AF", marginLeft: 3 }}>APT</span>
                  </span>
                  <span style={{ color: "#E5E7EB" }}>|</span>
                  <span>
                    <span style={{ fontWeight: 700, color: balance.shelbyusd > 0.001 ? "#111827" : "#EF4444" }}>{balance.shelbyusd.toFixed(3)}</span>
                    <span style={{ color: "#9CA3AF", marginLeft: 3 }}>SUSD</span>
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#9CA3AF", textAlign: "right" }}>
                  {balance.address ? balance.address.slice(0, 6) + "…" + balance.address.slice(-4) : ""}
                </div>
              </div>
              <button onClick={refreshBalance} style={{ background: "none", border: "1px solid #E5E7EB", cursor: "pointer", color: "#6B7280", fontSize: 12, padding: "4px 8px", borderRadius: 6, lineHeight: 1 }} title="Refresh balance">⟳</button>
            </div>
          )}
          {balErr && <Tag color="#EF4444">Wallet not configured</Tag>}
          {balance?.ready && <Tag color="#10B981">Ready</Tag>}
          {balance && !balance.ready && !balErr && <Tag color="#F59E0B">Low balance</Tag>}
          <a href="https://docs.shelby.xyz" target="_blank" style={{ color: "#6B7280", textDecoration: "none", fontWeight: 500 }}>Docs ↗</a>
        </div>
      </nav>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px" }}>

        {/* ── HERO ── */}
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <img
              src="/logo.png"
              alt="Logo"
              width={64}
              height={64}
              style={{ borderRadius: 12, objectFit: "contain" }}
            />
          </div>
          <h1 style={{ fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 800, margin: "0 0 12px", letterSpacing: -1, lineHeight: 1.1 }}>
            Shelby Network Performance
          </h1>
          <p style={{ fontSize: 16, color: "#6B7280", margin: "0 auto", maxWidth: 560, lineHeight: 1.6 }}>
            Measure real upload speed, download speed, blockchain latency, and on-chain transaction confirmation time — compared against AWS S3, GCP GCS, and Azure.
          </p>
        </div>

        {/* ── NETWORK STATUS ── */}
        {(() => {
          const statusColor = !health ? "#9CA3AF" : health.status === "healthy" ? "#10B981" : health.status === "degraded" ? "#F59E0B" : "#EF4444";
          const statusLabel = !health ? "Checking..." : health.status === "healthy" ? "Operational" : health.status === "degraded" ? "Degraded" : "Down";
          const checks = health?.checks ?? {};
          const net = health?.network ?? {};

          return (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, marginBottom: 20, overflow: "hidden" }}>
              {/* Top row: status + services */}
              <div style={{ padding: "14px 20px", borderBottom: net.totalBlobs ? "1px solid #F3F4F6" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                  {/* Main status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor, boxShadow: health?.status === "healthy" ? `0 0 0 4px ${statusColor}25` : "none", flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Shelbynet</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
                  </div>

                  {/* Divider */}
                  <div style={{ width: 1, height: 20, background: "#E5E7EB" }} />

                  {/* Block height */}
                  {net.blockHeight > 0 && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", letterSpacing: 0.5, textTransform: "uppercase" }}>Block Height</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{net.blockHeight.toLocaleString()}</span>
                    </div>
                  )}

                  {/* Services */}
                  <div style={{ display: "flex", gap: 14 }}>
                    {Object.entries(checks).map(([key, c]: [string, any]) => (
                      <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.ok ? "#10B981" : "#EF4444", flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{c.name ?? key}</span>
                        </div>
                        <span style={{ fontSize: 12, color: c.ok ? "#10B981" : "#EF4444", fontWeight: 600, paddingLeft: 12 }}>
                          {c.ok ? `${c.latencyMs}ms` : "Offline"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={refreshHealth}
                  style={{ background: "none", border: "1px solid #E5E7EB", cursor: "pointer", color: "#6B7280", fontSize: 12, padding: "4px 10px", borderRadius: 6, display: "flex", alignItems: "center", gap: 4 }}
                  title="Refresh"
                >
                  ⟳ Refresh
                </button>
              </div>

              {/* Bottom row: network stats from explorer */}
              {(net.totalBlobs > 0 || net.storageProviders > 0) && (
                <div style={{ padding: "12px 20px", background: "#F9FAFB", display: "flex", gap: 28, flexWrap: "wrap" }}>
                  {[
                    { label: "Total Blobs",       value: net.totalBlobs > 0 ? net.totalBlobs.toLocaleString() : "—",                         icon: "🗄️" },
                    { label: "Storage Used",       value: net.totalStorageGB > 0 ? `${net.totalStorageGB.toFixed(2)} GB` : "—",               icon: "💾" },
                    { label: "Storage Providers",  value: net.storageProviders > 0 ? net.storageProviders.toString() : "—",                   icon: "🖥️" },
                    { label: "Placement Groups",   value: net.placementGroups > 0 ? net.placementGroups.toString() : "—",                     icon: "🔗" },
                    { label: "Total Events",       value: net.totalEvents > 0 ? net.totalEvents.toLocaleString() : "—",                       icon: "⚡" },
                  ].map(s => (
                    <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{s.icon}</span>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", letterSpacing: 0.5, textTransform: "uppercase" }}>{s.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{s.value}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                    <a href="https://explorer.shelby.xyz" target="_blank" style={{ fontSize: 11, color: "#6B7280", textDecoration: "none" }}>
                      View Explorer ↗
                    </a>
                  </div>
                </div>
              )}

              {health?.status === "down" && (
                <div style={{ margin: "0 20px 14px", padding: "8px 14px", background: "#FEF2F2", borderRadius: 8, fontSize: 12, color: "#991B1B" }}>
                  ⚠️ Shelbynet appears to be down or resetting. Shelbynet resets approximately weekly.
                </div>
              )}
            </div>
          );
        })()}

        {/* ── LOW BALANCE WARNING ── */}
        {balance && !balance.ready && !balErr && (
          <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#92400E", marginBottom: 3 }}>
                ⚠️ Insufficient balance to run benchmark
              </div>
              <div style={{ fontSize: 12, color: "#B45309" }}>
                {balance.shelbyusd === 0 && balance.apt > 0
                  ? "ShelbyUSD is 0 — needed for storage fees."
                  : balance.apt === 0
                  ? "APT is 0 — needed for gas fees."
                  : `APT: ${balance.apt.toFixed(4)}  ·  ShelbyUSD: ${balance.shelbyusd.toFixed(4)}`}
                {faucetMsg && <span style={{ display: "block", marginTop: 4, color: "#6B7280" }}>{faucetMsg}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleFaucet}
                disabled={fauceting}
                style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, background: fauceting ? "#F3F4F6" : "#111827", color: fauceting ? "#9CA3AF" : "#fff", border: "none", borderRadius: 8, cursor: fauceting ? "not-allowed" : "pointer" }}
              >
                {fauceting ? "Requesting..." : "⚡ Auto Faucet"}
              </button>
              <button
                onClick={refreshBalance}
                style={{ padding: "8px 16px", fontSize: 13, fontWeight: 500, background: "#fff", color: "#374151", border: "1px solid #D1D5DB", borderRadius: 8, cursor: "pointer" }}
              >
                ⟳ Refresh
              </button>
            </div>
          </div>
        )}

        {/* ── RUN SECTION ── */}
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "28px 32px", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                {isRunning ? "Running benchmark..." : phase === "done" ? `Completed — Run #${runCount}` : "Ready to benchmark"}
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                {isRunning ? "Real uploads/downloads happening on Shelbynet" : "Click to start a full performance test"}
              </div>
            </div>
            <button
              onClick={run}
              disabled={isRunning}
              style={{
                padding: "12px 28px", fontSize: 14, fontWeight: 600,
                background: isRunning ? "#F3F4F6" : "#111827",
                color: isRunning ? "#9CA3AF" : "#fff",
                border: "none", borderRadius: 10, cursor: isRunning ? "not-allowed" : "pointer",
                transition: "all .15s", letterSpacing: -0.2,
              }}
            >
              {isRunning ? "Running..." : phase === "done" ? "Run Again" : "▶  Run Benchmark"}
            </button>
          </div>

          {/* Progress steps */}
          {(isRunning || phase === "done") && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {phaseSteps.map((s, i) => {
                  const done   = phase === "done" || i < stepIdx;
                  const active = s.key === phase;
                  return (
                    <div key={s.key} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{
                        height: 4, borderRadius: 2, marginBottom: 6,
                        background: done ? "#10B981" : active ? "#6366F1" : "#E5E7EB",
                        transition: "background .3s",
                      }} />
                      <span style={{ fontSize: 10, color: done ? "#10B981" : active ? "#6366F1" : "#9CA3AF", fontWeight: active ? 600 : 400 }}>
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: 2, background: "#F3F4F6", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #10B981, #6366F1)", transition: "width .4s" }} />
              </div>
            </div>
          )}
        </div>

        {/* ── LOG ── */}
        {log.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, marginBottom: 28, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: isRunning ? "#10B981" : phase === "error" ? "#EF4444" : "#9CA3AF", boxShadow: isRunning ? "0 0 0 3px #10B98130" : "none" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Live Log</span>
            </div>
            <div ref={logRef} style={{ padding: "14px 20px", maxHeight: 200, overflowY: "auto", background: "#FAFAFA" }}>
              {log.map((l, i) => <LogLine key={i} text={l} />)}
              {isRunning && <span style={{ fontFamily: "monospace", fontSize: 12, color: "#6366F1" }}>▊</span>}
            </div>
          </div>
        )}

        {/* ── RESULTS ── */}
        {result && phase === "done" && (
          <>
            {/* Score banner */}
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "28px 32px", marginBottom: 24, display: "flex", alignItems: "center", gap: 32 }}>
              <div style={{ textAlign: "center", minWidth: 120 }}>
                <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1, color: scoreColor, letterSpacing: -2 }}>{result.score}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor, letterSpacing: 1, marginTop: 4 }}>{scoreLabel.toUpperCase()}</div>
              </div>
              <div style={{ flex: 1, borderLeft: "1px solid #F3F4F6", paddingLeft: 32 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Performance Score</div>
                <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6 }}>
                  Based on real measurements: upload speed (30%), download speed (30%), latency (25%), TX confirmation (15%).
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <Tag color="#10B981">Upload {fmt(result.avgUploadKbs)}</Tag>
                  <Tag color="#3B82F6">Download {fmt(result.avgDownloadKbs)}</Tag>
                  <Tag color="#F59E0B">Latency {fmtMs(result.latency.avg)}</Tag>
                  <Tag color="#8B5CF6">TX {fmtMs(result.tx.confirmTime)}</Tag>
                </div>
              </div>
            </div>

            {/* Metric cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 24 }}>
              <MetricCard icon="⬆️" label="Avg Upload Speed" value={fmt(result.avgUploadKbs)} sub={`Cloud ref: ${fmt(CLOUD_REFS["AWS S3"].upload)}`} accent="#10B981" />
              <MetricCard icon="⬇️" label="Avg Download Speed" value={fmt(result.avgDownloadKbs)} sub={`Cloud ref: ${fmt(CLOUD_REFS["AWS S3"].download)}`} accent="#3B82F6" />
              <MetricCard icon="⚡" label="Blockchain Latency" value={fmtMs(result.latency.avg)} sub={`Min ${fmtMs(result.latency.min)} · Max ${fmtMs(result.latency.max)}`} accent="#F59E0B" />
              <MetricCard icon="⛓️" label="TX Confirmation" value={fmtMs(result.tx.confirmTime)} sub={result.tx.txHash ? `Hash: ${result.tx.txHash.slice(0, 16)}...` : "Aptos finality"} accent="#8B5CF6" />
            </div>

            {/* Per-size table */}
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, marginBottom: 24, overflow: "hidden" }}>
              <div style={{ padding: "16px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Blob Results</div>
                  <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>Real uploads & downloads on Shelbynet</div>
                </div>
                <Tag color="#10B981">{result.uploads.length} blobs uploaded</Tag>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    {["Size", "Blob Status", "Upload Speed", "Download Speed", "Time", "Tx Hash"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6B7280", letterSpacing: 0.5, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.uploads.map((u, i) => {
                    const d = result.downloads[i];
                    const blobStatus = u.status ?? "uploaded";
                    const statusOk = blobStatus === "uploaded" || blobStatus === "confirmed" || blobStatus === "stored";
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 700, fontSize: 13 }}>{SIZE_LABELS[u.bytes] ?? u.bytes + "B"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                              background: statusOk ? "#D1FAE5" : "#FEF3C7",
                              color: statusOk ? "#065F46" : "#92400E",
                            }}>
                              <span>{statusOk ? "✓" : "⏳"}</span>
                              {blobStatus.charAt(0).toUpperCase() + blobStatus.slice(1)}
                            </span>
                            {u.blobName && (
                              <span style={{ fontSize: 10, color: "#9CA3AF", fontFamily: "monospace" }}>
                                {u.blobName.length > 22 ? u.blobName.slice(0, 22) + "…" : u.blobName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#10B981", fontWeight: 600 }}>{fmt(u.speedKbs)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#3B82F6", fontWeight: 600 }}>{d ? fmt(d.speedKbs) : "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: "#6B7280" }}>
                          <div>↑ {fmtMs(u.elapsed)}</div>
                          {d && <div style={{ color: "#9CA3AF" }}>↓ {fmtMs(d.elapsed)}</div>}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          {u.txHash ? (
                            <a href={`https://explorer.aptoslabs.com/txn/${u.txHash}?network=shelbynet`} target="_blank" style={{ fontSize: 12, color: "#6366F1", textDecoration: "none", fontWeight: 500, fontFamily: "monospace" }}>
                              {u.txHash.slice(0, 12)}… ↗
                            </a>
                          ) : <span style={{ fontSize: 12, color: "#D1D5DB" }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Charts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              {/* Radar */}
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "20px 24px" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Multi-Dimensional Comparison</div>
                <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>Shelby vs AWS S3 vs GCP GCS</div>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#F3F4F6" />
                    <PolarAngleAxis dataKey="m" tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name="AWS S3"  dataKey="aws"    stroke="#F9731640" fill="#F9731608" />
                    <Radar name="GCP GCS" dataKey="gcp"    stroke="#3B82F640" fill="#3B82F608" />
                    <Radar name="Shelby"  dataKey="shelby" stroke="#10B981"   fill="#10B98118" strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                  {[["#10B981", "Shelby"], ["#F97316", "AWS S3"], ["#3B82F6", "GCP GCS"]].map(([c, l]) => (
                    <span key={l} style={{ fontSize: 11, color: "#6B7280", display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />{l}
                    </span>
                  ))}
                </div>
              </div>

              {/* History */}
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "20px 24px" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Score History</div>
                <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>Performance across runs</div>
                {history.length > 1 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10B981" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#F3F4F6" />
                      <XAxis dataKey="run" tick={{ fill: "#9CA3AF", fontSize: 10 }} tickFormatter={v => `#${v}`} />
                      <YAxis domain={[0, 100]} tick={{ fill: "#9CA3AF", fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="score" stroke="#10B981" fill="url(#sg)" strokeWidth={2} dot={{ fill: "#10B981", r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 240, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9CA3AF", gap: 8 }}>
                    <span style={{ fontSize: 28 }}>📊</span>
                    <span style={{ fontSize: 13 }}>Run again to see trends</span>
                  </div>
                )}
              </div>
            </div>

            {/* Speed comparison */}
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "20px 24px", marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Speed Comparison</div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>
                Shelby = real measured · Cloud = industry benchmark
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} barCategoryGap="30%">
                  <CartesianGrid stroke="#F3F4F6" />
                  <XAxis dataKey="name" tick={{ fill: "#9CA3AF", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#9CA3AF", fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12 }} formatter={(v: number, n: string) => [fmt(v), n === "upload" ? "Upload" : "Download"]} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#6B7280" }} />
                  <Bar dataKey="upload" name="Upload" radius={[4, 4, 0, 0]}>{barData.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar>
                  <Bar dataKey="download" name="Download" radius={[4, 4, 0, 0]}>{barData.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.4} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* About section */}
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "24px 32px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>About Shelby Protocol</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
                {[
                  { icon: "🔗", t: "Decentralized", d: "Data distributed across global Storage Providers — no single point of failure." },
                  { icon: "💰", t: "~70% Cheaper", d: "Significantly lower cost vs AWS S3, GCP GCS via decentralized economics." },
                  { icon: "⚡", t: "Hot Storage", d: "Sub-second data access, on par with traditional cloud storage." },
                  { icon: "🛡️", t: "Immutable", d: "Every upload anchored to Aptos blockchain — tamper-proof by design." },
                ].map(f => (
                  <div key={f.t}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{f.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{f.t}</div>
                    <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>{f.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── EMPTY STATE ── */}
        {phase === "idle" && (
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "48px 32px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🗄️</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No data yet</div>
            <div style={{ fontSize: 13, color: "#9CA3AF", maxWidth: 380, margin: "0 auto" }}>
              Click "Run Benchmark" to start a real performance test on Shelbynet. Files will be uploaded and downloaded using the Shelby SDK.
            </div>
          </div>
        )}
      </div>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid #E5E7EB", background: "#fff", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 40 }}>
        <span style={{ fontSize: 12, color: "#9CA3AF" }}>
          © 2026 Shelby Benchmark · Powered by{" "}
          <a href="https://shelby.xyz" target="_blank" style={{ color: "#10B981", textDecoration: "none", fontWeight: 600 }}>Shelby Protocol</a>
          {" "}& Aptos Blockchain
        </span>
        <div style={{ display: "flex", gap: 20, fontSize: 12 }}>
          <a href="https://shelby.xyz"        target="_blank" style={{ color: "#6B7280", textDecoration: "none" }}>shelby.xyz</a>
          <a href="https://docs.shelby.xyz"   target="_blank" style={{ color: "#6B7280", textDecoration: "none" }}>Docs</a>
          <a href="https://explorer.aptoslabs.com" target="_blank" style={{ color: "#6B7280", textDecoration: "none" }}>Aptos Explorer</a>
        </div>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        button:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
      `}</style>
    </div>
  );
}