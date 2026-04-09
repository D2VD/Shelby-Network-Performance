"use client";
/**
 * app/page.tsx — Benchmark Page v5.6
 * FIXES:
 * 1. Adaptive: download ALL uploaded blobs (not just last 3)
 * 2. Quick mode: correct sizes 1KB/10KB/100KB using sizeBytes param
 * 3. History: proper pagination, shows all local runs (not capped at 10)
 * 4. History count matches display count
 * 5. Device ID sent with requests for proper user identification
 * 6. Results saved to server with device ID header
 * 7. History tab shows local browser history (honest per-browser count)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";
import { getDeviceId, useDeviceId } from "@/lib/use-device-id";
import { useBenchHistory } from "@/lib/use-bench-history";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "checking" | "latency" | "upload" | "download" | "txtime" | "done" | "error";

interface LatResult  { avg: number; min: number; max: number; samples?: number[] }
interface UpResult   { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null }
interface DlResult   { bytes: number; elapsed: number; speedKbs: number }
interface TxResult   { submitTime: number; confirmTime: number; txHash: string | null }
interface Balance    { apt: number; shelbyusd: number; ready: boolean; address: string }
interface DiagnoseCheck { name: string; status: "pass" | "fail" | "warn"; value?: string; hint?: string }
interface DiagnoseResult {
  ready: boolean; passCount: number; failCount: number; warnCount: number;
  checks: DiagnoseCheck[]; summary: string; workerVersion?: string;
}
interface BenchResult {
  latency: LatResult; uploads: UpResult[]; downloads: DlResult[]; tx: TxResult;
  avgUploadKbs: number; avgDownloadKbs: number; score: number; tier: string;
  runAt: string; maxSuccessfulBytes?: number; mode: "adaptive" | "standard";
}

// ─── Constants ────────────────────────────────────────────────────────────────

// ADAPTIVE: test progressively larger blobs
const ADAPTIVE_SIZES = [1_024, 65_536, 524_288, 2_097_152, 5_242_880, 10_485_760];
// STANDARD (Quick): 1KB / 10KB / 100KB
const STANDARD_SIZES = [1_024, 10_240, 102_400];
const MAX_CUSTOM_BYTES = 10 * 1024 * 1024;
const HISTORY_PER_PAGE = 20;

const STEPS = [
  { phase: "checking", label: "Wallet",   icon: "◎", pct: 5  },
  { phase: "latency",  label: "Latency",  icon: "◌", pct: 20 },
  { phase: "upload",   label: "Upload",   icon: "↑", pct: 68 },
  { phase: "download", label: "Download", icon: "↓", pct: 88 },
  { phase: "txtime",   label: "TX time",  icon: "⬡", pct: 98 },
  { phase: "done",     label: "Done",     icon: "✓", pct: 100},
];
const PHASE_PCT: Record<string, number> = Object.fromEntries(STEPS.map(s => [s.phase, s.pct]));

const TIER_COLOR: Record<string, string> = {
  "Blazing Fast": "#16a34a", "Excellent": "#059669",
  "Good": "#ca8a04", "Fair": "#d97706", "Poor": "#dc2626",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtKbs  = (k: number) => k >= 1024 ? `${(k / 1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
const fmtMs   = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(2)}s`      : `${m.toFixed(0)}ms`;
const fmtBytes = (b: number) => {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(2)} MB`;
  if (b >= 1024)      return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
};

function calcScore(r: { avgUploadKbs: number; avgDownloadKbs: number; latency: LatResult; tx: TxResult }) {
  const up  = Math.min(400, r.avgUploadKbs   * 1.0);
  const dl  = Math.min(250, r.avgDownloadKbs * 0.05);
  const lat = 200 * Math.max(0, 1 - r.latency.avg    / 5000);
  const tx  = 150 * Math.max(0, 1 - r.tx.confirmTime / 8000);
  const score = Math.round(up + dl + lat + tx);
  let tier = "Poor";
  if      (score >= 900) tier = "Blazing Fast";
  else if (score >= 700) tier = "Excellent";
  else if (score >= 450) tier = "Good";
  else if (score >= 200) tier = "Fair";
  return { score, tier };
}

// Fetch helper — sends device ID header for proper identification
const callWithDevice = async <T,>(url: string, body?: object): Promise<T> => {
  const deviceId = getDeviceId();
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "x-device-id": deviceId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err: any = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
};

const signalRunEnd = async () => {
  try {
    const deviceId = getDeviceId();
    await fetch("/api/benchmark/upload/end", {
      method: "POST",
      headers: { "x-device-id": deviceId },
    });
  } catch { /* silent */ }
};

