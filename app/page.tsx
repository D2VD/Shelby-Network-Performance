"use client";
/**
 * app/page.tsx — Benchmark Page v5.2
 *
 * Upgrades vs v4:
 *  - Tách biệt upload timing vs txtime (hiển thị riêng Upload Speed và TX Confirm)
 *  - Hiển thị TxHash có link Explorer cho mỗi upload
 *  - Custom Upload: user tự chọn file < 3 MB
 *  - Công thức score mới: cân bằng hơn, không bị dominated bởi latency
 *  - Progress bar per-step thay vì chỉ phase label
 *  - Copy-to-clipboard TxHash
 *  - History tab: lưu localStorage tối đa 10 lần chạy gần nhất
 *  - Live speed animating counter khi đang upload
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "diagnose"
  | "checking"
  | "latency"
  | "upload"
  | "download"
  | "txtime"
  | "done"
  | "error";

interface LatResult  { avg: number; min: number; max: number; samples?: number[] }
interface UpResult   { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null }
interface DlResult   { bytes: number; elapsed: number; speedKbs: number }
interface TxResult   { submitTime: number; confirmTime: number; txHash: string | null }
interface Balance    { apt: number; shelbyusd: number; ready: boolean; address: string }
interface DiagnoseCheck { name: string; status: "pass" | "fail" | "warn"; value?: string; hint?: string }
interface DiagnoseResult {
  ready: boolean;
  passCount: number;
  failCount: number;
  warnCount: number;
  checks: DiagnoseCheck[];
  summary: string;
  workerVersion?: string;
  workerDeployed?: boolean;
}

interface BenchResult {
  latency:        LatResult;
  uploads:        UpResult[];
  downloads:      DlResult[];
  tx:             TxResult;
  avgUploadKbs:   number;
  avgDownloadKbs: number;
  score:          number;
  tier:           string;
  runAt:          string;
}

interface HistoryEntry extends BenchResult {
  id: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SIZE_LABELS: Record<number, string> = {
  1024:    "1 KB",
  10240:   "10 KB",
  102400:  "100 KB",
};

const STEPS = [
  { phase: "checking", label: "Wallet check",        icon: "◎", pct: 5  },
  { phase: "latency",  label: "Blockchain latency",  icon: "◌", pct: 20 },
  { phase: "upload",   label: "Blob upload (3 sizes)",icon: "↑", pct: 60 },
  { phase: "download", label: "Blob download",        icon: "↓", pct: 85 },
  { phase: "txtime",   label: "TX timing",            icon: "⬡", pct: 98 },
  { phase: "done",     label: "Complete",             icon: "✓", pct: 100},
];

const PHASE_PCT: Record<string, number> = Object.fromEntries(
  STEPS.map(s => [s.phase, s.pct])
);

const LOCAL_KEY = "shelby_bench_history_v2";
const MAX_HISTORY = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtKbs = (k: number) =>
  k >= 1024 ? `${(k / 1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;

const fmtMs = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)}s` : `${m.toFixed(0)}ms`;

const fmtBytes = (b: number) => {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(2)} MB`;
  if (b >= 1024)      return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
};

/**
 * Score v5.2 — cân bằng 4 thành phần, cap từng thành phần tránh outlier
 *   Upload  (40%): 400 pts max → 1 pt per KB/s capped 400
 *   Download(25%): 250 pts max → 0.05 pt per KB/s capped 250
 *   Latency (20%): 200 pts max → 200 × (1 - clamp(avg/5000))
 *   TxTime  (15%): 150 pts max → 150 × (1 - clamp(confirm/8000))
 */
function calcScore(r: {
  avgUploadKbs:   number;
  avgDownloadKbs: number;
  latency:        LatResult;
  tx:             TxResult;
}): { score: number; tier: string } {
  const upScore  = Math.min(400, r.avgUploadKbs * 1.0);
  const dlScore  = Math.min(250, r.avgDownloadKbs * 0.05);
  const latScore = 200 * Math.max(0, 1 - r.latency.avg / 5000);
  const txScore  = 150 * Math.max(0, 1 - r.tx.confirmTime / 8000);
  const score    = Math.round(upScore + dlScore + latScore + txScore);

  let tier = "Poor";
  if      (score >= 900) tier = "Blazing Fast";
  else if (score >= 700) tier = "Excellent";
  else if (score >= 450) tier = "Good";
  else if (score >= 200) tier = "Fair";

  return { score, tier };
}

