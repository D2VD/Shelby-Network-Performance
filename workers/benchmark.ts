/**
 * workers/benchmark.ts — Shelby Benchmark Worker v1.0
 *
 * Tại sao cần Worker riêng thay vì Next.js API routes?
 * ─────────────────────────────────────────────────────
 * Upload lên Shelby gồm 2 bước bắt buộc:
 *   1. registerBlob() → ký transaction Aptos, submit on-chain
 *   2. putBlob()      → upload bytes qua RPC (dùng multipart)
 *
 * Bước 1 cần @shelby-protocol/sdk + clay-codes WASM.
 * WASM không chạy trên CF Pages edge runtime.
 * → Benchmark Worker chạy với nodejs_compat = có đủ env để dùng SDK.
 *
 * CF Pages benchmark routes → proxy sang Worker này.
 *
 * Endpoints:
 *   POST /upload    body: { sizeIndex: 0|1|2 }
 *   POST /download  body: { blobName: string }
 *   GET  /latency
 *   GET  /txtime
 *   GET  /balance
 *   GET  /diagnose
 *
 * Env vars (set trong wrangler.benchmark.toml secrets):
 *   SHELBY_PRIVATE_KEY     — ed25519-priv-0x...
 *   SHELBY_WALLET_ADDRESS  — 0x...
 *   SHELBY_API_KEY         — aptoslabs_*** (từ geomi.dev)
 *   SHELBY_KV_MAINNET      — KV namespace binding (cho bench results)
 */

import {
  ShelbyNodeClient,
  ClayErasureCodingProvider,
  generateCommitments,
} from "@shelby-protocol/sdk/node";
import {
  Account,
  Ed25519PrivateKey,
  Network,
  Aptos,
  AptosConfig,
  Ed25519Account,
} from "@aptos-labs/ts-sdk";

interface Env {
  SHELBY_PRIVATE_KEY:    string;
  SHELBY_WALLET_ADDRESS: string;
  SHELBY_API_KEY?:       string;
  SHELBY_KV_MAINNET:     KVNamespace;
}

const SHELBY_RPC  = "https://api.shelbynet.shelby.xyz/shelby";
const SHELBY_NODE = "https://api.shelbynet.shelby.xyz/v1";
const SHELBYUSD_META = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";

const TEST_SIZES = [1_024, 10_240, 102_400]; // 1KB, 10KB, 100KB

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Singletons (lazy init per isolate) ───────────────────────────────────────
let _client:   ShelbyNodeClient | null = null;
let _account:  Ed25519Account | null   = null;
let _provider: ClayErasureCodingProvider | null = null;

function getAccount(env: Env): Ed25519Account {
  if (_account) return _account;
  const hex = env.SHELBY_PRIVATE_KEY.replace(/^ed25519-priv-/, "");
  _account = new Ed25519Account({ privateKey: new Ed25519PrivateKey(hex) });
  return _account;
}

function getClient(env: Env): ShelbyNodeClient {
  if (_client) return _client;
  _client = new ShelbyNodeClient({
    network: (Network as any).SHELBYNET ?? ("shelbynet" as any),
    ...(env.SHELBY_API_KEY ? { apiKey: env.SHELBY_API_KEY } : {}),
  });
  return _client;
}

async function getProvider(): Promise<ClayErasureCodingProvider> {
  if (_provider) return _provider;
  _provider = await ClayErasureCodingProvider.create();
  return _provider;
}