const saveResultToServer = async (res: BenchResult) => {
  try {
    const deviceId = getDeviceId();
    await fetch("/api/benchmark/results", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-id": deviceId },
      body: JSON.stringify(res),
    });
  } catch (e) {
    console.warn("[bench] Failed to save result to server:", e);
  }
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function LogLine({ text }: { text: string }) {
  const isErr = text.startsWith("✗");
  const isOk  = text.startsWith("✓") || text.startsWith("Done");
  const isHdr = text.startsWith("—");
  const isSub = text.startsWith("  ");
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.75,
      paddingLeft: isSub && !isOk ? 14 : 0,
      color: isErr ? "#ef4444" : isOk ? "#16a34a" : isHdr ? "#6366f1" : isSub ? "#9ca3af" : "#c0ccd8",
    }}>{text}</div>
  );
}

function ProgressBar({ phase, running }: { phase: Phase; running: boolean }) {
  const pct = PHASE_PCT[phase] ?? (phase === "idle" ? 0 : 100);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-400)" }}>
        <span style={{ color: running ? "var(--gray-700)" : "var(--gray-400)", fontWeight: running ? 600 : 400 }}>
          {running ? STEPS.find(s => s.phase === phase)?.label ?? phase
           : phase === "done" ? "Complete" : phase === "error" ? "Error" : "Ready"}
        </span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 5, background: "var(--gray-100)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 10, transition: "width 0.6s ease, background 0.3s",
          background:   phase === "error" ? "#ef4444" : phase === "done" ? "#16a34a" : "var(--net-color, #2563eb)",
          boxShadow:    running ? "0 0 8px var(--net-color, #2563eb)88" : "none",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        {STEPS.map(s => {
          const done    = PHASE_PCT[phase] >= s.pct && phase !== "idle";
          const current = s.phase === phase;
          return (
            <div key={s.phase} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, opacity: done || current ? 1 : 0.3 }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9,
                background:  done ? (phase === "error" ? "#ef4444" : "var(--net-color, #2563eb)") : current ? "transparent" : "#f0f0f0",
                border:      current ? "2px solid var(--net-color, #2563eb)" : "2px solid transparent",
                color:       done ? "#fff" : current ? "var(--net-color, #2563eb)" : "#999",
                animation:   current && running ? "pulse-ring 1.5s infinite" : "none",
              }}>
                {done ? "✓" : s.icon}
              </div>
              <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: current ? "var(--net-color)" : "var(--gray-400)", textAlign: "center" }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreRing({ score, tier }: { score: number; tier: string }) {
  const color = TIER_COLOR[tier] ?? "#6b7280";
  const r = 44, c = 2 * Math.PI * r;
  const dash = (Math.min(100, (score / 1000) * 100) / 100) * c;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={110} height={110} viewBox="0 0 110 110">
        <circle cx={55} cy={55} r={r} fill="none" stroke="#f0f0f0" strokeWidth={8} />
        <circle cx={55} cy={55} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" transform="rotate(-90 55 55)"
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)" }} />
        <text x={55} y={50} textAnchor="middle" fill={color} fontSize={22} fontWeight={700} fontFamily="var(--font-mono)">{score}</text>
        <text x={55} y={65} textAnchor="middle" fill="#9ca3af" fontSize={9}>{tier.toUpperCase()}</text>
      </svg>
      <div style={{ fontSize: 10, color: "var(--gray-400)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>/ 1000</div>
    </div>
  );
}

function SpeedBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--gray-500)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color, fontWeight: 600 }}>{fmtKbs(value)}</span>
      </div>
      <div style={{ height: 4, background: "var(--gray-100)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, (value / max) * 100)}%`, background: color, borderRadius: 3, transition: "width 0.8s" }} />
      </div>
    </div>
  );
}

