"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// --- Types ---
type Phase = "idle" | "diagnose" | "checking" | "latency" | "upload" | "download" | "txtime" | "done" | "error";
interface LatResult  { avg: number; min: number; max: number; }
interface UpResult   { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null; }
interface DlResult   { bytes: number; elapsed: number; speedKbs: number; }
interface TxResult   { submitTime: number; confirmTime: number; txHash: string | null; }
interface BenchResult { latency: LatResult; uploads: UpResult[]; downloads: DlResult[]; tx: TxResult; avgUploadKbs: number; avgDownloadKbs: number; score: number; tier: string; }
interface Balance    { apt: number; shelbyusd: number; ready: boolean; address: string; }
interface DiagnoseCheck { name: string; status: "pass" | "fail" | "warn"; value?: string; hint?: string; }
interface DiagnoseResult { ready: boolean; passCount: number; failCount: number; checks: DiagnoseCheck[]; summary: string; workerVersion?:  string; }

// --- Formatters & Scoring ---
const SIZE_LABELS: Record<number, string> = { 1024: "1 KB", 10240: "10 KB", 102400: "100 KB" };
const fmtKbs = (k: number) => k >= 1000 ? `${(k / 1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
const fmtMs  = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(2)}s` : `${m.toFixed(0)}ms`;

function calcScore(r: { avgUploadKbs: number; avgDownloadKbs: number; latency: LatResult; tx: TxResult }): { score: number; tier: string } {
  const upScore = r.avgUploadKbs * 2;
  const dlScore = r.avgDownloadKbs;
  const latScore = r.latency.avg > 0 ? 10000 / r.latency.avg : 0;
  const txScore = r.tx.confirmTime > 0 ? 50000 / r.tx.confirmTime : 0;
  const score = Math.round(upScore + dlScore + latScore + txScore);
  
  let tier = "Poor";
  if (score > 10000) tier = "Blazing Fast";
  else if (score > 5000) tier = "Excellent";
  else if (score > 2000) tier = "Good";
  else if (score > 500) tier = "Fair";

  return { score, tier };
}

const call = async <T,>(url: string, body?: object): Promise<T> => {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: 'GET' });
  
  if (!r.ok) {
    // Ép kiểu 'err' sang any để có thể truy cập thuộc tính .error
    const err: any = await r.json().catch(() => ({ error: `API Error ${r.status}` }));
    throw new Error(err.error || `API Error ${r.status}`);
  }
  
  // TypeScript sẽ tự động hiểu kết quả trả về có kiểu T
  return r.json();
};

// --- Sub-components ---
function LogLine({ text }: { text: string }) {
  const isErr = text.startsWith("✗");
  const isOk  = text.startsWith("✓") || text.startsWith("Done");
  const isHdr = text.startsWith("—");
  return <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.75, color: isErr ? "#ef4444" : isOk ? "#16a34a" : isHdr ? "#6366f1" : "#9ca3af" }}>{text}</div>;
}

function SpeedBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 13 }}>
        <span style={{ color: "var(--gray-600)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", color, fontWeight: 600 }}>{fmtKbs(value)}</span>
      </div>
      <div style={{ height: 6, background: "var(--gray-100)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function ScoreRing({ score, tier }: { score: number, tier: string }) {
  const r = 44, c = 2 * Math.PI * r;
  const pct = Math.min(100, score / 15000 * 100); // Giả định 15000 là điểm rất cao
  const dash = (pct / 100) * c;
  const color = tier === "Excellent" || tier === "Blazing Fast" ? "#16a34a" : tier === "Good" ? "#f59e0b" : "#ef4444";
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke="var(--gray-100)" strokeWidth="8"/>
      <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={`${dash} ${c}`} strokeLinecap="round" transform="rotate(-90 55 55)" style={{ transition: "stroke-dasharray 1s ease" }}/>
      <text x="55" y="51" textAnchor="middle" fill={color} fontSize="22" fontWeight="700" fontFamily="var(--font-mono)">{score}</text>
      <text x="55" y="66" textAnchor="middle" fill="var(--gray-400)" fontSize="10" fontFamily="var(--font-sans)">{tier.toUpperCase()}</text>
    </svg>
  );
}

