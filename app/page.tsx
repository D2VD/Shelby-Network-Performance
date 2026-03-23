"use client";
// app/page.tsx — Benchmark Tool v4.0
// THÊM:
// - Diagnose panel: preflight checks trước khi run
// - Speed history chart từ KV (persist qua sessions)
// - Geomi API key hint khi rate limited
// - Faucet fallback link khi faucet server down
// - Lưu kết quả vào KV sau mỗi run thành công

import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = "idle" | "diagnose" | "checking" | "latency" | "upload" | "download" | "txtime" | "done" | "error";

interface LatResult  { avg: number; min: number; max: number; samples: number[] }
interface UpResult   { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null; status?: string }
interface DlResult   { bytes: number; elapsed: number; speedKbs: number }
interface TxResult   { submitTime: number; confirmTime: number; txHash: string | null }
interface BenchResult { latency: LatResult; uploads: UpResult[]; downloads: DlResult[]; tx: TxResult; avgUploadKbs: number; avgDownloadKbs: number; score: number }
interface Balance    { apt: number; shelbyusd: number; ready: boolean; address: string }

interface DiagnoseCheck { name: string; status: "pass" | "fail" | "warn" | "skip"; value?: string; hint?: string }
interface DiagnoseResult { ready: boolean; passCount: number; failCount: number; warnCount: number; checks: DiagnoseCheck[]; summary: string }

interface HistoryEntry { ts: string; avgUploadKbs: number; avgDownloadKbs: number; latencyAvg: number; score: number }

const SIZE_LABELS: Record<number, string> = { 1024: "1 KB", 10240: "10 KB", 102400: "100 KB" };
const fmt    = (k: number) => k >= 1024 ? `${(k / 1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
const fmtMs  = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(2)}s` : `${m.toFixed(0)}ms`;
const pct    = (v: number, max: number) => Math.min(100, (v / max) * 100);

function calcScore(r: { avgUploadKbs: number; avgDownloadKbs: number; latency: LatResult; tx: TxResult }) {
  return Math.round(pct(r.avgUploadKbs, 800) * 0.3 + pct(r.avgDownloadKbs, 1200) * 0.3 + Math.max(0, 100 - r.latency.avg / 4) * 0.25 + Math.max(0, 100 - r.tx.confirmTime / 20) * 0.15);
}

const call = async (url: string, body?: object) => {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`Server error (${r.status})`); }
  if (!r.ok) throw new Error(j.error ?? `API ${r.status}`);
  return j;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function LogLine({ text }: { text: string }) {
  const isErr = text.startsWith("✗");
  const isOk  = text.startsWith("✓") || text.startsWith("Done");
  const isHdr = text.startsWith("—");
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.75, color: isErr ? "#ef4444" : isOk ? "#16a34a" : isHdr ? "#6366f1" : "#9ca3af" }}>
      {text}
    </div>
  );
}

function SpeedBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 13 }}>
        <span style={{ color: "var(--gray-600)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", color, fontWeight: 600 }}>{fmt(value)}</span>
      </div>
      <div style={{ height: 6, background: "var(--gray-100)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct(value, max)}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 44, c = 2 * Math.PI * r, dash = (score / 100) * c;
  const color = score >= 70 ? "#16a34a" : score >= 40 ? "#d97706" : "#dc2626";
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke="var(--gray-100)" strokeWidth="8"/>
      <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={`${dash} ${c}`} strokeLinecap="round" transform="rotate(-90 55 55)" style={{ transition: "stroke-dasharray 1s ease" }}/>
      <text x="55" y="51" textAnchor="middle" fill={color} fontSize="22" fontWeight="700" fontFamily="var(--font-mono)">{score}</text>
      <text x="55" y="66" textAnchor="middle" fill="var(--gray-400)" fontSize="10" fontFamily="var(--font-sans)">SCORE</text>
    </svg>
  );
}