function TxHashCell({ hash, network }: { hash: string | null; network: string }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return <span style={{ color: "var(--gray-300)" }}>—</span>;
  const copy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(hash).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <a href={`https://explorer.aptoslabs.com/txn/${hash}?network=${network}`} target="_blank" rel="noreferrer"
        style={{ color: "var(--info, #2563eb)", fontSize: 12, fontFamily: "var(--font-mono)", textDecoration: "none" }} title={hash}>
        {hash.slice(0, 8)}…{hash.slice(-5)} ↗
      </a>
      <button onClick={copy} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 11, color: copied ? "#16a34a" : "var(--gray-400)" }}>
        {copied ? "✓" : "⎘"}
      </button>
    </span>
  );
}

function DiagnosePanel({ result, loading, onRecheck }: {
  result: DiagnoseResult | null; loading: boolean; onRecheck: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const allPassed = result?.ready && !loading;
  const icon:  Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠" };
  const color: Record<string, string> = { pass: "#16a34a", fail: "#ef4444", warn: "#f59e0b" };
  const bg:    Record<string, string> = { pass: "#f0fdf4", fail: "#fef2f2", warn: "#fffbeb" };
  const bd:    Record<string, string> = { pass: "#e5e7eb", fail: "#fecaca", warn: "#fde68a" };
  useEffect(() => {
    if (result?.ready) setExpanded(false);
    if (!result?.ready && result !== null) setExpanded(true);
  }, [result?.ready]);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          {!loading && result && (
            <span style={{ fontSize: 14, fontWeight: 700, color: result.ready ? "#16a34a" : "#ef4444" }}>
              {result.ready ? "✓" : "✗"}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="card-title">Pre-flight checks</div>
            <div className="card-subtitle">
              {loading ? "Checking…"
               : result ? result.ready
                 ? `${result.passCount} checks passed · API v${result.workerVersion ?? "?"}`
                 : `${result.failCount} issue(s) — fix before running`
               : "Not checked yet"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {result && !loading && (
            <button onClick={() => setExpanded(v => !v)} className="btn btn-secondary" style={{ fontSize: 11 }}>
              {expanded ? "▲ Hide" : "▼ Details"}
            </button>
          )}
          <button onClick={onRecheck} disabled={loading} className="btn btn-secondary" style={{ fontSize: 12 }}>
            {loading ? "⟳" : "⟳ Recheck"}
          </button>
        </div>
      </div>
      {loading && !result && (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="skeleton" style={{ height: 100, borderRadius: 6 }} />
        </div>
      )}
      {result?.checks && (expanded || !allPassed) && (
        <div className="card-body" style={{ padding: "4px 20px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {result.checks.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", borderRadius: 8, background: bg[c.status] ?? "#f9fafb", border: `1px solid ${bd[c.status] ?? "#e5e7eb"}` }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: color[c.status], flexShrink: 0, paddingTop: 2 }}>{icon[c.status]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--gray-800)" }}>{c.name}</span>
                    {c.value && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gray-400)" }}>{c.value}</span>}
                  </div>
                  {c.hint && <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>{c.hint}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CustomUploadCard({ running, network }: { running: boolean; network: string }) {
  const [file, setFile]             = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [lastResult, setLastResult] = useState<UpResult | null>(null);
  const [err, setErr]               = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (f.size > MAX_CUSTOM_BYTES) { setErr(`File exceeds ${fmtBytes(MAX_CUSTOM_BYTES)} limit`); return; }
    if (f.size === 0) { setErr("File is empty"); return; }
    setErr(null); setFile(f); setLastResult(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      const buf = await file.arrayBuffer();
      const r = await callWithDevice<UpResult>("/api/benchmark/upload/custom", {
        customData: Array.from(new Uint8Array(buf)),
        blobName:   `custom/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/${Date.now()}`,
      });
      setLastResult(r);
    } catch (e: any) { setErr(e.message); }
    finally { setUploading(false); }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Custom upload</div>
          <div className="card-subtitle">Upload your own file · max {fmtBytes(MAX_CUSTOM_BYTES)} · not rate limited</div>
        </div>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div onClick={() => inputRef.current?.click()} style={{
            flex: 1, minWidth: 160, border: "1.5px dashed var(--gray-200)", borderRadius: 10,
            padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
            background: file ? "#f0fdf4" : "#fafafa",
          }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--net-color, #2563eb)")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--gray-200)")}>
            <span style={{ fontSize: 20 }}>{file ? "📄" : "📂"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {file
                ? <><div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-800)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                    <div style={{ fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>{fmtBytes(file.size)}</div></>
                : <div style={{ fontSize: 13, color: "var(--gray-400)" }}>Click to select a file</div>}
            </div>
            <input ref={inputRef} type="file" onChange={handleFile} style={{ display: "none" }} />
          </div>
          <button onClick={handleUpload} disabled={!file || uploading || running} className="btn btn-primary" style={{ flexShrink: 0, opacity: (!file || uploading || running) ? 0.5 : 1 }}>
            {uploading ? "Uploading…" : "↑ Upload"}
          </button>
        </div>
        {err && <div style={{ padding: "8px 12px", borderRadius: 7, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#b91c1c" }}>{err}</div>}
        {lastResult && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              {[
                { label: "Speed", value: fmtKbs(lastResult.speedKbs), color: "#16a34a" },
                { label: "Time",  value: fmtMs(lastResult.elapsed),   color: "var(--gray-700)" },
                { label: "Size",  value: fmtBytes(lastResult.bytes),  color: "var(--gray-700)" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color }}>{value}</div>
                </div>
              ))}
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Tx hash</div>
                <TxHashCell hash={lastResult.txHash} network={network} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// History table with full pagination
function HistoryTable({ displayHistory, totalCount }: {
  displayHistory: any[];
  totalCount: number;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(displayHistory.length / HISTORY_PER_PAGE);
  const paged = displayHistory.slice(page * HISTORY_PER_PAGE, (page + 1) * HISTORY_PER_PAGE);

  if (totalCount === 0) return (
    <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>📊</div>
      <div style={{ fontSize: 14, color: "var(--gray-400)" }}>No benchmark history in this browser yet</div>
      <div style={{ fontSize: 12, color: "var(--gray-300)", marginTop: 6 }}>History is stored per browser. Other browsers on the same device will start fresh.</div>
    </div>
  );

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Benchmark history</div>
          <div className="card-subtitle">
            {totalCount} runs · stored in this browser
            {pages > 1 && ` · Page ${page + 1}/${pages}`}
          </div>
        </div>
      </div>
      <div className="card-body" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", minWidth: 600 }}>
          <thead>
            <tr><th>#</th><th>Mode</th><th>Score</th><th>Tier</th><th>Upload</th><th>Download</th><th>Latency</th><th>TX</th><th>Max blob</th><th>At</th></tr>
          </thead>
          <tbody>
            {paged.map((h: any) => {
              const c = TIER_COLOR[h.tier] ?? "#6b7280";
              return (
                <tr key={h.id}>
                  <td><span className="mono" style={{ color: "var(--gray-400)", fontSize: 11 }}>#{h.id}</span></td>
                  <td><span style={{ fontSize: 10, fontWeight: 600, color: h.mode === "adaptive" ? "#2563eb" : "#9333ea", textTransform: "uppercase" }}>{h.mode}</span></td>
                  <td><span className="mono" style={{ fontWeight: 700, color: c }}>{h.score}</span></td>
                  <td><span style={{ fontSize: 11, color: c, fontWeight: 600 }}>{h.tier}</span></td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{fmtKbs(h.avgUploadKbs)}</span></td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{fmtKbs(h.avgDownloadKbs)}</span></td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{fmtMs(h.latency?.avg ?? 0)}</span></td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{fmtMs(h.tx?.confirmTime ?? 0)}</span></td>
                  <td><span className="mono" style={{ fontSize: 11, color: "var(--gray-500)" }}>{h.maxSuccessfulBytes ? fmtBytes(h.maxSuccessfulBytes) : "—"}</span></td>
                  <td><span style={{ fontSize: 10, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>{h.runAt}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--gray-100)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid var(--gray-200)", background: "#fff", color: "var(--gray-500)", cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? .4 : 1, fontSize: 13 }}>←</button>
          {Array.from({ length: Math.min(pages, 10) }, (_, i) => i).map(i => (
            <button key={i} onClick={() => setPage(i)}
              style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--gray-200)", background: i === page ? "var(--net-color, #2563eb)" : "#fff", color: i === page ? "#fff" : "var(--gray-500)", cursor: "pointer", fontWeight: i === page ? 700 : 400, fontSize: 13, minWidth: 34 }}>{i + 1}</button>
          ))}
          {pages > 10 && <span style={{ fontSize: 12, color: "var(--gray-400)" }}>…{pages}</span>}
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page === pages - 1}
            style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid var(--gray-200)", background: "#fff", color: "var(--gray-500)", cursor: page === pages - 1 ? "not-allowed" : "pointer", opacity: page === pages - 1 ? .4 : 1, fontSize: 13 }}>→</button>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const { config, network } = useNetwork();
  const deviceId = useDeviceId();
  const { history, saveRun, displayHistory } = useBenchHistory();

  const [phase,      setPhase]     = useState<Phase>("idle");
  const [log,        setLog]       = useState<string[]>([]);
  const [result,     setResult]    = useState<BenchResult | null>(null);
  const [balance,    setBalance]   = useState<Balance | null>(null);
  const [diagnose,   setDiagnose]  = useState<DiagnoseResult | null>(null);
  const [diagLoad,   setDiagLoad]  = useState(true);
  const [showCustom, setShowCustom] = useState(false);
  const [activeTab,  setActiveTab]  = useState<"run" | "history">("run");
  const [benchMode,  setBenchMode]  = useState<"adaptive" | "standard">("adaptive");

  const logRef   = useRef<HTMLDivElement>(null);
  const runIdRef = useRef(0);

  const addLog = useCallback((t: string) => setLog(p => [...p.slice(-100), t]), []);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const runDiagnose = useCallback(async () => {
    setDiagLoad(true);
    try {
      const d = await callWithDevice<DiagnoseResult>("/api/benchmark/diagnose");
      setDiagnose(d);
    } catch (e: any) {
      setDiagnose({ ready: false, passCount: 0, failCount: 1, warnCount: 0, checks: [{ name: "Backend API", status: "fail", hint: e.message }], summary: "Cannot connect" });
    } finally { setDiagLoad(false); }
  }, []);

  const refreshBalance = useCallback(() => {
    callWithDevice<Balance>("/api/benchmark/balance").then(setBalance).catch(() => {});
  }, []);

  useEffect(() => { runDiagnose(); refreshBalance(); }, [runDiagnose, refreshBalance]);

  const run = useCallback(async () => {
    if (!diagnose?.ready) { await runDiagnose(); return; }
    const myRun = ++runIdRef.current;
    setPhase("checking"); setLog([]); setResult(null);

    try {
      addLog("— [1/5] Wallet balance…");
      const bal = await callWithDevice<Balance>("/api/benchmark/balance");
      setBalance(bal);
      if (myRun !== runIdRef.current) return;
      if (!bal.ready) throw new Error("Insufficient balance — click Faucet");
      addLog(`✓ ${bal.apt.toFixed(4)} APT · ${bal.shelbyusd.toFixed(6)} ShelbyUSD`);

      setPhase("latency");
      addLog("— [2/5] Latency (5 ping)…");
      const latency = await callWithDevice<LatResult>("/api/benchmark/latency");
      if (myRun !== runIdRef.current) return;
      addLog(`✓ avg ${fmtMs(latency.avg)} · min ${fmtMs(latency.min)} · max ${fmtMs(latency.max)}`);

      setPhase("upload");
      const uploads: UpResult[] = [];
      let maxSuccessfulBytes = 0;

      if (benchMode === "adaptive") {
        addLog(`— [3/5] Adaptive stress test (${ADAPTIVE_SIZES.length} sizes: 1KB → 10MB)…`);
        for (let i = 0; i < ADAPTIVE_SIZES.length; i++) {
          if (myRun !== runIdRef.current) return;
          const bytes = ADAPTIVE_SIZES[i];
          addLog(`  ↑ [${i+1}/${ADAPTIVE_SIZES.length}] ${fmtBytes(bytes)}…`);
          try {
            const u = await callWithDevice<UpResult>("/api/benchmark/upload", { adaptiveBytes: bytes });
            if (myRun !== runIdRef.current) return;
            uploads.push(u);
            maxSuccessfulBytes = bytes;
            addLog(`  ✓ ${fmtBytes(bytes)}: ${fmtKbs(u.speedKbs)} · ${fmtMs(u.elapsed)}${u.txHash ? ` · tx ${u.txHash.slice(0,8)}…` : ""}`);
          } catch (e: any) {
            addLog(`  ✗ ${fmtBytes(bytes)}: ${e.message} — stopping`);
            break;
          }
        }
        if (uploads.length === 0) throw new Error("All uploads failed");
        addLog(`✓ Uploaded ${uploads.length} files · Max: ${fmtBytes(maxSuccessfulBytes)}`);
      } else {
        // Quick mode: 1KB / 10KB / 100KB using explicit sizeBytes
        addLog("— [3/5] Quick upload (1KB / 10KB / 100KB)…");
        for (let i = 0; i < STANDARD_SIZES.length; i++) {
          if (myRun !== runIdRef.current) return;
          const sz = STANDARD_SIZES[i];
          addLog(`  ↑ [${i+1}/3] ${fmtBytes(sz)}…`);
          const u = await callWithDevice<UpResult>("/api/benchmark/upload", { sizeBytes: sz });
          if (myRun !== runIdRef.current) return;
          uploads.push(u);
          maxSuccessfulBytes = sz;
          addLog(`  ✓ ${fmtBytes(sz)}: ${fmtKbs(u.speedKbs)} · ${fmtMs(u.elapsed)}`);
        }
      }

      setPhase("download");
      // FIXED: Download ALL uploaded blobs (not just last 3)
      const blobsToDownload = uploads.filter(u => u.blobName);
      addLog(`— [4/5] Download (${blobsToDownload.length} blobs)…`);
      const downloads: DlResult[] = [];
      for (const up of blobsToDownload) {
        if (myRun !== runIdRef.current) return;
        try {
          const d = await callWithDevice<DlResult>("/api/benchmark/download", { blobName: up.blobName });
          if (myRun !== runIdRef.current) return;
          downloads.push(d);
          addLog(`  ✓ ${fmtBytes(d.bytes)}: ${fmtKbs(d.speedKbs)} · ${fmtMs(d.elapsed)}`);
        } catch (e: any) { addLog(`  ✗ download: ${e.message}`); }
      }

      setPhase("txtime");
      addLog("— [5/5] Aptos TX timing…");
      const tx = await callWithDevice<TxResult>("/api/benchmark/txtime");
      if (myRun !== runIdRef.current) return;
      addLog(`✓ Submit: ${fmtMs(tx.submitTime)} · Confirm: ${fmtMs(tx.confirmTime)}${tx.txHash ? ` · tx ${tx.txHash.slice(0,10)}…` : ""}`);

      const avgUp   = uploads.reduce((s, u) => s + u.speedKbs, 0) / uploads.length;
      const avgDown = downloads.length ? downloads.reduce((s, d) => s + d.speedKbs, 0) / downloads.length : 0;
      const { score, tier } = calcScore({ avgUploadKbs: avgUp, avgDownloadKbs: avgDown, latency, tx });

      const res: BenchResult = {
        latency, uploads, downloads, tx,
        avgUploadKbs: avgUp, avgDownloadKbs: avgDown, score, tier,
        runAt: new Date().toLocaleString(), maxSuccessfulBytes, mode: benchMode,
      };
      setResult(res);
      setPhase("done");

      // Save to local history
      saveRun(res);
      // Save to server
      await saveResultToServer(res);
      await signalRunEnd();

      addLog(`— Done · Score: ${score}/1000 (${tier}) · Max blob: ${fmtBytes(maxSuccessfulBytes)}`);

    } catch (e: any) {
      if (myRun !== runIdRef.current) return;
      setPhase("error");
      addLog(`✗ ${e.message}`);
      await signalRunEnd();
    }
  }, [diagnose, runDiagnose, addLog, saveRun, benchMode]);

  const requestFaucet = useCallback(async () => {
    addLog("— Requesting faucet…");
    try {
      await callWithDevice("/api/benchmark/faucet", {});
      addLog("✓ Requested — balance updates in ~5s");
      setTimeout(refreshBalance, 5000);
    } catch (e: any) { addLog(`✗ ${e.message}`); }
  }, [refreshBalance, addLog]);

  const running = !["idle", "done", "error"].includes(phase);
  if (network === "testnet") return <TestnetBanner />;

  const totalHistoryCount = history.length;

  return (
    <div>
      <style>{`
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 var(--net-color, #2563eb)55; }
          70%  { box-shadow: 0 0 0 7px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .bench-log { padding: 12px 20px; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>Benchmark tool</h1>
          <p style={{ fontSize: 13, margin: "4px 0 0", color: "var(--text-muted)" }}>
            Upload · download · latency · TX speed on <strong>{config.label}</strong>
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Device ID badge */}
          {deviceId && (
            <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", background: "var(--bg-card2)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px" }}>
              Device: {`dev_${deviceId.replace(/-/g,"").slice(0,8)}`}
            </div>
          )}
          <div style={{ display: "flex", background: "#f4f4f4", borderRadius: 10, padding: 3, gap: 2 }}>
            {(["run", "history"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? "#0a0a0a" : "#999",
                background: activeTab === tab ? "#fff" : "transparent",
                boxShadow: activeTab === tab ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                border: "none", cursor: "pointer",
              }}>
                {tab === "run" ? "▶ Run" : `📊 History${totalHistoryCount > 0 ? ` (${totalHistoryCount})` : ""}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pre-flight */}
      <DiagnosePanel result={diagnose} loading={diagLoad} onRecheck={runDiagnose} />

      {/* Wallet */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              { label: "APT",       value: balance ? balance.apt.toFixed(4)       : "—", ok: (balance?.apt       ?? 0) >= 0.1   },
              { label: "ShelbyUSD", value: balance ? balance.shelbyusd.toFixed(6) : "—", ok: (balance?.shelbyusd ?? 0) >= 0.001 },
              ...(balance?.address ? [{ label: "Wallet", value: `${balance.address.slice(0,10)}…${balance.address.slice(-5)}`, ok: true }] : []),
            ].map(({ label, value, ok }) => (
              <div key={label}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 3 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: ok ? "var(--gray-900)" : "#dc2626" }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={requestFaucet} disabled={running} className="btn btn-secondary">↯ Faucet</button>
            <a href="https://docs.shelby.xyz/sdks/typescript/fund-your-account" target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ background: "white" }}>Docs ↗</a>
          </div>
        </div>
      </div>

      {activeTab === "run" && (
        <>
          <div className="card" style={{ marginBottom: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--gray-500)", fontWeight: 500 }}>Mode:</span>
              {(["adaptive", "standard"] as const).map(m => (
                <button key={m} onClick={() => setBenchMode(m)} disabled={running} style={{
                  padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: benchMode === m ? 600 : 400, cursor: "pointer",
                  border:     `1px solid ${benchMode === m ? "var(--net-color, #2563eb)" : "var(--gray-200)"}`,
                  background: benchMode === m ? "var(--net-bg, #eff6ff)" : "transparent",
                  color:      benchMode === m ? "var(--net-color, #2563eb)" : "var(--gray-500)",
                }}>
                  {m === "adaptive" ? "Adaptive" : "Quick"}
                </button>
              ))}
              <span style={{ fontSize: 11, color: "var(--gray-400)" }}>
                {benchMode === "adaptive" ? "1KB → 64KB → 512KB → 2MB → 5MB → 10MB" : "1KB / 10KB / 100KB"}
              </span>
            </div>

            <button onClick={run} disabled={running} className="btn btn-primary"
              style={{ width: "100%", padding: "13px 0", fontSize: 15, justifyContent: "center", borderRadius: 12,
                marginBottom: running || phase !== "idle" ? 16 : 0, opacity: (!diagnose?.ready && !running) ? 0.6 : 1 }}>
              {running
                ? `Running — ${STEPS.find(s => s.phase === phase)?.label ?? phase}…`
                : !diagnose?.ready ? "⚠ Fix issues first"
                : result ? "⟳ Run again" : "▶ Start benchmark"}
            </button>

            {(running || phase === "done" || phase === "error") && <ProgressBar phase={phase} running={running} />}
          </div>

          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setShowCustom(v => !v)} className="btn btn-secondary" style={{ fontSize: 12 }}>
              {showCustom ? "▲ Hide" : "▼"} Custom upload (max {fmtBytes(MAX_CUSTOM_BYTES)})
            </button>
          </div>
          {showCustom && <CustomUploadCard running={running} network={network} />}

          {log.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div className="card-title">System log</div>
                <button onClick={() => setLog([])} className="btn btn-secondary" style={{ fontSize: 11 }}>Clear</button>
              </div>
              <div ref={logRef} className="bench-log" style={{ maxHeight: 240, overflowY: "auto" }}>
                {log.map((line, i) => <LogLine key={i} text={line} />)}
              </div>
            </div>
          )}

          {result && phase === "done" && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">Benchmark results</div>
                  <div className="card-subtitle">{config.label} · {result.runAt} · {result.mode}</div>
                </div>
              </div>
              <div className="card-body">
                <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 24 }}>
                  <ScoreRing score={result.score} tier={result.tier} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    {result.maxSuccessfulBytes && result.mode === "adaptive" && (
                      <div style={{ display: "inline-flex", gap: 6, marginBottom: 12, padding: "4px 10px", borderRadius: 6, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                        <span style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600 }}>Max blob:</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#2563eb", fontWeight: 700 }}>{fmtBytes(result.maxSuccessfulBytes)}</span>
                      </div>
                    )}
                    <SpeedBar value={result.avgUploadKbs}   max={2000} label="Avg upload"   color="#2563eb" />
                    <SpeedBar value={result.avgDownloadKbs} max={5000} label="Avg download" color="#16a34a" />
                    <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
                      {[
                        { label: "Avg latency", value: fmtMs(result.latency.avg)    },
                        { label: "TX submit",   value: fmtMs(result.tx.submitTime)  },
                        { label: "TX confirm",  value: fmtMs(result.tx.confirmTime) },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div style={{ fontSize: 10, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: "var(--gray-800)" }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ padding: "12px 14px", borderRadius: 8, background: "#f9fafb", border: "1px solid #f0f0f0", marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 8 }}>Score breakdown</div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {[
                      { label: "Upload 40%",   pts: Math.min(400, result.avgUploadKbs * 1.0),                                     max: 400, color: "#2563eb" },
                      { label: "Download 25%", pts: Math.min(250, result.avgDownloadKbs * 0.05),                                  max: 250, color: "#16a34a" },
                      { label: "Latency 20%",  pts: Math.round(200 * Math.max(0, 1 - result.latency.avg / 5000)),    max: 200, color: "#9333ea" },
                      { label: "TX 15%",       pts: Math.round(150 * Math.max(0, 1 - result.tx.confirmTime / 8000)), max: 150, color: "#f59e0b" },
                    ].map(({ label, pts, max, color }) => (
                      <div key={label} style={{ flex: 1, minWidth: 100 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 10 }}>
                          <span style={{ color: "var(--gray-500)" }}>{label}</span>
                          <span style={{ fontFamily: "var(--font-mono)", color, fontWeight: 600 }}>{Math.round(pts)}/{max}</span>
                        </div>
                        <div style={{ height: 4, background: "#f0f0f0", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(pts / max) * 100}%`, background: color, borderRadius: 2, transition: "width 1s" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 8 }}>Upload details</div>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ width: "100%", minWidth: 400 }}>
                    <thead><tr><th>Size</th><th>Speed</th><th>Time</th><th>Tx hash</th></tr></thead>
                    <tbody>
                      {result.uploads.map((u, i) => (
                        <tr key={i}>
                          <td><span className="mono">{fmtBytes(u.bytes)}</span></td>
                          <td><span className="mono" style={{ color: "#2563eb", fontWeight: 600 }}>{fmtKbs(u.speedKbs)}</span></td>
                          <td><span className="mono" style={{ color: "var(--gray-500)" }}>{fmtMs(u.elapsed)}</span></td>
                          <td><TxHashCell hash={u.txHash} network={network} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {result.downloads.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginTop: 16, marginBottom: 8 }}>Download details</div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="data-table" style={{ width: "100%", minWidth: 320 }}>
                        <thead><tr><th>#</th><th>Size</th><th>Speed</th><th>Time</th></tr></thead>
                        <tbody>
                          {result.downloads.map((d, i) => (
                            <tr key={i}>
                              <td><span className="mono" style={{ color: "var(--gray-400)" }}>{i+1}</span></td>
                              <td><span className="mono">{fmtBytes(d.bytes)}</span></td>
                              <td><span className="mono" style={{ color: "#16a34a", fontWeight: 600 }}>{fmtKbs(d.speedKbs)}</span></td>
                              <td><span className="mono" style={{ color: "var(--gray-500)" }}>{fmtMs(d.elapsed)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "history" && (
        <HistoryTable displayHistory={displayHistory} totalCount={totalHistoryCount} />
      )}
    </div>
  );
}