function nb(v: any, fb = 0): number { const x = Number(v ?? fb); return isNaN(x) ? fb : x; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function generatePayload(bytes: number): Uint8Array {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

function uniqueBlobName(bytes: number): string {
  const ts  = Date.now();
  const rnd = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `bench/${bytes}/${ts}-${rnd}`;
}

async function getBalance(env: Env): Promise<{ apt: number; shelbyusd: number; ready: boolean; address: string }> {
  const address = env.SHELBY_WALLET_ADDRESS;
  let apt = 0, shelbyusd = 0;

  await Promise.allSettled([
    fetch(`${SHELBY_NODE}/view`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ function: "0x1::coin::balance", type_arguments: ["0x1::aptos_coin::AptosCoin"], arguments: [address] }),
      signal:  AbortSignal.timeout(6_000),
    }).then(async r => { if (r.ok) { const d = await r.json(); apt = nb(Array.isArray(d) ? d[0] : d) / 1e8; } }),

    fetch(`${SHELBY_NODE}/view`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ function: "0x1::primary_fungible_store::balance", type_arguments: ["0x1::fungible_asset::Metadata"], arguments: [address, SHELBYUSD_META] }),
      signal:  AbortSignal.timeout(6_000),
    }).then(async r => { if (r.ok) { const d = await r.json(); shelbyusd = nb(Array.isArray(d) ? d[0] : d) / 1e8; } }),
  ]);

  return { address, apt, shelbyusd, ready: apt >= 0.1 && shelbyusd >= 0.001 };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleBalance(env: Env): Promise<Response> {
  try {
    const bal = await getBalance(env);
    return Response.json(bal, { headers: CORS });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

async function handleLatency(): Promise<Response> {
  const rounds = 5;
  const times: number[] = [];

  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${SHELBY_NODE}/`, { signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      return Response.json({ error: "Cannot reach Shelbynet node" }, { status: 503, headers: CORS });
    }
    times.push(performance.now() - t0);
    if (i < rounds - 1) await new Promise(r => setTimeout(r, 150));
  }

  times.sort((a, b) => a - b);
  const trimmed = times.slice(1, 4);
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;

  return Response.json({
    avg,
    min:     trimmed[0],
    max:     trimmed[trimmed.length - 1],
    samples: times,
  }, { headers: CORS });
}

/**
 * Upload với đúng 2 bước theo docs:
 * 1. generateCommitments(WASM) → merkle root
 * 2. registerBlob on-chain (Aptos tx)
 * 3. putBlob qua RPC (multipart)
 */
async function handleUpload(req: Request, env: Env): Promise<Response> {
  const { sizeIndex = 0 } = await req.json().catch(() => ({}));
  const bytes    = TEST_SIZES[sizeIndex] ?? TEST_SIZES[0];
  const payload  = generatePayload(bytes);
  const blobName = uniqueBlobName(bytes);
  const address  = env.SHELBY_WALLET_ADDRESS;

  const t0      = performance.now();
  const account = getAccount(env);
  const client  = getClient(env);

  try {
    // ── Bước 1: Generate commitments (WASM) ───────────────────────────────
    const provider       = await getProvider();
    const blobData       = Buffer.from(payload);
    const blobCommitments = await generateCommitments(provider, blobData);

    // ── Bước 2: Register blob on-chain ────────────────────────────────────
    const expirationMicros = (Date.now() + 7 * 24 * 3600 * 1000) * 1000; // 7 ngày
    const { transaction: pending } = await client.coordination.registerBlob({
      account,
      blobName,
      blobMerkleRoot: blobCommitments.blob_merkle_root,
      size:           blobData.length,
      expirationMicros,
    });

    // Đợi tx confirm
    const aptos = new Aptos(new AptosConfig({
      network: (Network as any).SHELBYNET ?? ("shelbynet" as any),
    }));
    const committedTx = await aptos.waitForTransaction({ transactionHash: pending.hash });
    const txHash = pending.hash;

    // ── Bước 3: Upload bytes qua RPC ──────────────────────────────────────
    await client.rpc.putBlob({
      account:  account.accountAddress,
      blobName,
      blobData,
    });

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    return Response.json({
      bytes, elapsed, speedKbs, blobName,
      txHash,
      status: "uploaded",
      blobSize: bytes,
    }, { headers: CORS });

  } catch (e: any) {
    const elapsed = performance.now() - t0;
    // Phân loại lỗi để frontend hiển thị hint
    const msg = e.message ?? String(e);
    const code = msg.includes("INSUFFICIENT") || msg.includes("balance") ? "INSUFFICIENT_BALANCE"
               : msg.includes("rate") || msg.includes("429")             ? "RATE_LIMITED"
               : msg.includes("WASM") || msg.includes("wasm")            ? "WASM_ERROR"
               : "UPLOAD_FAILED";

    return Response.json({
      error: msg.slice(0, 300),
      code,
      elapsed,
      hint: code === "RATE_LIMITED"
        ? "Set SHELBY_API_KEY from geomi.dev in Worker env vars"
        : code === "INSUFFICIENT_BALANCE"
        ? "Fund wallet via faucet.shelbynet.shelby.xyz"
        : undefined,
    }, { status: 500, headers: CORS });
  }
}

async function handleDownload(req: Request, env: Env): Promise<Response> {
  const { blobName } = await req.json().catch(() => ({}));
  if (!blobName) return Response.json({ error: "blobName required" }, { status: 400, headers: CORS });

  const address = env.SHELBY_WALLET_ADDRESS;
  const t0      = performance.now();

  try {
    const client = getClient(env);
    const blob   = await client.rpc.getBlob({
      account:  address,
      blobName,
    });

    // Consume stream để đo tốc độ
    const reader = blob.readable.getReader();
    let   totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value?.length ?? 0;
    }

    const elapsed  = performance.now() - t0;
    const bytes    = totalBytes || blob.contentLength || 0;
    const speedKbs = bytes > 0 ? (bytes / 1024) / (elapsed / 1000) : 0;

    return Response.json({ bytes, elapsed, speedKbs, blobName }, { headers: CORS });
  } catch (e: any) {
    return Response.json({ error: e.message?.slice(0, 200) ?? "Download failed" }, { status: 500, headers: CORS });
  }
}

async function handleTxTime(env: Env): Promise<Response> {
  const address  = env.SHELBY_WALLET_ADDRESS;
  const account  = getAccount(env);
  const client   = getClient(env);
  const provider = await getProvider();

  const blobName = `bench/tx/${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
  const blobData = Buffer.from(new Uint8Array(512).fill(42));

  const t0 = performance.now();

  try {
    // 1. Commitments
    const blobCommitments = await generateCommitments(provider, blobData);

    // 2. Register on-chain
    const expirationMicros = (Date.now() + 3600_000) * 1000;
    const { transaction: pending } = await client.coordination.registerBlob({
      account,
      blobName,
      blobMerkleRoot: blobCommitments.blob_merkle_root,
      size:           blobData.length,
      expirationMicros,
    });
    const submitTime = performance.now() - t0;
    const txHash     = pending.hash;

    // 3. Wait for confirmation
    const aptos = new Aptos(new AptosConfig({
      network: (Network as any).SHELBYNET ?? ("shelbynet" as any),
    }));
    await aptos.waitForTransaction({ transactionHash: txHash });
    const confirmTime = performance.now() - t0;

    return Response.json({ submitTime, confirmTime, txHash }, { headers: CORS });
  } catch (e: any) {
    return Response.json({ error: e.message?.slice(0, 200) }, { status: 500, headers: CORS });
  }
}

async function handleDiagnose(env: Env): Promise<Response> {
  const address = env.SHELBY_WALLET_ADDRESS;
  const apiKey  = env.SHELBY_API_KEY;
  type CheckStatus = "pass" | "fail" | "warn" | "skip";
  interface Check { name: string; status: CheckStatus; value?: string; hint?: string }
  const checks: Check[] = [];
  let   ready = true;

  // Env vars
  if (!address) {
    checks.push({ name: "Wallet address", status: "fail", hint: "Set SHELBY_WALLET_ADDRESS in Worker env vars" });
    ready = false;
  } else {
    checks.push({ name: "Wallet address", status: "pass", value: `${address.slice(0, 10)}…${address.slice(-6)}` });
  }
  checks.push({
    name:   "API key (Geomi)",
    status: apiKey ? "pass" : "warn",
    value:  apiKey ? `${apiKey.slice(0, 12)}…` : "Not set",
    hint:   apiKey ? undefined : "Anonymous rate limit very low. Get free API key at geomi.dev",
  });

  if (!address) {
    return Response.json({ ready: false, checks, summary: "Fix SHELBY_WALLET_ADDRESS first" }, { headers: CORS });
  }

  // Private key (kiểm tra format)
  try {
    getAccount(env);
    checks.push({ name: "Private key", status: "pass", value: "Valid Ed25519" });
  } catch (e: any) {
    checks.push({ name: "Private key", status: "fail", hint: e.message });
    ready = false;
  }

  // Node ping
  const t0 = performance.now();
  let nodeOk = false;
  try {
    const r = await fetch(`${SHELBY_NODE}/`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const d: any = await r.json();
      nodeOk = true;
      checks.push({ name: "Shelbynet node", status: "pass", value: `${Math.round(performance.now() - t0)}ms · block #${nb(d.block_height).toLocaleString()}` });
    } else {
      checks.push({ name: "Shelbynet node", status: "fail", value: `HTTP ${r.status}` });
      ready = false;
    }
  } catch (e: any) {
    checks.push({ name: "Shelbynet node", status: "fail", value: e.message, hint: "Network unreachable" });
    ready = false;
  }

  // Balance
  const bal = await getBalance(env);
  checks.push({
    name:   "APT balance",
    status: bal.apt >= 0.1 ? "pass" : bal.apt > 0 ? "warn" : "fail",
    value:  `${bal.apt.toFixed(4)} APT`,
    hint:   bal.apt >= 0.1 ? undefined : "Cần ≥0.1 APT. Faucet: faucet.shelbynet.shelby.xyz",
  });
  checks.push({
    name:   "ShelbyUSD balance",
    status: bal.shelbyusd >= 0.001 ? "pass" : bal.shelbyusd > 0 ? "warn" : "fail",
    value:  `${bal.shelbyusd.toFixed(6)} ShelbyUSD`,
    hint:   bal.shelbyusd >= 0.001 ? undefined : "Cần ShelbyUSD để upload. Faucet tại docs.shelby.xyz",
  });
  if (!bal.ready) ready = false;

  // WASM load test
  try {
    await getProvider();
    checks.push({ name: "Clay WASM (erasure coding)", status: "pass", value: "Loaded" });
  } catch (e: any) {
    checks.push({ name: "Clay WASM (erasure coding)", status: "fail", hint: e.message });
    ready = false;
  }

  const failCount = checks.filter(c => c.status === "fail").length;
  return Response.json({
    ready,
    passCount:  checks.filter(c => c.status === "pass").length,
    failCount,
    warnCount:  checks.filter(c => c.status === "warn").length,
    checks,
    summary: ready ? "All checks pass — benchmark ready" : `${failCount} issue(s) to fix`,
    checkedAt: new Date().toISOString(),
  }, { headers: CORS });
}

// ── Bench results (KV) ────────────────────────────────────────────────────────

async function handleResults(req: Request, env: Env): Promise<Response> {
  const url     = new URL(req.url);
  const address = url.searchParams.get("address") ?? env.SHELBY_WALLET_ADDRESS ?? "";
  if (!address) return Response.json({ ok: false, error: "address required" }, { status: 400, headers: CORS });

  const key = `bench:results:${address}`;

  if (req.method === "GET") {
    try {
      const raw     = await env.SHELBY_KV_MAINNET.get(key);
      const results = raw ? JSON.parse(raw) : [];
      return Response.json({ ok: true, address, results, count: results.length }, {
        headers: { ...CORS, "Cache-Control": "no-store" },
      });
    } catch (e: any) {
      return Response.json({ ok: false, error: e.message, results: [] }, { headers: CORS });
    }
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400, headers: CORS }); }

    const entry = {
      ts:             new Date().toISOString(),
      avgUploadKbs:   nb(body.avgUploadKbs),
      avgDownloadKbs: nb(body.avgDownloadKbs),
      latencyAvg:     nb(body.latency?.avg),
      txConfirmMs:    nb(body.tx?.confirmTime),
      score:          nb(body.score),
      uploadSpeeds:   (body.uploads   ?? []).map((u: any) => nb(u.speedKbs)),
      downloadSpeeds: (body.downloads ?? []).map((d: any) => nb(d.speedKbs)),
    };

    try {
      const raw     = await env.SHELBY_KV_MAINNET.get(key);
      const existing = raw ? JSON.parse(raw) : [];
      const updated  = [entry, ...existing].slice(0, 50);
      await env.SHELBY_KV_MAINNET.put(key, JSON.stringify(updated), { expirationTtl: 90 * 24 * 3600 });
      return Response.json({ ok: true, saved: true, total: updated.length }, { headers: CORS });
    } catch (e: any) {
      return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
    }
  }

  return Response.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: CORS });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/health")
      return Response.json({ ok: true, worker: "shelby-benchmark", version: "1.0.0", ts: new Date().toISOString() }, { headers: CORS });

    if (url.pathname === "/diagnose" && request.method === "GET")
      return handleDiagnose(env);

    if (url.pathname === "/balance" && request.method === "GET")
      return handleBalance(env);

    if (url.pathname === "/latency" && request.method === "GET")
      return handleLatency();

    if (url.pathname === "/txtime" && request.method === "GET")
      return handleTxTime(env);

    if (url.pathname === "/upload" && request.method === "POST")
      return handleUpload(request, env);

    if (url.pathname === "/download" && request.method === "POST")
      return handleDownload(request, env);

    if (url.pathname === "/results")
      return handleResults(request, env);

    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: CORS });
  },
};
