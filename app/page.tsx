"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Ed25519PrivateKey, Ed25519Account, Network, Account } from "@aptos-labs/ts-sdk";

// ── Types (Giữ nguyên) ────────────────────────────────────────────────────────
type Phase = "idle" | "latency" | "upload" | "download" | "txtime" | "done" | "error";
interface LatResult  { avg: number; min: number; max: number; samples: number[] }
interface UpResult   { bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null }
interface DlResult   { bytes: number; elapsed: number; speedKbs: number }
interface TxResult   { submitTime: number; confirmTime: number; txHash: string | null }
interface BenchResult { latency: LatResult; uploads: UpResult[]; downloads: DlResult[]; tx: TxResult; avgUploadKbs: number; avgDownloadKbs: number; score: number }

const SIZE_LABELS: Record<number, string> = { 1024: "1 KB", 10240: "10 KB", 102400: "100 KB" };
const fmt    = (k: number) => k >= 1024 ? `${(k / 1024).toFixed(2)} MB/s` : `${k.toFixed(1)} KB/s`;
const fmtMs  = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(2)}s` : `${m.toFixed(0)}ms`;
const pct    = (v: number, max: number) => Math.min(100, (v / max) * 100);
function calcScore(r: { avgUploadKbs: number; avgDownloadKbs: number; latency: LatResult; tx: TxResult }) {
  return Math.round(pct(r.avgUploadKbs, 800) * 0.3 + pct(r.avgDownloadKbs, 1200) * 0.3 + Math.max(0, 100 - r.latency.avg / 4) * 0.25 + Math.max(0, 100 - r.tx.confirmTime / 20) * 0.15);
}

// ── Các hàm UI (LogLine, SpeedBar, ScoreRing - giữ nguyên) ─────────────────────
// ... (Bạn có thể giữ lại các component này từ file cũ) ...

// ── CÁC HÀM LOGIC BENCHMARK MỚI (CHẠY TRÊN TRÌNH DUYỆT) ─────────────────────
function getShelbyClient(): ShelbyClient {
  return new ShelbyClient({ network: "shelbynet" as any });
}

function generatePayload(bytes: number): Uint8Array {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

function uniqueBlobName(bytes: number): string {
  return `bench/${bytes}/${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function BenchmarkPage() {
  const { config, network } = useNetwork();
  const [phase,    setPhase]    = useState<Phase>("idle");
  const [log,      setLog]      = useState<string[]>([]);
  const [result,   setResult]   = useState<BenchResult | null>(null);
  const [privKey,  setPrivKey]  = useState("");
  const [account,  setAccount]  = useState<Ed25519Account | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (t: string) => setLog(p => [...p.slice(-60), t]);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setPrivKey(key);
    try {
      const hex = key.replace(/^ed25519-priv-/, "").replace(/^0x/, "");
      if (hex.length === 64) {
        const pk = new Ed25519PrivateKey(hex);
        const acc = Account.fromPrivateKey({ privateKey: pk });
        setAccount(acc);
        addLog(`✓ Private key loaded for account: ${acc.accountAddress.toString().slice(0, 10)}...`);
      } else {
        setAccount(null);
      }
    } catch { setAccount(null); }
  };

  const run = useCallback(async () => {
    if (!account) {
      addLog("✗ Please enter a valid Shelbynet Ed25519 private key.");
      return;
    }
    const client = getShelbyClient();
    setPhase("latency"); setLog([]); setResult(null);

    try {
      addLog("— [1/4] Measuring blockchain latency…");
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        await fetch("https://api.shelbynet.shelby.xyz/v1/", { signal: AbortSignal.timeout(5_000) });
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const trimmed = times.slice(1, 4);
      const latency: LatResult = {
        avg: trimmed.reduce((a, b) => a + b, 0) / trimmed.length,
        min: trimmed[0], max: trimmed[trimmed.length - 1], samples: times,
      };
      addLog(`✓ Latency avg: ${fmtMs(latency.avg)}`);

      setPhase("upload");
      addLog("— [2/4] Uploading blobs…");
      const uploads: UpResult[] = [];
      for (const bytes of [1024, 10240, 102400]) {
        addLog(`  Uploading ${bytes / 1024} KB...`);
        const t0 = performance.now();
        const res = await client.upload({
          signer: account,
          blobData: generatePayload(bytes),
          blobName: uniqueBlobName(bytes),
          expirationMicros: (Date.now() + 3600 * 1000) * 1000
        });
        const elapsed = performance.now() - t0;
        const upResult: UpResult = { bytes, elapsed, speedKbs: (bytes / 1024) / (elapsed / 1000), blobName: (res as any).blobName, txHash: (res as any).transaction.hash };
        uploads.push(upResult);
        addLog(`  ✓ ${bytes / 1024} KB: ${fmt(upResult.speedKbs)} · ${fmtMs(elapsed)}`);
      }

      setPhase("download");
      addLog("— [3/4] Downloading blobs…");
      const downloads: DlResult[] = [];
      for (const up of uploads) {
        addLog(`  Downloading ${up.bytes / 1024} KB...`);
        const t0 = performance.now();
        const blob = await client.rpc.getBlob({ account: account.accountAddress.toString(), blobName: up.blobName });
        const reader = blob.readable.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
        const elapsed = performance.now() - t0;
        const dlResult: DlResult = { bytes: up.bytes, elapsed, speedKbs: (up.bytes / 1024) / (elapsed / 1000) };
        downloads.push(dlResult);
        addLog(`  ✓ ${up.bytes / 1024} KB: ${fmt(dlResult.speedKbs)}`);
      }

      setPhase("txtime");
      addLog("— [4/4] Transaction timing…");
      const tSubmitStart = performance.now();
      const pendingTx = await client.aptos.transaction.build.simple({ sender: account.accountAddress, data: { function: "0x1::aptos_account::transfer", functionArguments: [account.accountAddress, 0] } });
      const signedTx = await client.aptos.transaction.sign({ signer: account, transaction: pendingTx });
      const submittedTx = await client.aptos.transaction.submit.simple({ transaction: pendingTx, senderAuthenticator: signedTx });
      const submitTime = performance.now() - tSubmitStart;
      const tConfirmStart = performance.now();
      await client.aptos.waitForTransaction({ transactionHash: submittedTx.hash });
      const confirmTime = performance.now() - tConfirmStart;
      const tx: TxResult = { submitTime, confirmTime, txHash: submittedTx.hash };
      addLog(`✓ Submit: ${fmtMs(submitTime)} · Confirm: ${fmtMs(confirmTime)}`);
      
      const avgUp   = uploads.reduce((s, u) => s + u.speedKbs, 0) / uploads.length;
      const avgDown = downloads.reduce((s, d) => s + d.speedKbs, 0) / downloads.length;
      const score   = calcScore({ avgUploadKbs: avgUp, avgDownloadKbs: avgDown, latency, tx });
      const finalResult: BenchResult = { latency, uploads, downloads, tx, avgUploadKbs: avgUp, avgDownloadKbs: avgDown, score };

      setResult(finalResult);
      setPhase("done");
      addLog(`— Done · Score: ${score}/100`);

    } catch (e: any) {
      setPhase("error");
      addLog(`✗ Error: ${e.message}`);
      if (e.stack) addLog(e.stack.slice(0, 400));
    }
  }, [account]);

  const running = !["idle", "done", "error"].includes(phase);
  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Browser Benchmark</h1>
        <p className="page-subtitle">
          Run performance tests for <strong>{config.label}</strong> directly from your browser.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">Setup</div>
          <div className="card-subtitle">Enter your Shelbynet private key to begin.</div>
        </div>
        <div className="card-body">
          <input
            type="password"
            value={privKey}
            onChange={handleKeyChange}
            placeholder="ed25519-priv-0x..."
            style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${account ? "#16a34a" : "var(--gray-300)"}`, fontFamily: "var(--font-mono)" }}
          />
          {account && (
            <div style={{ fontSize: 12, color: "var(--gray-500)", marginTop: 8 }}>
              Wallet: <span className="mono">{account.accountAddress.toString()}</span>
            </div>
          )}
        </div>
      </div>

      <button onClick={run} disabled={running || !account} className="btn btn-primary" style={{ width: "100%", padding: "14px 0", fontSize: 15, justifyContent: "center" }}>
        {running ? `Running — ${phase.toUpperCase()}…` : "▶  Start Benchmark"}
      </button>

      {log.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header"><div className="card-title">System Log</div></div>
          <div ref={logRef} className="bench-log">
            {log.map((line, i) => <div key={i} className="mono text-sm" style={{ color: line.startsWith('✗') ? 'red' : line.startsWith('✓') ? 'green' : 'inherit' }}>{line}</div>)}
          </div>
        </div>
      )}

      {result && (
         <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header"><div className="card-title">Benchmark Results</div></div>
           <div className="card-body">
              {/* Thêm phần hiển thị kết quả chi tiết ở đây nếu bạn muốn */}
              <p>Score: {result.score}</p>
              <p>Avg Upload: {fmt(result.avgUploadKbs)}</p>
              <p>Avg Download: {fmt(result.avgDownloadKbs)}</p>
           </div>
         </div>
      )}
    </div>
  );
}