const TIER_COLOR: Record<string, string> = {
  "Blazing Fast": "#16a34a",
  "Excellent":    "#059669",
  "Good":         "#ca8a04",
  "Fair":         "#d97706",
  "Poor":         "#dc2626",
};

const call = async <T,>(url: string, body?: object | FormData): Promise<T> => {
  const isFormData = body instanceof FormData;
  const r = await fetch(url, body
    ? {
        method:  "POST",
        headers: isFormData ? undefined : { "Content-Type": "application/json" },
        body:    isFormData ? body : JSON.stringify(body),
      }
    : { method: "GET" }
  );
  if (!r.ok) {
    const err: any = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function LogLine({ text }: { text: string }) {
  const isErr  = text.startsWith("✗");
  const isOk   = text.startsWith("✓") || text.startsWith("Done");
  const isHdr  = text.startsWith("—");
  const isSub  = text.startsWith("  ");
  return (
    <div style={{
      fontFamily: "var(--font-mono)",
      fontSize:   13,
      lineHeight: 1.75,
      color: isErr ? "#ef4444"
           : isOk  ? "#16a34a"
           : isHdr ? "#6366f1"
           : isSub ? "#9ca3af"
           : "#c0ccd8",
      paddingLeft: isSub && !isOk ? 16 : 0,
    }}>
      {text}
    </div>
  );
}

function ProgressBar({ phase, running }: { phase: Phase; running: boolean }) {
  const pct = PHASE_PCT[phase] ?? (phase === "idle" ? 0 : 100);

  return (
    <div>
      <div style={{
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        marginBottom:   8,
        fontSize:       12,
        color:          "var(--gray-400)",
        fontFamily:     "var(--font-mono)",
      }}>
        <span style={{ color: running ? "var(--gray-700)" : "var(--gray-400)", fontWeight: running ? 600 : 400 }}>
          {running
            ? STEPS.find(s => s.phase === phase)?.label ?? phase
            : phase === "done"
            ? "Complete"
            : phase === "error"
            ? "Error"
            : "Ready"}
        </span>
        <span>{pct}%</span>
      </div>
      <div style={{
        height:       5,
        background:   "var(--gray-100)",
        borderRadius: 10,
        overflow:     "hidden",
      }}>
        <div style={{
          height:     "100%",
          width:      `${pct}%`,
          background: phase === "error"
            ? "#ef4444"
            : phase === "done"
            ? "#16a34a"
            : "var(--net-color, #2563eb)",
          borderRadius:   10,
          transition:     "width 0.6s ease, background 0.3s",
          boxShadow:      running ? "0 0 8px var(--net-color, #2563eb)88" : "none",
        }} />
      </div>

      {/* Step dots */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        {STEPS.map(s => {
          const done    = PHASE_PCT[phase] >= s.pct && phase !== "idle";
          const current = s.phase === phase;
          return (
            <div key={s.phase} style={{
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              gap:            4,
              opacity:        done || current ? 1 : 0.3,
              transition:     "opacity 0.4s",
            }}>
              <div style={{
                width:        22,
                height:       22,
                borderRadius: "50%",
                background:   done
                  ? (phase === "error" ? "#ef4444" : "var(--net-color, #2563eb)")
                  : current
                  ? "transparent"
                  : "#f0f0f0",
                border:       current
                  ? "2px solid var(--net-color, #2563eb)"
                  : "2px solid transparent",
                display:      "flex",
                alignItems:   "center",
                justifyContent: "center",
                fontSize:     10,
                color:        done ? "#fff" : current ? "var(--net-color, #2563eb)" : "#999",
                transition:   "background 0.3s",
                animation:    current && running ? "pulse-ring 1.5s infinite" : "none",
              }}>
                {done ? "✓" : s.icon}
              </div>
              <span style={{
                fontSize:   9,
                color:      current ? "var(--net-color)" : "var(--gray-400)",
                fontFamily: "var(--font-mono)",
                textAlign:  "center",
                maxWidth:   52,
                lineHeight: 1.3,
              }}>
                {s.label.split(" ").slice(0, 2).join(" ")}
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
  const r     = 46;
  const c     = 2 * Math.PI * r;
  const pct   = Math.min(100, (score / 1000) * 100);
  const dash  = (pct / 100) * c;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={116} height={116} viewBox="0 0 116 116">
        <circle cx={58} cy={58} r={r} fill="none" stroke="#f0f0f0" strokeWidth={8} />
        <circle
          cx={58} cy={58} r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 58 58)"
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)" }}
        />
        <text x={58} y={53} textAnchor="middle" fill={color}  fontSize={24} fontWeight={700} fontFamily="var(--font-mono)">{score}</text>
        <text x={58} y={70} textAnchor="middle" fill="#9ca3af" fontSize={10} fontFamily="var(--font-sans)">{tier.toUpperCase()}</text>
      </svg>
      <div style={{ fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
        SCORE / 1000
      </div>
    </div>
  );
}

function SpeedBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: "var(--gray-500)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color, fontWeight: 600 }}>{fmtKbs(value)}</span>
      </div>
      <div style={{ height: 5, background: "var(--gray-100)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height:     "100%",
          width:      `${pct}%`,
          background: color,
          borderRadius: 3,
          transition: "width 0.8s cubic-bezier(.4,0,.2,1)",
        }} />
      </div>
    </div>
  );
}

function TxHashCell({ hash, network }: { hash: string | null; network: string }) {
  const [copied, setCopied] = useState(false);

  if (!hash) return <span style={{ color: "var(--gray-300)" }}>—</span>;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <a
        href={`https://explorer.aptoslabs.com/txn/${hash}?network=${network}`}
        target="_blank"
        rel="noreferrer"
        style={{
          color:          "var(--info, #2563eb)",
          fontSize:       12,
          fontFamily:     "var(--font-mono)",
          textDecoration: "none",
        }}
        title={hash}
      >
        {hash.slice(0, 8)}…{hash.slice(-6)} ↗
      </a>
      <button
        onClick={handleCopy}
        title="Copy full hash"
        style={{
          background: "none",
          border:     "none",
          cursor:     "pointer",
          padding:    "0 2px",
          fontSize:   11,
          color:      copied ? "#16a34a" : "var(--gray-400)",
          transition: "color 0.2s",
        }}
      >
        {copied ? "✓" : "⎘"}
      </button>
    </span>
  );
}

function DiagnosePanel({
  result,
  loading,
  onRecheck,
}: {
  result:    DiagnoseResult | null;
  loading:   boolean;
  onRecheck: () => void;
}) {
  const statusIcon:  Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠" };
  const statusColor: Record<string, string> = { pass: "#16a34a", fail: "#ef4444", warn: "#f59e0b" };
  const statusBg:    Record<string, string> = { pass: "#f0fdf4", fail: "#fef2f2", warn: "#fffbeb" };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Pre-flight checks</div>
          <div className="card-subtitle">
            {loading
              ? "Checking system…"
              : result
              ? result.ready
                ? `✓ ${result.passCount} checks passed · API v${result.workerVersion ?? "?"}`
                : `⚠ ${result.failCount} issue(s) need fixing`
              : "Connect to backend to start"}
          </div>
        </div>
        <button
          onClick={onRecheck}
          disabled={loading}
          className="btn btn-secondary"
          style={{ fontSize: 12 }}
        >
          {loading ? "⟳ Checking…" : "⟳ Recheck"}
        </button>
      </div>

      <div className="card-body" style={{ padding: "0 20px 16px" }}>
        {loading && !result && (
          <div style={{ padding: "16px 0" }}>
            <div className="skeleton" style={{ height: 140, borderRadius: 6 }} />
          </div>
        )}

        {result?.checks && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 16 }}>
            {result.checks.map((c, i) => (
              <div
                key={i}
                style={{
                  display:       "flex",
                  alignItems:    "flex-start",
                  gap:           10,
                  padding:       "8px 12px",
                  borderRadius:  8,
                  background:    statusBg[c.status] ?? "#f9fafb",
                  border:        `1px solid ${c.status === "fail" ? "#fecaca" : c.status === "warn" ? "#fde68a" : "#e5e7eb"}`,
                }}
              >
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize:   13,
                  fontWeight: 700,
                  color:      statusColor[c.status],
                  flexShrink: 0,
                  width:      16,
                  paddingTop: 2,
                }}>
                  {statusIcon[c.status]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--gray-800)" }}>{c.name}</span>
                    {c.value && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gray-500)", flexShrink: 0 }}>
                        {c.value}
                      </span>
                    )}
                  </div>
                  {c.hint && (
                    <div style={{ fontSize: 12, color: "var(--gray-500)", marginTop: 2 }}>{c.hint}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && result && !result.ready && (
          <div style={{
            marginTop:    12,
            padding:      "10px 14px",
            borderRadius: 8,
            background:   "#fef2f2",
            border:       "1px solid #fecaca",
            fontSize:     13,
            color:        "#b91c1c",
          }}>
            {result.summary}
          </div>
        )}
      </div>
    </div>
  );
}

/** Custom file upload picker — max 3 MB */
function CustomUploadCard({
  onResult,
  running,
  network,
}: {
  onResult: (r: UpResult) => void;
  running:  boolean;
  network:  string;
}) {
  const [file,      setFile]      = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastResult,setLastResult] = useState<UpResult | null>(null);
  const [err,       setErr]       = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const MAX_MB = 3;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setErr(`File exceeds ${MAX_MB} MB limit (${fmtBytes(f.size)})`);
      return;
    }
    setErr(null);
    setFile(f);
    setLastResult(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      // Convert to base64 and POST as JSON — backend reads body.data + body.bytes + body.blobName
      const arrayBuffer = await file.arrayBuffer();
      const bytes       = Array.from(new Uint8Array(arrayBuffer));
      const r = await call<UpResult>("/api/benchmark/upload", {
        customData: bytes,
        bytes:      file.size,
        blobName:   `custom/${file.name}/${Date.now()}`,
      });
      setLastResult(r);
      onResult(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Custom upload</div>
          <div className="card-subtitle">Upload your own file (max {MAX_MB} MB) to benchmark with real data</div>
        </div>
      </div>

      <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          style={{
            flex:           1,
            minWidth:       200,
            border:         "1.5px dashed var(--gray-200)",
            borderRadius:   10,
            padding:        "14px 18px",
            cursor:         "pointer",
            display:        "flex",
            alignItems:     "center",
            gap:            12,
            transition:     "border-color 0.2s",
            background:     file ? "#f0fdf4" : "#fafafa",
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--net-color, #2563eb)")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--gray-200)")}
        >
          <span style={{ fontSize: 22 }}>{file ? "📄" : "📂"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {file ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-800)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>
                  {fmtBytes(file.size)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: "var(--gray-400)" }}>
                Click to select file
              </div>
            )}
          </div>
          <input ref={inputRef} type="file" onChange={handleFile} style={{ display: "none" }} />
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || uploading || running}
          className="btn btn-primary"
          style={{ flexShrink: 0, opacity: (!file || uploading || running) ? 0.5 : 1 }}
        >
          {uploading ? "Uploading…" : "↑ Upload"}
        </button>
      </div>

      {err && (
        <div style={{ margin: "8px 20px 12px", padding: "8px 12px", borderRadius: 7, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 13, color: "#b91c1c" }}>
          {err}
        </div>
      )}

      {lastResult && (
        <div style={{ margin: "8px 20px 14px", padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Speed</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: "#16a34a" }}>{fmtKbs(lastResult.speedKbs)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Time</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: "var(--gray-700)" }}>{fmtMs(lastResult.elapsed)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Size</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: "var(--gray-700)" }}>{fmtBytes(lastResult.bytes)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Tx hash</div>
              <TxHashCell hash={lastResult.txHash} network={network} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTable({ history }: { history: HistoryEntry[] }) {
  if (!history.length) return null;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-title">Recent runs</div>
          <div className="card-subtitle">Last {history.length} benchmark results</div>
        </div>
      </div>
      <div className="card-body" style={{ padding: 0, overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Score</th>
              <th>Tier</th>
              <th>Avg Upload</th>
              <th>Avg Download</th>
              <th>Latency</th>
              <th>TX Confirm</th>
              <th>Run at</th>
            </tr>
          </thead>
          <tbody>
            {history.slice().reverse().map((h) => {
              const color = TIER_COLOR[h.tier] ?? "#6b7280";
              return (
                <tr key={h.id}>
                  <td><span className="mono" style={{ color: "var(--gray-400)" }}>#{h.id}</span></td>
                  <td><span className="mono" style={{ fontWeight: 700, color }}>{h.score}</span></td>
                  <td><span style={{ fontSize: 12, color, fontWeight: 600 }}>{h.tier}</span></td>
                  <td><span className="mono">{fmtKbs(h.avgUploadKbs)}</span></td>
                  <td><span className="mono">{fmtKbs(h.avgDownloadKbs)}</span></td>
                  <td><span className="mono">{fmtMs(h.latency.avg)}</span></td>
                  <td><span className="mono">{fmtMs(h.tx.confirmTime)}</span></td>
                  <td><span style={{ fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>{h.runAt}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const { config, network } = useNetwork();

  const [phase,     setPhase]     = useState<Phase>("idle");
  const [log,       setLog]       = useState<string[]>([]);
  const [result,    setResult]    = useState<BenchResult | null>(null);
  const [balance,   setBalance]   = useState<Balance | null>(null);
  const [diagnose,  setDiagnose]  = useState<DiagnoseResult | null>(null);
  const [diagLoad,  setDiagLoad]  = useState(true);
  const [history,   setHistory]   = useState<HistoryEntry[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [activeTab,  setActiveTab]  = useState<"run" | "history">("run");

  const logRef = useRef<HTMLDivElement>(null);
  const runIdRef = useRef(0);

  const addLog = useCallback((t: string) => setLog(p => [...p.slice(-80), t]), []);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const saveToHistory = useCallback((res: BenchResult) => {
    setHistory(prev => {
      const id     = (prev[prev.length - 1]?.id ?? 0) + 1;
      const entry: HistoryEntry = { ...res, id };
      const next   = [...prev, entry].slice(-MAX_HISTORY);
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const runDiagnose = useCallback(async () => {
    setDiagLoad(true);
    try {
      const d = await call<DiagnoseResult>("/api/benchmark/diagnose");
      setDiagnose(d);
    } catch (e: any) {
      setDiagnose({
        ready: false, passCount: 0, failCount: 1, warnCount: 0,
        checks: [{ name: "Backend API", status: "fail", hint: e.message }],
        summary: "Cannot connect to Backend API — check VPS and Cloudflare Tunnel",
      });
    } finally {
      setDiagLoad(false);
    }
  }, []);

  const refreshBalance = useCallback(() => {
    call<Balance>("/api/benchmark/balance").then(setBalance).catch(() => {});
  }, []);

  useEffect(() => {
    runDiagnose();
    refreshBalance();
  }, [runDiagnose, refreshBalance]);

  const run = useCallback(async () => {
    if (!diagnose?.ready) { await runDiagnose(); return; }

    const myRun = ++runIdRef.current;
    setPhase("checking");
    setLog([]);
    setResult(null);

    try {
      // ── 1. Wallet check ──────────────────────────────────────────────────
      addLog("— [1/5] Checking wallet balance…");
      const bal = await call<Balance>("/api/benchmark/balance");
      setBalance(bal);
      if (myRun !== runIdRef.current) return;
      if (!bal.ready) throw new Error("Insufficient balance — click 'Request faucet'");
      addLog(`✓ APT: ${bal.apt.toFixed(4)} · ShelbyUSD: ${bal.shelbyusd.toFixed(6)}`);

      // ── 2. Latency ───────────────────────────────────────────────────────
      setPhase("latency");
      addLog("— [2/5] Measuring blockchain latency (5 pings)…");
      const latency = await call<LatResult>("/api/benchmark/latency");
      if (myRun !== runIdRef.current) return;
      addLog(`✓ avg: ${fmtMs(latency.avg)} · min: ${fmtMs(latency.min)} · max: ${fmtMs(latency.max)}`);

      // ── 3. Uploads ───────────────────────────────────────────────────────
      setPhase("upload");
      addLog("— [3/5] Uploading blobs (3 sizes)…");
      const uploads: UpResult[] = [];
      const sizeLabels = Object.values(SIZE_LABELS);
      for (let i = 0; i < 3; i++) {
        const label = sizeLabels[i];
        addLog(`  ↑ ${label}…`);
        const u = await call<UpResult>("/api/benchmark/upload", { sizeIndex: i });
        if (myRun !== runIdRef.current) return;
        uploads.push(u);
        const txInfo = u.txHash ? ` · tx: ${u.txHash.slice(0, 10)}…` : "";
        addLog(`  ✓ ${label}: ${fmtKbs(u.speedKbs)} in ${fmtMs(u.elapsed)}${txInfo}`);
      }

      // ── 4. Downloads ─────────────────────────────────────────────────────
      setPhase("download");
      addLog("— [4/5] Downloading blobs…");
      const downloads: DlResult[] = [];
      for (const up of uploads.filter(u => u.blobName)) {
        const d = await call<DlResult>("/api/benchmark/download", { blobName: up.blobName });
        if (myRun !== runIdRef.current) return;
        downloads.push(d);
        addLog(`  ✓ ${fmtBytes(d.bytes)}: ${fmtKbs(d.speedKbs)} in ${fmtMs(d.elapsed)}`);
      }

      // ── 5. TX time ───────────────────────────────────────────────────────
      setPhase("txtime");
      addLog("— [5/5] Measuring Aptos transaction timing…");
      const tx = await call<TxResult>("/api/benchmark/txtime");
      if (myRun !== runIdRef.current) return;
      addLog(`✓ Submit: ${fmtMs(tx.submitTime)} · Confirm: ${fmtMs(tx.confirmTime)}`);
      if (tx.txHash) addLog(`  tx: ${tx.txHash.slice(0, 10)}…`);

      // ── Score ─────────────────────────────────────────────────────────────
      const avgUp   = uploads.reduce((s, u) => s + u.speedKbs, 0) / uploads.length;
      const avgDown = downloads.length
        ? downloads.reduce((s, d) => s + d.speedKbs, 0) / downloads.length
        : 0;
      const { score, tier } = calcScore({ avgUploadKbs: avgUp, avgDownloadKbs: avgDown, latency, tx });

      const res: BenchResult = {
        latency, uploads, downloads, tx,
        avgUploadKbs:   avgUp,
        avgDownloadKbs: avgDown,
        score, tier,
        runAt: new Date().toLocaleTimeString(),
      };

      setResult(res);
      setPhase("done");
      saveToHistory(res);
      addLog(`— Done · Score: ${score} / 1000 (${tier})`);

    } catch (e: any) {
      if (myRun !== runIdRef.current) return;
      setPhase("error");
      addLog(`✗ ${e.message}`);
    }
  }, [diagnose, runDiagnose, addLog, saveToHistory]);

  const requestFaucet = useCallback(async () => {
    addLog("— Requesting tokens from faucet…");
    try {
      await call("/api/benchmark/faucet", {});
      addLog("✓ Faucet requested — balance updates in ~5s");
      setTimeout(() => { refreshBalance(); runDiagnose(); }, 5000);
    } catch (e: any) {
      addLog(`✗ Faucet error: ${e.message}`);
    }
  }, [refreshBalance, runDiagnose, addLog]);

  const running = !["idle", "done", "error"].includes(phase);

  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      <style>{`
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 var(--net-color, #2563eb)55; }
          70%  { box-shadow: 0 0 0 8px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>

      {/* ── Header ── */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="page-title">Benchmark tool</h1>
          <p className="page-subtitle">
            Measure upload, download, latency &amp; TX speed on <strong>{config.label}</strong>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Tab switcher */}
          <div style={{ display: "flex", background: "#f4f4f4", borderRadius: 10, padding: 3, gap: 2 }}>
            {(["run", "history"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding:    "6px 14px",
                  borderRadius: 8,
                  fontSize:   13,
                  fontWeight: activeTab === tab ? 600 : 400,
                  color:      activeTab === tab ? "#0a0a0a" : "#999",
                  background: activeTab === tab ? "#fff" : "transparent",
                  boxShadow:  activeTab === tab ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                  border:     "none",
                  cursor:     "pointer",
                }}
              >
                {tab === "run" ? "▶ Run" : `📊 History${history.length ? ` (${history.length})` : ""}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pre-flight ── */}
      <DiagnosePanel result={diagnose} loading={diagLoad} onRecheck={runDiagnose} />

      {/* ── Wallet card ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          flexWrap:       "wrap",
          gap:            16,
        }}>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              { label: "APT",       value: balance ? balance.apt.toFixed(4)        : "—", ok: (balance?.apt        ?? 0) >= 0.1    },
              { label: "ShelbyUSD", value: balance ? balance.shelbyusd.toFixed(6)  : "—", ok: (balance?.shelbyusd  ?? 0) >= 0.001  },
              ...(balance?.address
                ? [{ label: "Wallet", value: `${balance.address.slice(0, 10)}…${balance.address.slice(-6)}`, ok: true }]
                : []),
            ].map(({ label, value, ok }) => (
              <div key={label}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 600, color: ok ? "var(--gray-900)" : "#dc2626" }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={requestFaucet} disabled={running} className="btn btn-secondary">
              ↯ Request faucet
            </button>
            <a
              href="https://docs.shelby.xyz/sdks/typescript/fund-your-account"
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ background: "white" }}
            >
              Docs ↗
            </a>
          </div>
        </div>
      </div>

      {activeTab === "run" && (
        <>
          {/* ── Run button + progress ── */}
          <div className="card" style={{ marginBottom: 20, padding: "20px 24px" }}>
            <button
              onClick={run}
              disabled={running}
              className="btn btn-primary"
              style={{
                width:         "100%",
                padding:       "14px 0",
                fontSize:      15,
                marginBottom:  running || phase !== "idle" ? 20 : 0,
                justifyContent: "center",
                borderRadius:  12,
                opacity:       (!diagnose?.ready && !running) ? 0.6 : 1,
              }}
            >
              {running
                ? `Running — ${STEPS.find(s => s.phase === phase)?.label ?? phase}…`
                : !diagnose?.ready
                ? "⚠ Fix issues above first"
                : result
                ? "⟳ Run again"
                : "▶  Start benchmark"}
            </button>

            {(running || phase === "done" || phase === "error") && (
              <ProgressBar phase={phase} running={running} />
            )}
          </div>

          {/* ── Custom upload toggle ── */}
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => setShowCustom(v => !v)}
              className="btn btn-secondary"
              style={{ fontSize: 13 }}
            >
              {showCustom ? "▲ Hide" : "▼ Show"} custom upload
            </button>
            {!showCustom && (
              <span style={{ fontSize: 12, color: "var(--gray-400)" }}>
                Upload your own file (&lt; 3 MB) to test with real data
              </span>
            )}
          </div>

          {showCustom && (
            <CustomUploadCard
              onResult={() => {}}
              running={running}
              network={network}
            />
          )}

          {/* ── Log ── */}
          {log.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <div className="card-title">System log</div>
                <button
                  onClick={() => setLog([])}
                  className="btn btn-secondary"
                  style={{ fontSize: 12 }}
                >
                  Clear
                </button>
              </div>
              <div
                ref={logRef}
                className="bench-log"
                style={{ maxHeight: 260, overflowY: "auto" }}
              >
                {log.map((line, i) => <LogLine key={i} text={line} />)}
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {result && phase === "done" && (
            <>
              {/* Score + summary */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div>
                    <div className="card-title">Benchmark results</div>
                    <div className="card-subtitle">{config.label} · {result.runAt}</div>
                  </div>
                </div>
                <div className="card-body">
                  <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 28 }}>

                    {/* Score ring */}
                    <ScoreRing score={result.score} tier={result.tier} />

                    {/* Speed bars + timing */}
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 14 }}>
                        Performance summary
                      </div>
                      <SpeedBar value={result.avgUploadKbs}   max={2000} label="Avg upload speed"   color="#2563eb" />
                      <SpeedBar value={result.avgDownloadKbs} max={5000} label="Avg download speed" color="#16a34a" />

                      <div style={{ display: "flex", gap: 20, marginTop: 18, flexWrap: "wrap" }}>
                        {[
                          { label: "Avg latency",   value: fmtMs(result.latency.avg)      },
                          { label: "TX submit",     value: fmtMs(result.tx.submitTime)    },
                          { label: "TX confirm",    value: fmtMs(result.tx.confirmTime)   },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <div style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                              {label}
                            </div>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600, color: "var(--gray-800)" }}>
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* TX link for txtime */}
                      {result.tx.txHash && (
                        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Timing TX
                          </span>
                          <TxHashCell hash={result.tx.txHash} network={network} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Score formula breakdown */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, background: "#f9fafb", border: "1px solid #f0f0f0", marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 10 }}>
                      Score breakdown (v5.2)
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                      {[
                        { label: "Upload (40%)",   value: Math.min(400, result.avgUploadKbs   * 1.0),   max: 400, color: "#2563eb" },
                        { label: "Download (25%)", value: Math.min(250, result.avgDownloadKbs * 0.05), max: 250, color: "#16a34a" },
                        { label: "Latency (20%)",  value: Math.round(200 * Math.max(0, 1 - result.latency.avg    / 5000)), max: 200, color: "#9333ea" },
                        { label: "TX time (15%)",  value: Math.round(150 * Math.max(0, 1 - result.tx.confirmTime / 8000)), max: 150, color: "#f59e0b" },
                      ].map(({ label, value, max, color }) => (
                        <div key={label} style={{ flex: 1, minWidth: 110 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11 }}>
                            <span style={{ color: "var(--gray-500)" }}>{label}</span>
                            <span style={{ fontFamily: "var(--font-mono)", color, fontWeight: 600 }}>{Math.round(value)}/{max}</span>
                          </div>
                          <div style={{ height: 4, background: "#f0f0f0", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(value / max) * 100}%`, background: color, borderRadius: 2, transition: "width 1s" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Upload detail table */}
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 10 }}>
                    Upload details
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>Size</th>
                          <th>Speed</th>
                          <th>Time</th>
                          <th>Blob name</th>
                          <th>Tx hash</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.uploads.map((u, i) => (
                          <tr key={i}>
                            <td><span className="mono">{SIZE_LABELS[u.bytes] ?? fmtBytes(u.bytes)}</span></td>
                            <td><span className="mono" style={{ color: "#2563eb", fontWeight: 600 }}>{fmtKbs(u.speedKbs)}</span></td>
                            <td><span className="mono" style={{ color: "var(--gray-500)" }}>{fmtMs(u.elapsed)}</span></td>
                            <td>
                              <span className="mono" style={{ fontSize: 11, color: "var(--gray-400)" }} title={u.blobName}>
                                {u.blobName ? `${u.blobName.slice(0, 24)}…` : "—"}
                              </span>
                            </td>
                            <td><TxHashCell hash={u.txHash} network={network} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Download detail table */}
                  {result.downloads.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginTop: 20, marginBottom: 10 }}>
                        Download details
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="data-table" style={{ width: "100%" }}>
                          <thead>
                            <tr><th>#</th><th>Size</th><th>Speed</th><th>Time</th></tr>
                          </thead>
                          <tbody>
                            {result.downloads.map((d, i) => (
                              <tr key={i}>
                                <td><span className="mono" style={{ color: "var(--gray-400)" }}>{i + 1}</span></td>
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
            </>
          )}
        </>
      )}

      {/* ── History tab ── */}
      {activeTab === "history" && (
        <>
          {history.length === 0 ? (
            <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 15, color: "var(--gray-400)" }}>No runs yet — switch to Run tab and start a benchmark</div>
            </div>
          ) : (
            <>
              <HistoryTable history={history} />
              <button
                onClick={() => {
                  setHistory([]);
                  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
                }}
                className="btn btn-secondary"
                style={{ fontSize: 13, color: "#dc2626", borderColor: "#fecaca" }}
              >
                🗑 Clear history
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}