// ── Diagnose panel ────────────────────────────────────────────────────────────
function DiagnosePanel({ result, loading, onRecheck }: { result: DiagnoseResult | null; loading: boolean; onRecheck: () => void }) {
  const statusIcon: Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠", skip: "—" };
  const statusColor: Record<string, string> = { pass: "#16a34a", fail: "#ef4444", warn: "#d97706", skip: "#9ca3af" };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Pre-flight checks</div>
          <div className="card-subtitle">
            {loading ? "Checking…" : result
              ? result.ready
                ? `All ${result.passCount} checks passed`
                : `${result.failCount} issue${result.failCount > 1 ? "s" : ""} to fix`
              : "Run checks before benchmark"}
          </div>
        </div>
        <button onClick={onRecheck} disabled={loading} className="btn btn-secondary" style={{ fontSize: 12 }}>
          {loading ? "⟳ Checking…" : "⟳ Recheck"}
        </button>
      </div>
      <div className="card-body" style={{ padding: "0 20px 16px" }}>
        {loading && !result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skeleton" style={{ height: 32, borderRadius: 6 }} />
            ))}
          </div>
        )}
        {result && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {result.checks.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", borderRadius: 8, background: c.status === "fail" ? "#fef2f2" : c.status === "warn" ? "#fffbeb" : "#f0fdf4" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: statusColor[c.status], flexShrink: 0, width: 16 }}>
                    {statusIcon[c.status]}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--gray-800)" }}>{c.name}</span>
                      {c.value && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gray-500)", flexShrink: 0 }}>{c.value}</span>}
                    </div>
                    {c.hint && (
                      <div style={{ fontSize: 12, color: "var(--gray-500)", marginTop: 2 }}>
                        {c.hint}
                        {c.hint.includes("geomi.dev") && (
                          <a href="https://geomi.dev" target="_blank" rel="noreferrer" style={{ color: "#2563eb", marginLeft: 6 }}>geomi.dev ↗</a>
                        )}
                        {c.hint.includes("faucet") && (
                          <a href="https://docs.shelby.xyz/apis/faucet/shelbyusd" target="_blank" rel="noreferrer" style={{ color: "#2563eb", marginLeft: 6 }}>Faucet ↗</a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!result.ready && (
              <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 13, color: "#b91c1c" }}>
                {result.summary}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Speed history mini-chart ──────────────────────────────────────────────────
function SpeedHistoryChart({ history }: { history: HistoryEntry[] }) {
  if (history.length < 2) return null;

  const recent = history.slice(0, 20).reverse(); // Chronological order
  const upSpeeds = recent.map(h => h.avgUploadKbs);
  const dlSpeeds = recent.map(h => h.avgDownloadKbs);
  const maxSpeed = Math.max(...upSpeeds, ...dlSpeeds, 100);

  const W = 560, H = 100, pad = { t: 8, b: 4, l: 4, r: 4 };
  const iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;
  const xs = recent.map((_, i) => pad.l + (i / (recent.length - 1)) * iW);
  const toY = (v: number) => pad.t + iH - (v / maxSpeed) * iH;

  const upLine = xs.map((x, i) => `${x.toFixed(1)},${toY(upSpeeds[i]).toFixed(1)}`).join(" ");
  const dlLine = xs.map((x, i) => `${x.toFixed(1)},${toY(dlSpeeds[i]).toFixed(1)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
        <polyline points={upLine} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeLinejoin="round" opacity={0.8}/>
        <polyline points={dlLine} fill="none" stroke="#16a34a" strokeWidth={1.5} strokeLinejoin="round" opacity={0.8}/>
        {/* Latest dots */}
        {xs.length > 0 && <>
          <circle cx={xs[xs.length-1]} cy={toY(upSpeeds[upSpeeds.length-1])} r={3} fill="#2563eb"/>
          <circle cx={xs[xs.length-1]} cy={toY(dlSpeeds[dlSpeeds.length-1])} r={3} fill="#16a34a"/>
        </>}
      </svg>
      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--gray-400)", marginTop: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 2, background: "#2563eb", display: "inline-block", borderRadius: 1 }}/>Upload
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 2, background: "#16a34a", display: "inline-block", borderRadius: 1 }}/>Download
        </span>
        <span style={{ marginLeft: "auto" }}>{recent.length} runs · {new Date(history[0].ts).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function BenchmarkPage() {
  const { config, network } = useNetwork();

  const [phase,    setPhase]    = useState<Phase>("idle");
  const [log,      setLog]      = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [result,   setResult]   = useState<BenchResult | null>(null);
  const [balance,  setBalance]  = useState<Balance | null>(null);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [diagLoad, setDiagLoad] = useState(false);
  const [history,  setHistory]  = useState<HistoryEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (t: string) => setLog(p => [...p.slice(-60), t]);

  const refreshBalance = useCallback(() => {
    call("/api/benchmark/balance").then(b => setBalance(b)).catch(() => {});
  }, []);

  const runDiagnose = useCallback(async () => {
    setDiagLoad(true);
    try {
      const d = await call("/api/benchmark/diagnose");
      setDiagnose(d);
    } catch (e: any) {
      setDiagnose({
        ready: false, passCount: 0, failCount: 1, warnCount: 0,
        checks: [{ name: "Diagnose", status: "fail", hint: e.message }],
        summary: e.message,
      });
    } finally { setDiagLoad(false); }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const d = await call("/api/benchmark/results");
      if (d?.results?.length) setHistory(d.results);
    } catch {}
  }, []);

  useEffect(() => {
    refreshBalance();
    runDiagnose();
    loadHistory();
  }, [refreshBalance, runDiagnose, loadHistory]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const run = useCallback(async () => {
    if (!diagnose?.ready) {
      await runDiagnose();
      return;
    }

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
          addLog(`  ✓ ${label}: ${fmt(u.speedKbs)} · ${fmtMs(u.elapsed)}${u.status === "recovered" ? " [recovered]" : ""}`);
        } catch (e: any) {
          addLog(`  ✗ ${label}: ${e.message}`);
          uploads.push({ bytes: 0, elapsed: 0, speedKbs: 0, blobName: "", txHash: null });
          // 429 hint
          if (e.message?.includes("429") || e.message?.includes("rate")) {
            addLog("  ⚠ Rate limited — set SHELBY_API_KEY from geomi.dev for higher limits");
          }
        }
        setProgress(22 + (i + 1) * 12);
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
          downloads.push({ bytes: 0, elapsed: 0, speedKbs: 0 });
        }
      }
      setProgress(72);

      setPhase("txtime");
      addLog("— [4/4] Transaction timing…");
      const tx: TxResult = await call("/api/benchmark/txtime");
      addLog(`✓ Submit: ${fmtMs(tx.submitTime)} · Confirm: ${fmtMs(tx.confirmTime)}`);
      setProgress(90);

      const avgUp   = uploads.filter(u => u.speedKbs > 0).reduce((s, u) => s + u.speedKbs, 0) / Math.max(1, uploads.filter(u => u.speedKbs > 0).length);
      const avgDown = downloads.filter(d => d.speedKbs > 0).reduce((s, d) => s + d.speedKbs, 0) / Math.max(1, downloads.filter(d => d.speedKbs > 0).length);
      const score   = calcScore({ avgUploadKbs: avgUp, avgDownloadKbs: avgDown, latency, tx });
      const res: BenchResult = { latency, uploads, downloads, tx, avgUploadKbs: avgUp, avgDownloadKbs: avgDown, score };

      setResult(res); setPhase("done"); setProgress(100);
      addLog(`— Done · Score: ${score}/100`);
      refreshBalance();

      // Lưu kết quả vào KV (fire and forget)
      call("/api/benchmark/results", res).then(() => {
        loadHistory();
      }).catch(() => {});

    } catch (e: any) {
      setPhase("error");
      addLog(`✗ ${e.message}`);
      if (e.message?.includes("429") || e.message?.includes("rate")) {
        addLog("  → Đăng ký API key miễn phí tại geomi.dev, set SHELBY_API_KEY trong CF Pages env vars");
      }
      if (e.message?.includes("Insufficient balance")) {
        addLog("  → Dùng Faucet bên dưới, hoặc mint thủ công tại docs.shelby.xyz/apis/faucet");
      }
    }
  }, [diagnose, runDiagnose, refreshBalance, loadHistory]);

  const requestFaucet = useCallback(async () => {
    addLog("— Requesting tokens from faucet…");
    try {
      const d = await call("/api/benchmark/faucet", {});
      if (d.aptFauceted || d.shelbyusdFauceted) {
        addLog(`✓ APT: ${d.aptFauceted ? "OK" : "Skip"} · ShelbyUSD: ${d.shelbyusdFauceted ? "OK" : "Skip"}`);
        if (d.delta?.apt > 0 || d.delta?.usd > 0) {
          addLog(`  +${d.delta.apt.toFixed(4)} APT · +${d.delta.usd.toFixed(6)} ShelbyUSD`);
        }
      } else {
        addLog(`✗ Faucet server không phản hồi`);
        addLog(`  → Mint thủ công tại docs.shelby.xyz/apis/faucet/shelbyusd`);
      }
      refreshBalance();
      runDiagnose();
    } catch (e: any) { addLog(`✗ Faucet: ${e.message}`); }
  }, [refreshBalance, runDiagnose]);

  const running = !["idle", "done", "error"].includes(phase);

  // ── Testnet gate ────────────────────────────────────────────────────────
  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Benchmark tool</h1>
        <p className="page-subtitle">
          Measure upload speed, download speed, latency, and transaction time on{" "}
          <strong>{config.label}</strong>
        </p>
      </div>

      {/* Diagnose panel */}
      <DiagnosePanel result={diagnose} loading={diagLoad} onRecheck={runDiagnose} />

      {/* Wallet card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              { label: "APT balance",  value: balance ? balance.apt.toFixed(4) : "—",         ok: (balance?.apt ?? 0) >= 0.1 },
              { label: "ShelbyUSD",    value: balance ? balance.shelbyusd.toFixed(4) : "—",   ok: (balance?.shelbyusd ?? 0) >= 0.001 },
              ...(balance?.address ? [{ label: "Wallet", value: `${balance.address.slice(0, 10)}…${balance.address.slice(-6)}`, ok: true }] : []),
            ].map(({ label, value, ok }) => (
              <div key={label}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, color: ok ? "var(--gray-900)" : "var(--danger)" }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={requestFaucet} disabled={running} className="btn btn-secondary">
              ↯ Request faucet
            </button>
            <a href="https://docs.shelby.xyz/apis/faucet/shelbyusd" target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", padding: "8px 14px", borderRadius: 9, border: "1px solid var(--gray-200)", color: "var(--gray-500)", fontSize: 13, textDecoration: "none" }}>
              Manual faucet ↗
            </a>
          </div>
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={run}
        disabled={running}
        className="btn btn-primary"
        style={{ width: "100%", padding: "14px 0", fontSize: 15, marginBottom: 16, justifyContent: "center", borderRadius: 12, opacity: (!diagnose?.ready && !running) ? 0.6 : 1 }}
      >
        {running
          ? `Running — ${phase.toUpperCase()}…`
          : !diagnose?.ready
          ? "⚠ Fix issues above, then run"
          : result
          ? "⟳ Run again"
          : "▶  Start benchmark"}
      </button>

      {/* Progress */}
      {running && (
        <div className="progress-bar-track" style={{ marginBottom: 16 }}>
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div><div className="card-title">System log</div><div className="card-subtitle">Real-time execution trace</div></div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div ref={logRef} className="bench-log">
              {log.map((line, i) => <LogLine key={i} text={line} />)}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
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
              <ScoreRing score={result.score} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 14 }}>
                  Performance summary
                </div>
                <SpeedBar value={result.avgUploadKbs}   max={800}  label="Avg upload"   color="#2563eb" />
                <SpeedBar value={result.avgDownloadKbs} max={1200} label="Avg download" color="#16a34a" />
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

            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 10 }}>
              Upload details
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Size</th><th>Speed</th><th>Time</th><th>Tx hash</th></tr>
              </thead>
              <tbody>
                {result.uploads.map((u, i) => u.bytes > 0 && (
                  <tr key={i}>
                    <td><span className="mono">{SIZE_LABELS[u.bytes] ?? `${u.bytes}B`}</span></td>
                    <td><span className="mono" style={{ color: "var(--info)", fontWeight: 600 }}>{fmt(u.speedKbs)}</span></td>
                    <td><span className="mono text-muted">{fmtMs(u.elapsed)}</span></td>
                    <td>
                      {u.txHash
                        ? <a href={`https://explorer.aptoslabs.com/txn/${u.txHash}?network=${network}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", fontSize: 12 }}>{u.txHash.slice(0, 10)}… ↗</a>
                        : <span className="text-muted text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Speed history chart */}
      {history.length >= 2 && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Speed history</div>
              <div className="card-subtitle">{history.length} benchmark runs · persisted in KV</div>
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {[
                { label: "Best upload",   value: fmt(Math.max(...history.map(h => h.avgUploadKbs))),   color: "#2563eb" },
                { label: "Best download", value: fmt(Math.max(...history.map(h => h.avgDownloadKbs))), color: "#16a34a" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            <SpeedHistoryChart history={history} />
          </div>
        </div>
      )}
    </div>
  );
}