function DiagnosePanel({ result, loading, onRecheck }: { result: DiagnoseResult | null; loading: boolean; onRecheck: () => void }) {
  const statusIcon: Record<string, string>  = { pass: "✓", fail: "✗", warn: "⚠" };
  const statusColor: Record<string, string> = { pass: "#16a34a", fail: "#ef4444", warn: "#f59e0b" };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Pre-flight checks</div>
          <div className="card-subtitle">
            {loading ? "Checking…" : result
              ? result.ready
                ? `All ${result.passCount} checks passed · API v${result.workerVersion}`
                : `${result.failCount} issue(s) to fix`
              : "Run checks before benchmark"}
          </div>
        </div>
        <button onClick={onRecheck} disabled={loading} className="btn btn-secondary" style={{ fontSize: 12 }}>{loading ? "⟳ Checking…" : "⟳ Recheck"}</button>
      </div>
      <div className="card-body" style={{ padding: "0 20px 16px" }}>
        {loading && !result && <div style={{ padding: '16px 0' }}><div className="skeleton" style={{ height: 160, borderRadius: 6 }} /></div>}
        {result?.checks && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 16 }}>
            {result.checks.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", borderRadius: 8, background: c.status === "fail" ? "#fef2f2" : c.status === "warn" ? "#fffbeb" : "#f9fafb" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: statusColor[c.status], flexShrink: 0, width: 16, paddingTop: 2 }}>{statusIcon[c.status]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--gray-800)" }}>{c.name}</span>
                    {c.value && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gray-500)", flexShrink: 0, textAlign: 'right' }}>{c.value}</span>}
                  </div>
                  {c.hint && <div style={{ fontSize: 12, color: "var(--gray-600)", marginTop: 2 }}>{c.hint}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && result && !result.ready && <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 13, color: "#b91c1c" }}>{result.summary}</div>}
      </div>
    </div>
  );
}

