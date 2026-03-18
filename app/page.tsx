"use client";
// app/page.tsx — Benchmark Tool v3.0 · Light theme

import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";

// ── Types ──────────────────────────────────────────────────────
type Phase = "idle"|"checking"|"latency"|"upload"|"download"|"txtime"|"done"|"error";
type LatResult  = { avg: number; min: number; max: number; samples: number[] };
type UpResult   = { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string|null; status?: string };
type DlResult   = { bytes: number; elapsed: number; speedKbs: number };
type TxResult   = { submitTime: number; confirmTime: number; txHash: string|null };
type BenchResult = { latency: LatResult; uploads: UpResult[]; downloads: DlResult[]; tx: TxResult; avgUploadKbs: number; avgDownloadKbs: number; score: number };
type Balance    = { apt: number; shelbyusd: number; ready: boolean; address: string };

const SIZE_LABELS: Record<number, string> = { 1024: "1 KB", 10240: "10 KB", 102400: "100 KB" };
const fmt    = (k: number) => k >= 1024 ? `${(k/1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
const fmtMs  = (m: number) => m >= 1000 ? `${(m/1000).toFixed(2)}s` : `${m.toFixed(0)}ms`;
const pct    = (v: number, max: number) => Math.min(100, (v/max)*100);

function calcScore(r: { avgUploadKbs: number; avgDownloadKbs: number; latency: LatResult; tx: TxResult }) {
  return Math.round(pct(r.avgUploadKbs,800)*0.3 + pct(r.avgDownloadKbs,1200)*0.3 + Math.max(0,100-r.latency.avg/4)*0.25 + Math.max(0,100-r.tx.confirmTime/20)*0.15);
}

const call = async (url: string, body?: object) => {
  const r = await fetch(url, body ? { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) } : undefined);
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`Server error (${r.status})`); }
  if (!r.ok) throw new Error(j.error ?? `API ${r.status}`);
  return j;
};

// ── Sub-components ─────────────────────────────────────────────
function LogLine({ text }: { text: string }) {
  const isErr = text.startsWith("✗");
  const isOk  = text.startsWith("✓") || text.startsWith("Done");
  const isHdr = text.startsWith("—");
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.75,
      color: isErr ? "#ef4444" : isOk ? "#16a34a" : isHdr ? "#6366f1" : "#9ca3af",
    }}>{text}</div>
  );
}

function SpeedBar({ value, max, label, color }: { value:number; max:number; label:string; color:string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5, fontSize:13 }}>
        <span style={{ color:"var(--gray-600)", fontWeight:500 }}>{label}</span>
        <span style={{ fontFamily:"var(--font-mono)", color, fontWeight:600 }}>{fmt(value)}</span>
      </div>
      <div style={{ height:6, background:"var(--gray-100)", borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct(value,max)}%`, background:color, borderRadius:3, transition:"width 0.6s ease" }} />
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score:number }) {
  const r = 44, c = 2*Math.PI*r, dash = (score/100)*c;
  const color = score >= 70 ? "#16a34a" : score >= 40 ? "#d97706" : "#dc2626";
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke="var(--gray-100)" strokeWidth="8"/>
      <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round" transform="rotate(-90 55 55)"
        style={{ transition:"stroke-dasharray 1s ease" }}/>
      <text x="55" y="51" textAnchor="middle" fill={color} fontSize="22" fontWeight="700" fontFamily="var(--font-mono)">{score}</text>
      <text x="55" y="66" textAnchor="middle" fill="var(--gray-400)" fontSize="10" fontFamily="var(--font-sans)">SCORE</text>
    </svg>
  );
}

