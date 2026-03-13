// 📁 app/page.tsx
"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Nav } from "@/components/nav";
import { StatCard as _StatCard, ErrorBanner } from "@/components/ui";
import { RadarChart, ScoreHistoryChart } from "@/components/charts";

// ── Types ──────────────────────────────────────────────────────────────────────
type Phase = "idle" | "checking" | "latency" | "upload" | "download" | "txtime" | "done" | "error";
type LatencyResult  = { avg: number; min: number; max: number; samples: number[] };
type UploadResult   = { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null; status?: string };
type DownloadResult = { bytes: number; elapsed: number; speedKbs: number };
type TxResult       = { submitTime: number; confirmTime: number; txHash: string | null };
type BenchResult    = { latency: LatencyResult; uploads: UploadResult[]; downloads: DownloadResult[]; tx: TxResult; avgUploadKbs: number; avgDownloadKbs: number; score: number };
type HistoryPt      = { run: number; score: number };
type BalanceData    = { apt: number; shelbyusd: number; ready: boolean; address: string };
type HealthData     = { status: string; checks: Record<string, { ok: boolean; latencyMs: number; name: string }>; network: any };

const CLOUD_REFS = {
  "AWS S3":  { upload: 85_000, download: 120_000 },
  "GCP GCS": { upload: 80_000, download: 115_000 },
  "Azure":   { upload: 78_000, download: 110_000 },
};
const SIZE_LABELS: Record<number, string> = { 1024: "1 KB", 10240: "10 KB", 102400: "100 KB" };