// --- Main Component ---
export default function BenchmarkPage() {
  const { config, network } = useNetwork();
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<BenchResult | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [diagLoad, setDiagLoad] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((t: string) => setLog(p => [...p.slice(-60), t]), []);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const runDiagnose = useCallback(async () => {
    setDiagLoad(true);
    try {
      const d = await call<DiagnoseResult>("/api/benchmark/diagnose");
      setDiagnose(d);
    } catch (e: any) {
      setDiagnose({ ready: false, passCount: 0, failCount: 1, checks: [{ name: "API Connection", status: "fail", hint: e.message }], summary: "Cannot connect to Backend API" });
    } finally { setDiagLoad(false); }
  }, []);

  const refreshBalance = useCallback(() => {
    call<Balance>("/api/benchmark/balance").then(setBalance).catch(() => {});
  }, []);

  useEffect(() => {
    runDiagnose();
    refreshBalance();
  }, [runDiagnose, refreshBalance]);

  const run = useCallback(async () => {
    if (!diagnose?.ready) {
      await runDiagnose();
      return;
    }

    setPhase("checking"); setLog([]); setResult(null);
    try {
      addLog("— Checking wallet balance…");
      const bal = await call<Balance>("/api/benchmark/balance");
      setBalance(bal);
      if (!bal.ready) throw new Error("Insufficient balance — use Faucet");
      addLog("✓ Balance OK");

      setPhase("latency");
      addLog("— [1/4] Measuring blockchain latency…");
      const latency = await call<LatResult>("/api/benchmark/latency");
      addLog(`✓ Latency avg: ${fmtMs(latency.avg)} · min: ${fmtMs(latency.min)} · max: ${fmtMs(latency.max)}`);

      setPhase("upload");
      addLog("— [2/4] Uploading blobs…");
      const uploads: UpResult[] = [];
      for (let i = 0; i < 3; i++) {
        const label = Object.values(SIZE_LABELS)[i];
        addLog(`  Uploading ${label}…`);
        const u = await call<UpResult>("/api/benchmark/upload", { sizeIndex: i });
        uploads.push(u);
        addLog(`  ✓ ${label}: ${fmtKbs(u.speedKbs)} · ${fmtMs(u.elapsed)}`);
      }

      setPhase("download");
      addLog("— [3/4] Downloading blobs…");
      const downloads: DlResult[] = [];
      for (const up of uploads.filter(u => u.blobName)) {
        const d = await call<DlResult>("/api/benchmark/download", { blobName: up.blobName });
        downloads.push(d);
        addLog(`  ✓ ${fmtKbs(d.speedKbs)} · ${fmtMs(d.elapsed)}`);
      }

      setPhase("txtime");
      addLog("— [4/4] Transaction timing…");
      const tx = await call<TxResult>("/api/benchmark/txtime");
      addLog(`✓ Submit: ${fmtMs(tx.submitTime)} · Confirm: ${fmtMs(tx.confirmTime)}`);

      const avgUp = uploads.reduce((s, u) => s + u.speedKbs, 0) / uploads.length;
      const avgDown = downloads.reduce((s, d) => s + d.speedKbs, 0) / downloads.length;
      const { score, tier } = calcScore({ avgUploadKbs: avgUp, avgDownloadKbs: avgDown, latency, tx });
      const res: BenchResult = { latency, uploads, downloads, tx, avgUploadKbs: avgUp, avgDownloadKbs: avgDown, score, tier };

      setResult(res);
      setPhase("done");
      addLog(`— Done · Score: ${score} (${tier})`);

    } catch (e: any) {
      setPhase("error");
      addLog(`✗ ${e.message}`);
    }
  }, [diagnose, runDiagnose, addLog]);

  const requestFaucet = useCallback(async () => {
    addLog("— Requesting tokens from faucet…");
    try {
      await call("/api/benchmark/faucet", {});
      addLog(`✓ Faucet requested. Please wait a few seconds for balance to update.`);
      setTimeout(() => {
        refreshBalance();
        runDiagnose();
      }, 3000);
    } catch (e: any) { addLog(`✗ Faucet error: ${e.message}`); }
  }, [refreshBalance, runDiagnose, addLog]);

  const running = !["idle", "done", "error"].includes(phase);
  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Benchmark tool</h1>
        <p className="page-subtitle">Measure upload speed, download speed, latency, and transaction time on <strong>{config.label}</strong></p>
      </div>

      <DiagnosePanel result={diagnose} loading={diagLoad} onRecheck={runDiagnose} />

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              { label: "APT balance",  value: balance ? balance.apt.toFixed(4) : "—", ok: (balance?.apt ?? 0) >= 0.1 },
              { label: "ShelbyUSD",    value: balance ? balance.shelbyusd.toFixed(4) : "—", ok: (balance?.shelbyusd ?? 0) >= 0.001 },
              ...(balance?.address ?[{ label: "Wallet", value: `${balance.address.slice(0, 10)}…${balance.address.slice(-6)}`, ok: true }] :[]),
            ].map(({ label, value, ok }) => (
              <div key={label}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, color: ok ? "var(--gray-900)" : "var(--danger)" }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={requestFaucet} disabled={running} className="btn btn-secondary">↯ Request faucet</button>
            <a href="https://docs.shelby.xyz/apis/faucet/shelbyusd" target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ background: 'white' }}>Manual faucet ↗</a>
          </div>
        </div>
      </div>

      <button onClick={run} disabled={running || !diagnose?.ready} className="btn btn-primary" style={{ width: "100%", padding: "14px 0", fontSize: 15, marginBottom: 16, justifyContent: "center", borderRadius: 12, opacity: (!diagnose?.ready && !running) ? 0.6 : 1 }}>
        {running ? `Running — ${phase.toUpperCase()}…` : !diagnose?.ready ? "⚠ Fix issues above, then run" : result ? "⟳ Run again" : "▶  Start benchmark"}
      </button>

      {log.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">System log</div></div>
          <div ref={logRef} className="bench-log">{log.map((line, i) => <LogLine key={i} text={line} />)}</div>
        </div>
      )}

      {result && phase === "done" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-title">Benchmark results</div>
              <div className="card-subtitle">{config.label} · {new Date().toLocaleTimeString()}</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 28 }}>
              <ScoreRing score={result.score} tier={result.tier} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 14 }}>Performance summary</div>
                <SpeedBar value={result.avgUploadKbs}   max={2000}  label="Avg upload"   color="#2563eb" />
                <SpeedBar value={result.avgDownloadKbs} max={5000} label="Avg download" color="#16a34a" />
                <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
                  {[
                    { label: "Avg latency",  value: fmtMs(result.latency.avg) },
                    { label: "TX confirm",   value: fmtMs(result.tx.confirmTime) },
                    { label: "TX submit",    value: fmtMs(result.tx.submitTime) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600, color: "var(--gray-800)" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 10 }}>Upload details</div>
            <table className="data-table">
              <thead><tr><th>Size</th><th>Speed</th><th>Time</th><th>Tx hash</th></tr></thead>
              <tbody>
                {result.uploads.map((u, i) => (
                  <tr key={i}>
                    <td><span className="mono">{SIZE_LABELS[u.bytes] ?? `${u.bytes}B`}</span></td>
                    <td><span className="mono" style={{ color: "var(--info)", fontWeight: 600 }}>{fmtKbs(u.speedKbs)}</span></td>
                    <td><span className="mono text-muted">{fmtMs(u.elapsed)}</span></td>
                    <td>
                      {u.txHash
                        ? <a href={`https://explorer.aptoslabs.com/txn/${u.txHash}?network=${network}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", fontSize: 12 }}>{u.txHash.slice(0, 10)}… ↗</a>
                        : "—"}
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