// ── Main ───────────────────────────────────────────────────────
export default function BenchmarkPage() {
  const { config, network } = useNetwork();

  const [phase,    setPhase]   = useState<Phase>("idle");
  const [log,      setLog]     = useState<string[]>([]);
  const [progress, setProgress]= useState(0);
  const [result,   setResult]  = useState<BenchResult|null>(null);
  const [balance,  setBalance] = useState<Balance|null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (t: string) => setLog(p => [...p.slice(-60), t]);
  const refreshBalance = useCallback(() => { call("/api/benchmark/balance").then(b => setBalance(b)).catch(()=>{}); }, []);
  useEffect(() => { refreshBalance(); }, [refreshBalance]);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const run = useCallback(async () => {
    setPhase("checking"); setLog([]); setProgress(0); setResult(null);
    try {
      addLog("— Checking wallet balance…");
      const bal = await call("/api/benchmark/balance");
      setBalance(bal);
      addLog(`  APT: ${bal.apt.toFixed(4)}  ·  ShelbyUSD: ${bal.shelbyusd.toFixed(4)}`);
      if (!bal.ready) throw new Error("Insufficient balance — use Faucet");
      addLog("✓ Balance OK"); setProgress(8);

      setPhase("latency");
      addLog("— [1/4] Measuring blockchain latency…");
      const latency: LatResult = await call("/api/benchmark/latency");
      addLog(`✓ Latency avg: ${fmtMs(latency.avg)} · min: ${fmtMs(latency.min)} · max: ${fmtMs(latency.max)}`);
      setProgress(22);

      setPhase("upload");
      addLog("— [2/4] Uploading blobs…");
      const uploads: UpResult[] = [];
      for (let i = 0; i < 3; i++) {
        const label = Object.values(SIZE_LABELS)[i];
        addLog(`  Uploading ${label}…`);
        try {
          const u: UpResult = await call("/api/benchmark/upload", { sizeIndex: i });
          uploads.push(u);
          addLog(`  ✓ ${label}: ${fmt(u.speedKbs)} · ${fmtMs(u.elapsed)}${u.status==="recovered" ? " [recovered]" : ""}`);
        } catch (e: any) {
          addLog(`  ✗ ${label}: ${e.message}`);
          uploads.push({ bytes:0, elapsed:0, speedKbs:0, blobName:"", txHash:null });
        }
        setProgress(22+(i+1)*12);
      }

      setPhase("download");
      addLog("— [3/4] Downloading blobs…");
      const downloads: DlResult[] = [];
      for (const up of uploads.filter(u => u.blobName && u.speedKbs > 0)) {
        try {
          const d: DlResult = await call("/api/benchmark/download", { blobName: up.blobName });
          downloads.push(d);
          addLog(`  ✓ ${fmt(d.speedKbs)} · ${fmtMs(d.elapsed)}`);
        } catch (e: any) {
          addLog(`  ✗ Download failed: ${e.message}`);
          downloads.push({ bytes:0, elapsed:0, speedKbs:0 });
        }
      }
      setProgress(72);

      setPhase("txtime");
      addLog("— [4/4] Transaction timing…");
      const tx: TxResult = await call("/api/benchmark/txtime");
      addLog(`✓ Submit: ${fmtMs(tx.submitTime)} · Confirm: ${fmtMs(tx.confirmTime)}`);
      setProgress(90);

      const avgUp   = uploads.filter(u=>u.speedKbs>0).reduce((s,u)=>s+u.speedKbs,0) / Math.max(1,uploads.filter(u=>u.speedKbs>0).length);
      const avgDown = downloads.filter(d=>d.speedKbs>0).reduce((s,d)=>s+d.speedKbs,0) / Math.max(1,downloads.filter(d=>d.speedKbs>0).length);
      const score   = calcScore({ avgUploadKbs:avgUp, avgDownloadKbs:avgDown, latency, tx });
      const res: BenchResult = { latency, uploads, downloads, tx, avgUploadKbs:avgUp, avgDownloadKbs:avgDown, score };
      setResult(res); setPhase("done"); setProgress(100);
      addLog(`— Done · Score: ${score}/100`);
      refreshBalance();
    } catch (e: any) {
      setPhase("error");
      addLog(`✗ ${e.message}`);
    }
  }, [refreshBalance]);

  const requestFaucet = useCallback(async () => {
    addLog("— Requesting tokens from faucet…");
    try {
      const d = await call("/api/benchmark/faucet", {});
      addLog(`✓ APT: ${d.aptFauceted?"OK":"Skip"} · ShelbyUSD: ${d.shelbyusdFauceted?"OK":"Skip"}`);
      refreshBalance();
    } catch (e: any) { addLog(`✗ Faucet: ${e.message}`); }
  }, [refreshBalance]);

  const running = !["idle","done","error"].includes(phase);

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Benchmark Tool</h1>
        <p className="page-subtitle">
          Measure upload speed, download speed, latency, and transaction time on{" "}
          <strong>{config.label}</strong>
        </p>
      </div>

      {/* Wallet card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
          <div style={{ display:"flex", gap:28, flexWrap:"wrap" }}>
            {[
              { label:"APT Balance",    value: balance ? balance.apt.toFixed(4) : "—",       ok: (balance?.apt ?? 0) >= 0.1   },
              { label:"ShelbyUSD",      value: balance ? balance.shelbyusd.toFixed(4) : "—", ok: (balance?.shelbyusd ?? 0) >= 0.001 },
              ...(balance?.address ? [{ label:"Wallet", value:`${balance.address.slice(0,10)}…${balance.address.slice(-6)}`, ok:true }] : []),
            ].map(({ label, value, ok }) => (
              <div key={label}>
                <div style={{ fontSize:12, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", color:"var(--gray-400)", marginBottom:4 }}>{label}</div>
                <div style={{ fontFamily:"var(--font-mono)", fontSize:18, fontWeight:600, color: ok ? "var(--gray-900)" : "var(--danger)" }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={requestFaucet}
            disabled={running}
            className="btn btn-secondary"
          >
            ↯ Request Faucet
          </button>
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={run}
        disabled={running}
        className="btn btn-primary"
        style={{ width:"100%", padding:"14px 0", fontSize:15, marginBottom:16, justifyContent:"center", borderRadius:12 }}
      >
        {running ? `Running — ${phase.toUpperCase()}…` : result ? "⟳ Run Again" : "▶  Start Benchmark"}
      </button>

      {/* Progress */}
      {running && (
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width:`${progress}%` }} />
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="card" style={{ marginBottom:20 }}>
          <div className="card-header">
            <div>
              <div className="card-title">System Log</div>
              <div className="card-subtitle">Real-time execution trace</div>
            </div>
          </div>
          <div className="card-body" style={{ padding:0 }}>
            <div ref={logRef} className="bench-log">
              {log.map((line, i) => <LogLine key={i} text={line} />)}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && phase === "done" && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Benchmark Results</div>
              <div className="card-subtitle">{config.label} · {new Date().toLocaleTimeString()}</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display:"flex", gap:28, alignItems:"flex-start", flexWrap:"wrap", marginBottom:28 }}>
              <ScoreRing score={result.score} />
              <div style={{ flex:1, minWidth:220 }}>
                <div style={{ fontSize:12, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", color:"var(--gray-400)", marginBottom:14 }}>
                  Performance Summary
                </div>
                <SpeedBar value={result.avgUploadKbs}   max={800}  label="Avg Upload"   color="#2563eb" />
                <SpeedBar value={result.avgDownloadKbs} max={1200} label="Avg Download" color="#16a34a" />
                <div style={{ display:"flex", gap:24, marginTop:16 }}>
                  {[
                    { label:"Avg Latency",  value: fmtMs(result.latency.avg) },
                    { label:"TX Confirm",   value: fmtMs(result.tx.confirmTime) },
                    { label:"TX Submit",    value: fmtMs(result.tx.submitTime) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize:11, color:"var(--gray-400)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>{label}</div>
                      <div style={{ fontFamily:"var(--font-mono)", fontSize:16, fontWeight:600, color:"var(--gray-800)" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Upload detail table */}
            <div style={{ fontSize:12, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", color:"var(--gray-400)", marginBottom:10 }}>
              Upload Details
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Size</th><th>Speed</th><th>Time</th><th>Tx Hash</th></tr>
              </thead>
              <tbody>
                {result.uploads.map((u, i) => u.bytes > 0 && (
                  <tr key={i}>
                    <td><span className="mono">{SIZE_LABELS[u.bytes] ?? `${u.bytes}B`}</span></td>
                    <td><span className="mono" style={{ color:"var(--info)", fontWeight:600 }}>{fmt(u.speedKbs)}</span></td>
                    <td><span className="mono text-muted">{fmtMs(u.elapsed)}</span></td>
                    <td>
                      {u.txHash
                        ? <a href={`https://explorer.aptoslabs.com/txn/${u.txHash}?network=${network}`} target="_blank" rel="noreferrer" style={{ color:"var(--info)", fontSize:12 }}>
                            {u.txHash.slice(0,10)}… ↗
                          </a>
                        : <span className="text-muted text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}