const fmt   = (k: number) => k >= 1024 ? `${(k/1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
const fmtMs = (m: number) => m >= 1000 ? `${(m/1000).toFixed(2)}s` : `${m.toFixed(0)}ms`;
const pct   = (v: number, max: number) => Math.min(100, (v/max)*100);

function calcScore(r: { avgUploadKbs: number; avgDownloadKbs: number; latency: LatencyResult; tx: TxResult }) {
  return Math.round(pct(r.avgUploadKbs,800)*0.3 + pct(r.avgDownloadKbs,1200)*0.3 + Math.max(0,100-r.latency.avg/4)*0.25 + Math.max(0,100-r.tx.confirmTime/20)*0.15);
}

const call = async (url: string, body?: object) => {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`Server error (${r.status})`); }
  if (!r.ok) throw new Error(j.error ?? `API ${r.status}`);
  return j;
};

// StatCard imported from @/components/ui as _StatCard
const StatCard = _StatCard;

// ── Log Line ──────────────────────────────────────────────────────────────────
function LogLine({ text }: { text: string }) {
  const isErr = text.startsWith("✗") || (text.includes("Error") && !text.includes("✓"));
  const isOk  = text.startsWith("✓") || text.startsWith("Done");
  const isHdr = text.startsWith("—");
  return (
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12.5, lineHeight: 1.8,
      color: isErr ? "#DC2626" : isOk ? "#059669" : isHdr ? "#6366F1" : "#555",
      fontWeight: isHdr ? 500 : 400 }}>
      {text}
    </div>
  );
}

// ── SVG Charts ────────────────────────────────────────────────────────────────
function RadarSVG({ data }: { data: { m: string; shelby: number; aws: number; gcp: number }[] }) {
  if (!data.length) return <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#CCC", fontSize: 13 }}>Run benchmark first</div>;
  const cx = 130, cy = 110, R = 88, n = data.length;
  const angle = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const pt = (i: number, val: number) => { const r = (val/100)*R; return `${(cx+Math.cos(angle(i))*r).toFixed(1)},${(cy+Math.sin(angle(i))*r).toFixed(1)}`; };
  return (
    <svg viewBox="0 0 260 230" style={{ width: "100%", height: 200 }}>
      {[25,50,75,100].map(g => <polygon key={g} points={Array.from({length:n},(_,i)=>{const r=(g/100)*R;return `${(cx+Math.cos(angle(i))*r).toFixed(1)},${(cy+Math.sin(angle(i))*r).toFixed(1)}`;}).join(" ")} fill="none" stroke="#F0F0F0" strokeWidth={1} />)}
      {data.map((_,i)=><line key={i} x1={cx} y1={cy} x2={(cx+Math.cos(angle(i))*R).toFixed(1)} y2={(cy+Math.sin(angle(i))*R).toFixed(1)} stroke="#E8E8E8" strokeWidth={1}/>)}
      <polygon points={data.map((d,i)=>pt(i,d.aws)).join(" ")}    fill="rgba(249,115,22,0.08)" stroke="#F97316" strokeWidth={1.5} />
      <polygon points={data.map((d,i)=>pt(i,d.gcp)).join(" ")}    fill="rgba(59,130,246,0.08)"  stroke="#3B82F6" strokeWidth={1.5} />
      <polygon points={data.map((d,i)=>pt(i,d.shelby)).join(" ")} fill="rgba(5,150,105,0.12)"   stroke="#059669" strokeWidth={2}   />
      {data.map((d,i)=><text key={i} x={(cx+Math.cos(angle(i))*(R+16)).toFixed(1)} y={(cy+Math.sin(angle(i))*(R+16)).toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#888">{d.m}</text>)}
    </svg>
  );
}

function HistorySVG({ history }: { history: HistoryPt[] }) {
  if (history.length < 2) return <div style={{ height: 180, display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,color:"#CCC" }}><span style={{fontSize:28}}>📈</span><span style={{fontSize:13}}>Run again to see trend</span></div>;
  const W=400,H=170,pad={t:10,b:24,l:28,r:8};
  const iW=W-pad.l-pad.r,iH=H-pad.t-pad.b;
  const xs=history.map((_,i)=>pad.l+(i/(history.length-1))*iW);
  const ys=history.map(d=>pad.t+iH-(d.score/100)*iH);
  const linePts=xs.map((x,i)=>`${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const areaPts=`${pad.l},${pad.t+iH} ${linePts} ${(pad.l+iW).toFixed(1)},${pad.t+iH}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:170}}>
      <defs><linearGradient id="hg2" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#059669" stopOpacity={0.15}/><stop offset="100%" stopColor="#059669" stopOpacity={0}/></linearGradient></defs>
      {[0,25,50,75,100].map(v=>{const y=pad.t+iH-(v/100)*iH;return <g key={v}><line x1={pad.l} x2={pad.l+iW} y1={y} y2={y} stroke="#F4F4F4"/><text x={pad.l-4} y={y+3} textAnchor="end" fontSize={8} fill="#CCC">{v}</text></g>;})}
      <polygon points={areaPts} fill="url(#hg2)"/>
      <polyline points={linePts} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round"/>
      {xs.map((x,i)=><g key={i}><circle cx={x} cy={ys[i]} r={4} fill="#059669" stroke="#fff" strokeWidth={2}/><text x={x} y={pad.t+iH+13} textAnchor="middle" fontSize={8} fill="#CCC">#{history[i].run}</text></g>)}
    </svg>
  );
}

function SpeedSVG({ barData }: { barData: { name: string; upload: number; download: number; color: string }[] }) {
  if (!barData.length) return <div style={{height:140,display:"flex",alignItems:"center",justifyContent:"center",color:"#CCC",fontSize:13}}>Run benchmark first</div>;
  const W=560,H=160,pad={t:10,b:28,l:42,r:12};
  const iW=W-pad.l-pad.r,iH=H-pad.t-pad.b;
  const maxV=Math.max(...barData.flatMap(d=>[d.upload,d.download]),1);
  const slotW=iW/barData.length,bW=slotW*0.27;
  const colors=["#059669","#F97316","#3B82F6","#8B5CF6"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:145}}>
      {[0,.25,.5,.75,1].map(f=>{const y=pad.t+iH-f*iH;return <g key={f}><line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke="#F4F4F4"/><text x={pad.l-4} y={y+3} textAnchor="end" fontSize={8} fill="#CCC">{Math.round(f*maxV/1000)}K</text></g>;})}
      {barData.map((d,i)=>{const cx=pad.l+i*slotW+slotW/2,c=colors[i%colors.length],hU=(d.upload/maxV)*iH,hD=(d.download/maxV)*iH;return <g key={i}><rect x={cx-bW-1} y={pad.t+iH-hU} width={bW} height={hU} fill={c} rx={2}/><rect x={cx+1} y={pad.t+iH-hD} width={bW} height={hD} fill={c} fillOpacity={0.35} rx={2}/><text x={cx} y={pad.t+iH+14} textAnchor="middle" fontSize={10} fill="#AAA">{d.name}</text></g>;})}
    </svg>
  );
}

// ── Network Status ─────────────────────────────────────────────────────────────
function NetworkStatus({ health, onRefresh }: { health: HealthData | null; onRefresh: () => void }) {
  const sc  = !health ? "#CCC" : health.status === "healthy" ? "#059669" : health.status === "degraded" ? "#D97706" : "#DC2626";
  const sl  = !health ? "Checking…" : health.status === "healthy" ? "Operational" : health.status === "degraded" ? "Degraded" : "Down";
  const checks = health?.checks ?? {};
  const net    = health?.network ?? {};
  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: sc, boxShadow: health?.status === "healthy" ? `0 0 0 3px ${sc}22` : "none" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A" }}>Shelbynet</span>
            <span style={{ fontSize: 13, color: sc, fontWeight: 500 }}>{sl}</span>
          </div>
          {net.blockHeight > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, color: "#CCC", textTransform: "uppercase", letterSpacing: "0.06em" }}>Block</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A", fontFamily: "'DM Mono', monospace" }}>{net.blockHeight.toLocaleString()}</div>
            </div>
          )}
          {Object.entries(checks).map(([key, c]: [string, any]) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.ok ? "#059669" : "#DC2626" }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: "#555" }}>{c.name ?? key}</span>
              </div>
              <span style={{ fontSize: 12, color: c.ok ? "#059669" : "#DC2626", fontFamily: "'DM Mono', monospace", paddingLeft: 11 }}>{c.ok ? `${c.latencyMs}ms` : "Offline"}</span>
            </div>
          ))}
        </div>
        <button onClick={onRefresh} style={{ background: "#F6F6F6", border: "1px solid #E8E8E8", cursor: "pointer", color: "#666", fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>⟳ Refresh</button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [phase, setPhase]         = useState<Phase>("idle");
  const [log, setLog]             = useState<string[]>([]);
  const [progress, setProgress]   = useState(0);
  const [result, setResult]       = useState<BenchResult | null>(null);
  const [history, setHistory]     = useState<HistoryPt[]>([]);
  const [runCount, setRunCount]   = useState(0);
  const [balance, setBalance]     = useState<BalanceData | null>(null);
  const [balErr, setBalErr]       = useState(false);
  const [fauceting, setFauceting] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState("");
  const [health, setHealth]       = useState<HealthData | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (t: string) => setLog(p => [...p.slice(-60), t]);

  const refreshBalance = useCallback(() => {
    call("/api/benchmark/balance").then(b => { setBalance(b); setBalErr(false); }).catch(() => setBalErr(true));
  }, []);

  const handleFaucet = useCallback(async () => {
    setFauceting(true); setFaucetMsg("Requesting tokens…");
    try {
      const res = await call("/api/benchmark/faucet", {});
      setFaucetMsg(res.errors?.length && !res.aptFauceted ? "⚠️ Auto-faucet failed. Run: shelby faucet --network shelbynet" : res.message ?? "Tokens requested!");
      setTimeout(refreshBalance, 5000); setTimeout(refreshBalance, 15000);
    } catch { setFaucetMsg("⚠️ Faucet unavailable."); } finally { setFauceting(false); }
  }, [refreshBalance]);

  const refreshHealth = useCallback(() => {
    fetch("/api/benchmark/health").then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);
  useEffect(() => { refreshBalance(); }, [refreshBalance]);
  useEffect(() => { refreshHealth(); const id = setInterval(refreshHealth, 30_000); return () => clearInterval(id); }, [refreshHealth]);

  const run = useCallback(async () => {
    setPhase("checking"); setLog([]); setProgress(0); setResult(null);
    try {
      addLog("— Checking wallet balance…");
      const bal = await call("/api/benchmark/balance");
      setBalance(bal); setBalErr(false);
      addLog(`  APT: ${bal.apt.toFixed(4)}  ·  ShelbyUSD: ${bal.shelbyusd.toFixed(4)}`);
      if (!bal.ready) throw new Error(`Insufficient balance — APT: ${bal.apt.toFixed(4)}, ShelbyUSD: ${bal.shelbyusd.toFixed(4)}`);
      addLog("✓ Balance OK"); setProgress(8);

      setPhase("latency");
      addLog("— [1/4] Measuring blockchain latency…");
      const latency: LatencyResult = await call("/api/benchmark/latency");
      addLog(`  Min: ${fmtMs(latency.min)}  ·  Avg: ${fmtMs(latency.avg)}  ·  Max: ${fmtMs(latency.max)}`);
      addLog(`✓ Latency: ${fmtMs(latency.avg)}`); setProgress(22);

      setPhase("upload");
      addLog("— [2/4] Uploading blobs to Shelby…");
      const uploads: UploadResult[] = [];
      for (let i = 0; i < 3; i++) {
        const label = Object.values(SIZE_LABELS)[i];
        addLog(`  Uploading ${label}…`);
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const u: UploadResult = await call("/api/benchmark/upload", { sizeIndex: i });
            uploads.push(u); addLog(`  ✓ ${label} → ${fmt(u.speedKbs)} in ${fmtMs(u.elapsed)}`); break;
          } catch (err: any) {
            const isServerErr = err.message?.includes("500") || err.message?.includes("multipart");
            if (attempt < 2 && isServerErr) { addLog(`  ⚠ RPC error, retrying…`); await new Promise(r=>setTimeout(r,2000)); }
            else { addLog(`  ✗ ${label}: ${isServerErr ? "Shelby RPC error (500)" : err.message}`); }
          }
        }
        setProgress(22 + (i+1)*14);
      }
      const avgUploadKbs = uploads.length > 0 ? uploads.reduce((a,b) => a+b.speedKbs, 0)/uploads.length : 0;
      if (uploads.length > 0) addLog(`✓ Avg upload: ${fmt(avgUploadKbs)} (${uploads.length}/3)`);
      else addLog("  ⚠ All uploads failed — continuing with latency & TX only");

      setPhase("download");
      addLog("— [3/4] Downloading blobs…");
      const downloads: DownloadResult[] = [];
      if (uploads.length === 0) { addLog("  ⚠ Skipping — no blobs uploaded"); }
      else {
        for (const u of uploads) {
          try {
            const d: DownloadResult = await call("/api/benchmark/download", { blobName: u.blobName });
            downloads.push(d); addLog(`  ✓ → ${fmt(d.speedKbs)} in ${fmtMs(d.elapsed)}`);
          } catch (err: any) { addLog(`  ✗ Download failed: ${err.message}`); }
        }
      }
      const avgDownloadKbs = downloads.length > 0 ? downloads.reduce((a,b) => a+b.speedKbs,0)/downloads.length : 0;
      if (downloads.length > 0) addLog(`✓ Avg download: ${fmt(avgDownloadKbs)}`);
      setProgress(78);

      setPhase("txtime");
      addLog("— [4/4] Measuring on-chain confirmation…");
      const tx: TxResult = await call("/api/benchmark/txtime");
      addLog(`  Submit: ${fmtMs(tx.submitTime)}  ·  Confirm: ${fmtMs(tx.confirmTime)}`);
      if (tx.txHash) addLog(`  txHash: ${tx.txHash.slice(0,22)}…`);
      addLog("✓ TX complete"); setProgress(95);

      const sc = calcScore({ latency, avgUploadKbs, avgDownloadKbs, tx });
      const res: BenchResult = { latency, uploads, downloads, tx, avgUploadKbs, avgDownloadKbs, score: sc };
      setResult(res);
      const n = runCount + 1;
      setHistory(h => [...h.slice(-9), { run: n, score: sc }]);
      setRunCount(n);
      addLog(`Done  Score: ${sc}/100`);
      setProgress(100); setPhase("done");
    } catch (err: any) { addLog(`✗ ${err.message}`); setPhase("error"); }
  }, [runCount]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const radarData = result ? [
    { m: "Upload",    shelby: pct(result.avgUploadKbs,800),                        aws: 94, gcp: 89 },
    { m: "Download",  shelby: pct(result.avgDownloadKbs,1200),                      aws: 97, gcp: 92 },
    { m: "Latency",   shelby: Math.max(0,100-result.latency.avg/4),                 aws: 84, gcp: 80 },
    { m: "TX Speed",  shelby: Math.max(0,100-result.tx.confirmTime/20),             aws: 55, gcp: 52 },
    { m: "Cost",      shelby: 88,  aws: 42, gcp: 45 },
    { m: "Decent.",   shelby: 100, aws: 0,  gcp: 0  },
  ] : [];

  const barData = result ? [
    { name: "Shelby",  upload: result.avgUploadKbs,      download: result.avgDownloadKbs,        color: "#059669" },
    { name: "AWS S3",  upload: CLOUD_REFS["AWS S3"].upload, download: CLOUD_REFS["AWS S3"].download, color: "#F97316" },
    { name: "GCP GCS", upload: CLOUD_REFS["GCP GCS"].upload,download: CLOUD_REFS["GCP GCS"].download,color: "#3B82F6" },
    { name: "Azure",   upload: CLOUD_REFS["Azure"].upload,  download: CLOUD_REFS["Azure"].download,  color: "#8B5CF6" },
  ] : [];

  const sc         = result?.score ?? 0;
  const scoreColor = sc >= 70 ? "#059669" : sc >= 45 ? "#D97706" : "#DC2626";
  const scoreLabel = sc >= 80 ? "Excellent" : sc >= 65 ? "Good" : sc >= 45 ? "Average" : "Needs Work";
  const isRunning  = !["idle","done","error"].includes(phase);
  const phaseSteps = [
    { key: "checking", label: "Balance"  },
    { key: "latency",  label: "Latency"  },
    { key: "upload",   label: "Upload"   },
    { key: "download", label: "Download" },
    { key: "txtime",   label: "TX Time"  },
  ];
  const stepIdx = phaseSteps.findIndex(s => s.key === phase);

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", fontFamily: "'Outfit', sans-serif", color: "#0A0A0A" }}>
      <Nav apt={balance?.apt} shelbyusd={balance?.shelbyusd} address={balance?.address} />

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* ── HERO ── */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 20, padding: "5px 14px", marginBottom: 20 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#059669" }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: "#059669" }}>Shelbynet — Live Testnet</span>
          </div>
          <h1 style={{ fontSize: "clamp(28px,5vw,48px)", fontWeight: 800, margin: "0 0 16px", letterSpacing: -1.5, lineHeight: 1.05 }}>
            Shelby Network
            <span style={{ display: "block", color: "#059669" }}>Performance Benchmark</span>
          </h1>
          <p style={{ fontSize: 16, color: "#888", margin: "0 auto", maxWidth: 520, lineHeight: 1.65 }}>
            Real upload speed, download speed, blockchain latency, and on-chain transaction time — compared live against AWS S3, GCP, and Azure.
          </p>
        </div>

        {/* ── NETWORK STATUS ── */}
        <NetworkStatus health={health} onRefresh={refreshHealth} />

        {/* ── LOW BALANCE WARNING ── */}
        {balance && !balance.ready && !balErr && (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 14, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#92400E", marginBottom: 3 }}>⚠️ Insufficient balance to run benchmark</div>
              <div style={{ fontSize: 13, color: "#B45309" }}>
                {balance.shelbyusd === 0 ? "ShelbyUSD is 0 — needed for storage fees." : balance.apt === 0 ? "APT is 0 — needed for gas." : `APT: ${balance.apt.toFixed(4)} · ShelbyUSD: ${balance.shelbyusd.toFixed(4)}`}
                {faucetMsg && <span style={{ display: "block", marginTop: 3, color: "#888" }}>{faucetMsg}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleFaucet} disabled={fauceting} style={{ padding: "9px 20px", fontSize: 13, fontWeight: 600, background: fauceting ? "#F4F4F4" : "#0A0A0A", color: fauceting ? "#AAA" : "#fff", border: "none", borderRadius: 10, cursor: fauceting ? "not-allowed" : "pointer" }}>
                {fauceting ? "Requesting…" : "⚡ Auto Faucet"}
              </button>
              <button onClick={refreshBalance} style={{ padding: "9px 18px", fontSize: 13, background: "#fff", color: "#555", border: "1px solid #E0E0E0", borderRadius: 10, cursor: "pointer" }}>⟳ Refresh</button>
            </div>
          </div>
        )}

        {/* ── RUN CARD ── */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 20, padding: "32px 36px", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6, letterSpacing: -0.3 }}>
                {isRunning ? "Running benchmark…" : phase === "done" ? `Run #${runCount} complete` : "Ready to benchmark"}
              </div>
              <div style={{ fontSize: 13.5, color: "#888" }}>
                {isRunning ? "Uploading real blobs to Shelbynet, measuring speed & latency" : phase === "done" ? "Benchmark complete — results below" : "Click to start a full performance test against Shelbynet"}
              </div>
            </div>
            <button onClick={run} disabled={isRunning} style={{
              padding: "14px 36px", fontSize: 15, fontWeight: 700,
              background: isRunning ? "#F4F4F4" : "#0A0A0A",
              color: isRunning ? "#BBB" : "#fff",
              border: "none", borderRadius: 14, cursor: isRunning ? "not-allowed" : "pointer",
              letterSpacing: -0.2, transition: "all .15s",
            }}>
              {isRunning ? "Running…" : phase === "done" ? "Run Again" : "▶  Run Benchmark"}
            </button>
          </div>

          {(isRunning || phase === "done") && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {phaseSteps.map((s, i) => {
                  const done   = phase === "done" || i < stepIdx;
                  const active = s.key === phase;
                  return (
                    <div key={s.key} style={{ flex: 1 }}>
                      <div style={{ height: 3, borderRadius: 2, background: done ? "#059669" : active ? "#6366F1" : "#F0F0F0", transition: "background .3s", marginBottom: 5 }} />
                      <span style={{ fontSize: 11, color: done ? "#059669" : active ? "#6366F1" : "#CCC", fontWeight: active ? 600 : 400 }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: 3, background: "#F4F4F4", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#059669,#6366F1)", transition: "width .4s" }} />
              </div>
            </div>
          )}
        </div>

        {/* ── LOG ── */}
        {log.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, marginBottom: 32, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #F4F4F4", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: isRunning ? "#059669" : phase === "error" ? "#DC2626" : "#CCC", boxShadow: isRunning ? "0 0 0 3px #05996930" : "none" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>Live Output</span>
            </div>
            <div ref={logRef} style={{ padding: "14px 20px", maxHeight: 220, overflowY: "auto", background: "#FDFDFD" }}>
              {log.map((l, i) => <LogLine key={i} text={l} />)}
              {isRunning && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#6366F1" }}>▊</span>}
            </div>
          </div>
        )}

        {/* ── RESULTS ── */}
        {result && phase === "done" && (
          <>
            {/* Score */}
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 20, padding: "32px 36px", marginBottom: 24, display: "flex", alignItems: "center", gap: 36 }}>
              <div style={{ textAlign: "center", minWidth: 130 }}>
                <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1, color: scoreColor, letterSpacing: -3, fontFamily: "'DM Mono', monospace" }}>{result.score}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: scoreColor, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>{scoreLabel}</div>
              </div>
              <div style={{ flex: 1, borderLeft: "1px solid #F0F0F0", paddingLeft: 36 }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, letterSpacing: -0.3 }}>Performance Score</div>
                <div style={{ fontSize: 13.5, color: "#888", lineHeight: 1.65, marginBottom: 16 }}>
                  Composite score from real measurements: upload (30%), download (30%), latency (25%), TX confirmation (15%).
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { label: "Upload",   value: fmt(result.avgUploadKbs),   color: "#059669" },
                    { label: "Download", value: fmt(result.avgDownloadKbs), color: "#3B82F6" },
                    { label: "Latency",  value: fmtMs(result.latency.avg),  color: "#D97706" },
                    { label: "TX",       value: fmtMs(result.tx.confirmTime),color: "#8B5CF6" },
                  ].map(t => (
                    <span key={t.label} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: t.color + "12", color: t.color, border: `1px solid ${t.color}25` }}>
                      {t.label}: {t.value}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Metric cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: 24 }}>
              <StatCard label="Avg Upload Speed"   value={fmt(result.avgUploadKbs)}   sub={`Cloud ref: ${fmt(CLOUD_REFS["AWS S3"].upload)}`}   color="#059669" />
              <StatCard label="Avg Download Speed" value={fmt(result.avgDownloadKbs)} sub={`Cloud ref: ${fmt(CLOUD_REFS["AWS S3"].download)}`} color="#3B82F6" />
              <StatCard label="Blockchain Latency" value={fmtMs(result.latency.avg)} sub={`Min ${fmtMs(result.latency.min)} · Max ${fmtMs(result.latency.max)}`} color="#D97706" />
              <StatCard label="TX Confirmation"    value={fmtMs(result.tx.confirmTime)} sub={result.tx.txHash ? `Hash: ${result.tx.txHash.slice(0,14)}…` : "Aptos finality"} color="#8B5CF6" />
            </div>

            {/* Blob results table */}
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, marginBottom: 24, overflow: "hidden" }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid #F4F4F4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Blob Transfer Results</div>
                  <div style={{ fontSize: 12.5, color: "#AAA", marginTop: 2 }}>Real uploads and downloads on Shelbynet</div>
                </div>
                <span style={{ padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#F0FDF4", color: "#059669", border: "1px solid #BBF7D0" }}>
                  {result.uploads.length} blob{result.uploads.length !== 1 ? "s" : ""} uploaded
                </span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#FAFAFA" }}>
                    {["Size", "Status", "Upload Speed", "Download Speed", "Time", "Tx Hash"].map(h => (
                      <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#AAA", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.uploads.map((u, i) => {
                    const d = result.downloads[i];
                    const ok = !u.status || ["uploaded","confirmed","stored"].includes(u.status);
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #F4F4F4" }}>
                        <td style={{ padding: "13px 18px", fontWeight: 700, fontSize: 13.5, fontFamily: "'DM Mono', monospace" }}>{SIZE_LABELS[u.bytes] ?? u.bytes+"B"}</td>
                        <td style={{ padding: "13px 18px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: ok?"#F0FDF4":"#FFFBEB", color: ok?"#059669":"#92400E" }}>
                            {ok ? "✓" : "⏳"} {(u.status ?? "uploaded").charAt(0).toUpperCase()+(u.status ?? "uploaded").slice(1)}
                          </span>
                        </td>
                        <td style={{ padding: "13px 18px", fontSize: 13.5, color: "#059669", fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{fmt(u.speedKbs)}</td>
                        <td style={{ padding: "13px 18px", fontSize: 13.5, color: "#3B82F6", fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{d ? fmt(d.speedKbs) : "—"}</td>
                        <td style={{ padding: "13px 18px", fontSize: 12, color: "#AAA", fontFamily: "'DM Mono', monospace" }}>
                          <div>↑ {fmtMs(u.elapsed)}</div>
                          {d && <div>↓ {fmtMs(d.elapsed)}</div>}
                        </td>
                        <td style={{ padding: "13px 18px" }}>
                          {u.txHash
                            ? <a href={`https://explorer.aptoslabs.com/txn/${u.txHash}?network=shelbynet`} target="_blank" style={{ fontSize: 12, color: "#6366F1", textDecoration: "none", fontFamily: "'DM Mono', monospace" }}>{u.txHash.slice(0,12)}… ↗</a>
                            : <span style={{ fontSize: 12, color: "#DDD" }}>—</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Charts 2-col */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "22px 24px" }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3 }}>Multi-Dimensional Comparison</div>
                <div style={{ fontSize: 12, color: "#AAA", marginBottom: 14 }}>Shelby vs AWS S3 vs GCP GCS</div>
                <RadarSVG data={radarData} />
                <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 10 }}>
                  {[["#059669","Shelby"],["#F97316","AWS S3"],["#3B82F6","GCP"]].map(([c,l])=>(
                    <span key={l} style={{ fontSize: 11.5, color: "#888", display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }}/>{l}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "22px 24px" }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3 }}>Score History</div>
                <div style={{ fontSize: 12, color: "#AAA", marginBottom: 14 }}>Trend across benchmark runs</div>
                <HistorySVG history={history} />
              </div>
            </div>

            {/* Speed comparison */}
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "22px 24px", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3 }}>Speed Comparison</div>
              <div style={{ fontSize: 12, color: "#AAA", marginBottom: 14 }}>Shelby (real) vs Cloud providers (published benchmarks)</div>
              <SpeedSVG barData={barData} />
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <span style={{ fontSize: 11.5, color: "#AAA" }}>■ Solid = Upload &nbsp; □ Faded = Download</span>
                <span style={{ fontSize: 11.5, color: "#CCC" }}>Cloud figures are published industry benchmarks</span>
              </div>
            </div>

            {/* About */}
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "28px 32px" }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>About Shelby Protocol</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 24 }}>
                {[
                  { icon: "🔗", t: "Decentralized",  d: "Data distributed across global Storage Providers — no single point of failure." },
                  { icon: "💰", t: "~70% Cheaper",   d: "Lower cost than AWS S3 and GCP GCS via open decentralized economics." },
                  { icon: "⚡", t: "Hot Storage",    d: "Sub-second data access, competitive with traditional cloud storage." },
                  { icon: "🛡️", t: "Immutable",      d: "Every upload anchored to the Aptos blockchain — tamper-proof by design." },
                ].map(f => (
                  <div key={f.t}>
                    <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>{f.t}</div>
                    <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>{f.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <footer style={{ borderTop: "1px solid #EBEBEB", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, color: "#AAA" }}>
        <span>Shelby Benchmark · Shelbynet Performance Tool</span>
        <div style={{ display: "flex", gap: 20 }}>
          <a href="https://shelby.xyz" target="_blank" style={{ color: "#AAA", textDecoration: "none" }}>shelby.xyz</a>
          <a href="https://docs.shelby.xyz" target="_blank" style={{ color: "#AAA", textDecoration: "none" }}>Docs</a>
          <a href="https://explorer.aptoslabs.com" target="_blank" style={{ color: "#AAA", textDecoration: "none" }}>Explorer</a>
        </div>
      </footer>
    </div>
  );
}