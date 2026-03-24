/**
 * workers/benchmark.ts — Shelby Benchmark Worker v2.1
 *
 * FIX v2.1:
 * 1. handleUploadManual — sửa request body step1-init:
 *    - Bỏ rawAccount (server không cần), thêm blob_name + part_size + total_size (snake_case)
 *    - part_size = Math.min(payload.length, 5 * 1024 * 1024) — max 5MB/part
 *    - total_size = payload.length
 * 2. handleTxTime — thêm fallback manual flow khi SDK fail "Invalid URL"
 *    (giống handleUpload, dùng handleUploadManual thay vì throw)
 */

import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import {
  Network,
  Ed25519PrivateKey,
  Ed25519Account,
} from "@aptos-labs/ts-sdk";

interface Env {
  SHELBY_PRIVATE_KEY:    string;
  SHELBY_WALLET_ADDRESS: string;
  SHELBY_API_KEY?:       string;
  SHELBY_KV_MAINNET:     KVNamespace;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SHELBY_NODE     = "https://api.shelbynet.shelby.xyz/v1";
const SHELBY_RPC_BASE = "https://api.shelbynet.shelby.xyz/shelby";
const SHELBY_INDEXER  = "https://api.shelbynet.aptoslabs.com/nocode/v1/public/cmforrguw0042s601fn71f9l2/v1/graphql";
const SHELBYUSD_META  = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";
const FAUCET_BASE     = "https://faucet.shelbynet.shelby.xyz";
const TEST_SIZES      = [1_024, 10_240, 102_400];

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Singletons ────────────────────────────────────────────────────────────────
let _client:  ShelbyNodeClient | null = null;
let _account: Ed25519Account   | null = null;

function getAccount(env: Env): Ed25519Account {
  if (_account) return _account;
  const hex = env.SHELBY_PRIVATE_KEY.replace(/^ed25519-priv-/, "");
  _account = new Ed25519Account({ privateKey: new Ed25519PrivateKey(hex) });
  return _account;
}

function getClient(env: Env): ShelbyNodeClient {
  if (_client) return _client;
  _client = new ShelbyNodeClient({
    network: Network.SHELBYNET,
    rpc: {
      baseUrl: SHELBY_RPC_BASE,
      ...(env.SHELBY_API_KEY ? { apiKey: env.SHELBY_API_KEY } : {}),
    },
    indexer: {
      baseUrl: SHELBY_INDEXER,
    },
    aptos: {
      network:  Network.SHELBYNET,
      fullnode: SHELBY_NODE,
    } as any,
    ...(env.SHELBY_API_KEY ? { apiKey: env.SHELBY_API_KEY } : {}),
  });
  return _client;
}

function nb(v: any, fb = 0): number {
  const x = Number(v ?? fb);
  return isNaN(x) ? fb : x;
}

function generatePayload(bytes: number): Buffer {
  const buf = Buffer.allocUnsafe(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

function uniqueBlobName(bytes: number): string {
  return `bench/${bytes}/${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
}

async function getBalance(env: Env): Promise<{ apt: number; shelbyusd: number; ready: boolean; address: string }> {
  const address = env.SHELBY_WALLET_ADDRESS;
  let apt = 0, shelbyusd = 0;
  await Promise.allSettled([
    fetch(`${SHELBY_NODE}/view`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ function: "0x1::coin::balance", type_arguments: ["0x1::aptos_coin::AptosCoin"], arguments: [address] }),
      signal: AbortSignal.timeout(6_000),
    }).then(async r => {
      if (r.ok) { const d = await r.json() as any; apt = nb(Array.isArray(d) ? d[0] : d) / 1e8; }
    }),
    fetch(`${SHELBY_NODE}/view`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ function: "0x1::primary_fungible_store::balance", type_arguments: ["0x1::fungible_asset::Metadata"], arguments: [address, SHELBYUSD_META] }),
      signal: AbortSignal.timeout(6_000),
    }).then(async r => {
      if (r.ok) { const d = await r.json() as any; shelbyusd = nb(Array.isArray(d) ? d[0] : d) / 1e8; }
    }),
  ]);
  return { address, apt, shelbyusd, ready: apt >= 0.1 && shelbyusd >= 0.001 };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleBalance(env: Env): Promise<Response> {
  try {
    return Response.json(await getBalance(env), { headers: CORS });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500, headers: CORS });
  }
}

async function handleLatency(): Promise<Response> {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${SHELBY_NODE}/`, { signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      return Response.json({ error: "Cannot reach Shelbynet node" }, { status: 503, headers: CORS });
    }
    times.push(performance.now() - t0);
    if (i < 4) await new Promise(r => setTimeout(r, 150));
  }
  times.sort((a, b) => a - b);
  const trimmed = times.slice(1, 4);
  return Response.json({
    avg: trimmed.reduce((a, b) => a + b, 0) / trimmed.length,
    min: trimmed[0], max: trimmed[trimmed.length - 1], samples: times,
  }, { headers: CORS });
}

async function handleDebug(env: Env): Promise<Response> {
  try {
    const client = getClient(env);
    return Response.json({
      ok: true,
      rpcBaseUrl:    (client.rpc as any)?.baseUrl ?? "unknown",
      clientBaseUrl: (client as any)?.baseUrl ?? "unknown",
      network:       (client.config as any)?.network ?? "unknown",
      aptosFullnode: (client.aptos as any)?.config?.fullnode ?? "unknown",
      configRpc:     (client.config as any)?.rpc ?? null,
      configIndexer: (client.config as any)?.indexer ?? null,
      shelbyRpcBase: SHELBY_RPC_BASE,
    }, { headers: CORS });
  } catch (e: any) {
    return Response.json({
      ok: false,
      error:  e.message,
      stack:  e.stack?.slice(0, 500),
    }, { status: 500, headers: CORS });
  }
}

async function handleUpload(req: Request, env: Env): Promise<Response> {
  const body     = await req.json().catch(() => ({})) as any;
  const bytes    = TEST_SIZES[body.sizeIndex ?? 0] ?? TEST_SIZES[0];
  const payload  = generatePayload(bytes);
  const blobName = uniqueBlobName(bytes);
  const t0       = performance.now();

  // Strategy 1: SDK client.upload()
  try {
    const result = await (getClient(env).upload({
      signer:           getAccount(env),
      blobData:         payload,
      blobName,
      expirationMicros: (Date.now() + 7 * 24 * 3600 * 1000) * 1000,
    }) as any);

    const elapsed = performance.now() - t0;
    return Response.json({
      bytes, elapsed,
      speedKbs: (bytes / 1024) / (elapsed / 1000),
      blobName, txHash: result?.transaction?.hash ?? null, status: "uploaded",
      strategy: "sdk",
    }, { headers: CORS });

  } catch (e: any) {
    const msg   = e.message ?? String(e);
    const stack = e.stack ?? "";
    const isUrl = msg.includes("Invalid URL") || msg.includes("Failed to parse URL");

    // Strategy 2: fallback manual multipart
    if (isUrl) {
      try {
        return await handleUploadManual(env, payload, blobName, bytes, t0);
      } catch (e2: any) {
        return Response.json({
          error:    e2.message?.slice(0, 300),
          sdkError: msg.slice(0, 300),
          sdkStack: stack.slice(0, 800),
          code:     "MANUAL_UPLOAD_FAILED",
          elapsed:  performance.now() - t0,
          rpcBase:  SHELBY_RPC_BASE,
          strategy: "manual-failed",
        }, { status: 500, headers: CORS });
      }
    }

    const code = msg.includes("INSUFFICIENT") || msg.includes("balance") ? "INSUFFICIENT_BALANCE"
               : msg.includes("rate") || msg.includes("429")              ? "RATE_LIMITED"
               : msg.includes("erasure") || msg.includes("WASM")          ? "WASM_ERROR"
               : "UPLOAD_FAILED";

    return Response.json({
      error: msg.slice(0, 300), code,
      stack: stack.slice(0, 800),
      elapsed: performance.now() - t0,
      rpcBase:  SHELBY_RPC_BASE,
      clientBaseUrl: (getClient(env) as any)?.baseUrl,
      hint: code === "RATE_LIMITED"         ? "Set SHELBY_API_KEY from geomi.dev in Worker secrets"
          : code === "INSUFFICIENT_BALANCE" ? "Fund wallet via faucet.shelbynet.shelby.xyz"
          : code === "WASM_ERROR"           ? "SDK WASM error — redeploy worker với nodejs_compat flag"
          : undefined,
    }, { status: 500, headers: CORS });
  }
}

/**
 * Manual multipart upload — bypass SDK URL resolution.
 *
 * FIX v2.1: Đúng request body cho step1-init:
 *   - blob_name   (string) — tên blob, snake_case
 *   - part_size   (number) — size của từng part, tối đa 5MB
 *   - total_size  (number) — tổng size của file
 *
 * Lỗi cũ (v2.0):
 *   { rawAccount, blobName, totalBytes }
 *   → server báo "blobName: Required, partSize: Expected number received nan"
 *   Nguyên nhân: server dùng snake_case + tên fields khác
 */
async function handleUploadManual(
  env: Env,
  payload: Buffer,
  blobName: string,
  bytes: number,
  t0: number
): Promise<Response> {
  const address = env.SHELBY_WALLET_ADDRESS;

  function makeHeaders(contentType: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": contentType };
    if (env.SHELBY_API_KEY) h["Authorization"] = `Bearer ${env.SHELBY_API_KEY}`;
    return h;
  }

  const steps: string[] = [];

  // part_size: chunk size cho mỗi part — dùng toàn bộ payload vì < 5MB
  // API expect: blob_name, part_size, total_size (snake_case)
  const partSize  = Math.min(payload.length, 5 * 1024 * 1024); // tối đa 5MB/part
  const totalSize = payload.length;

  // Step 1: Initiate multipart upload
  const startUrl = `${SHELBY_RPC_BASE}/v1/multipart-uploads`;
  steps.push(`POST ${startUrl}`);
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: makeHeaders("application/json"),
    body: JSON.stringify({
      blob_name:  blobName,   // FIX: snake_case, không phải blobName
      part_size:  partSize,   // FIX: thêm field này, không phải nan
      total_size: totalSize,  // FIX: snake_case, không phải totalBytes
      // rawAccount đã bỏ — server không cần, address trong URL/auth
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!startRes.ok) {
    const errText = await startRes.text().catch(() => "");
    throw new Error(`[step1-init] HTTP ${startRes.status}: ${errText.slice(0, 200)}`);
  }

  const startBody = await startRes.json() as any;
  const uploadId  = startBody?.uploadId ?? startBody?.upload_id;
  steps.push(`uploadId=${uploadId}`);
  if (!uploadId) throw new Error(`[step1-init] No uploadId in response: ${JSON.stringify(startBody).slice(0, 100)}`);

  // Step 2: Upload single part (index 0)
  const partUrl = `${SHELBY_RPC_BASE}/v1/multipart-uploads/${uploadId}/parts/0`;
  steps.push(`PUT ${partUrl}`);
  const partRes = await fetch(partUrl, {
    method: "PUT",
    headers: makeHeaders("application/octet-stream"),
    body: payload,
    signal: AbortSignal.timeout(30_000),
  });

  if (!partRes.ok) {
    const errText = await partRes.text().catch(() => "");
    throw new Error(`[step2-part] HTTP ${partRes.status}: ${errText.slice(0, 200)}`);
  }

  // Step 3: Complete upload
  const completeUrl = `${SHELBY_RPC_BASE}/v1/multipart-uploads/${uploadId}/complete`;
  steps.push(`POST ${completeUrl}`);
  const completeRes = await fetch(completeUrl, {
    method: "POST",
    headers: makeHeaders("application/json"),
    body: JSON.stringify({ parts: [{ partIdx: 0 }] }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!completeRes.ok) {
    const errText = await completeRes.text().catch(() => "");
    throw new Error(`[step3-complete] HTTP ${completeRes.status}: ${errText.slice(0, 200)}`);
  }

  const elapsed = performance.now() - t0;
  return Response.json({
    bytes, elapsed,
    speedKbs: (bytes / 1024) / (elapsed / 1000),
    blobName, txHash: null, status: "uploaded",
    strategy: "manual-rpc",
    steps,
    note: "SDK URL resolution bypassed — used direct RPC HTTP",
  }, { headers: CORS });
}

async function handleDownload(req: Request, env: Env): Promise<Response> {
  const { blobName } = await req.json().catch(() => ({})) as any;
  if (!blobName) return Response.json({ error: "blobName required" }, { status: 400, headers: CORS });

  const t0 = performance.now();
  try {
    const blob   = await getClient(env).rpc.getBlob({ account: env.SHELBY_WALLET_ADDRESS, blobName });
    const reader = blob.readable.getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value?.length ?? 0;
    }
    const elapsed = performance.now() - t0;
    const bytes   = totalBytes || blob.contentLength || 0;
    return Response.json({
      bytes, elapsed,
      speedKbs: bytes > 0 ? (bytes / 1024) / (elapsed / 1000) : 0,
      blobName,
    }, { headers: CORS });
  } catch (e: any) {
    return Response.json({ error: e.message?.slice(0, 200) ?? "Download failed" }, { status: 500, headers: CORS });
  }
}

/**
 * handleTxTime — FIX v2.1:
 * Thêm fallback sang manual upload khi SDK throw "Invalid URL".
 * txtime chỉ cần đo latency upload nhỏ (512B) → dùng manual-rpc là đủ.
 */
async function handleTxTime(env: Env): Promise<Response> {
  const blobName = `bench/tx/${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
  const payload  = Buffer.alloc(512, 42);
  const t0       = performance.now();

  // Strategy 1: SDK upload (full on-chain tx)
  try {
    const txResult = await (getClient(env).upload({
      signer:           getAccount(env),
      blobData:         payload,
      blobName,
      expirationMicros: (Date.now() + 3_600_000) * 1000,
    }) as any);
    const elapsed = performance.now() - t0;
    return Response.json({
      submitTime:  elapsed,
      confirmTime: elapsed,
      txHash: txResult?.transaction?.hash ?? null,
      strategy: "sdk",
    }, { headers: CORS });
  } catch (e: any) {
    const msg  = e.message ?? String(e);
    const isUrl = msg.includes("Invalid URL") || msg.includes("Failed to parse URL");

    // Strategy 2: fallback manual (đo thời gian RPC upload thuần, không có tx)
    // txHash = null nhưng vẫn cho số latency hữu ích
    if (isUrl) {
      try {
        const r = await handleUploadManual(env, payload, blobName, 512, t0);
        const data = await r.json() as any;
        const elapsed = performance.now() - t0;
        return Response.json({
          submitTime:  data.elapsed ?? elapsed,
          confirmTime: data.elapsed ?? elapsed,
          txHash: null,
          strategy: "manual-rpc",
          note: "SDK URL error — measured RPC upload time only (no on-chain tx)",
        }, { headers: CORS });
      } catch (e2: any) {
        return Response.json({
          error:   e2.message?.slice(0, 200),
          sdkError: msg.slice(0, 200),
          stack:   e.stack?.slice(0, 500),
          rpcBase: SHELBY_RPC_BASE,
        }, { status: 500, headers: CORS });
      }
    }

    // Lỗi khác (balance, rate limit, ...)
    return Response.json({
      error:   msg.slice(0, 200),
      stack:   e.stack?.slice(0, 500),
      rpcBase: SHELBY_RPC_BASE,
    }, { status: 500, headers: CORS });
  }
}

async function handleFaucet(env: Env): Promise<Response> {
  const address = env.SHELBY_WALLET_ADDRESS;
  if (!address) return Response.json({ error: "SHELBY_WALLET_ADDRESS not configured in Worker secrets" }, { status: 500, headers: CORS });

  const before = await getBalance(env);

  async function tryMint(token: "apt" | "shelbyusd"): Promise<boolean> {
    const amount = token === "apt" ? 100_000_000 : 10_000_000;
    const formats = [
      { url: `${FAUCET_BASE}/mint`,                                                                                              body: JSON.stringify({ address, amount, ...(token === "shelbyusd" ? { token } : {}) }) },
      { url: `${FAUCET_BASE}/mint?address=${address}&amount=${amount}${token === "shelbyusd" ? "&token=shelbyusd" : ""}`,       body: "{}" },
      { url: `${FAUCET_BASE}/fund`,                                                                                              body: JSON.stringify({ address, amount }) },
    ];
    for (const f of formats) {
      try {
        const r = await fetch(f.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: f.body, signal: AbortSignal.timeout(12_000) });
        if (r.ok) return true;
      } catch {}
    }
    return false;
  }

  const [aptOk, usdOk] = await Promise.all([tryMint("apt"), tryMint("shelbyusd")]);
  await new Promise(r => setTimeout(r, 3_000));
  const after = await getBalance(env);

  return Response.json({
    address,
    aptFauceted:       aptOk || after.apt      > before.apt      + 0.01,
    shelbyusdFauceted: usdOk || after.shelbyusd > before.shelbyusd + 0.001,
    newApt:            after.apt,
    newShelbyUSD:      after.shelbyusd,
    delta:             { apt: +(after.apt - before.apt).toFixed(6), usd: +(after.shelbyusd - before.shelbyusd).toFixed(6) },
    message:           (aptOk || usdOk) ? "Faucet OK" : "Faucet server không phản hồi — mint thủ công tại docs.shelby.xyz",
    fallbackUrl:       "https://docs.shelby.xyz/apis/faucet/shelbyusd",
  }, { headers: CORS });
}

async function handleDiagnose(env: Env): Promise<Response> {
  type S = "pass" | "fail" | "warn";
  interface C { name: string; status: S; value?: string; hint?: string }
  const checks: C[] = [];
  let ready = true;

  const address = env.SHELBY_WALLET_ADDRESS;
  const apiKey  = env.SHELBY_API_KEY;

  checks.push(!address
    ? { name: "Wallet address", status: "fail", hint: "Set SHELBY_WALLET_ADDRESS in Worker secrets" }
    : { name: "Wallet address", status: "pass", value: `${address.slice(0, 10)}…${address.slice(-6)}` }
  );
  if (!address) ready = false;

  checks.push({ name: "API key (Geomi)", status: apiKey ? "pass" : "warn", value: apiKey ? `${apiKey.slice(0, 12)}…` : "Not set", hint: apiKey ? undefined : "Get free API key at geomi.dev" });

  try { getAccount(env); checks.push({ name: "Private key", status: "pass", value: "Valid Ed25519" }); }
  catch (e: any) { checks.push({ name: "Private key", status: "fail", hint: e.message }); ready = false; }

  const t0 = performance.now();
  try {
    const r = await fetch(`${SHELBY_NODE}/`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) { const d = await r.json() as any; checks.push({ name: "Shelbynet node", status: "pass", value: `${Math.round(performance.now() - t0)}ms · block #${nb(d.block_height).toLocaleString()}` }); }
    else { checks.push({ name: "Shelbynet node", status: "fail", value: `HTTP ${r.status}` }); ready = false; }
  } catch (e: any) { checks.push({ name: "Shelbynet node", status: "fail", value: e.message }); ready = false; }

  if (address) {
    const bal = await getBalance(env);
    checks.push({ name: "APT balance",  status: bal.apt >= 0.1 ? "pass" : "fail",         value: `${bal.apt.toFixed(4)} APT`,            hint: bal.apt >= 0.1 ? undefined : "Cần ≥0.1 APT" });
    checks.push({ name: "ShelbyUSD",    status: bal.shelbyusd >= 0.001 ? "pass" : "fail", value: `${bal.shelbyusd.toFixed(6)} ShelbyUSD`, hint: bal.shelbyusd >= 0.001 ? undefined : "Cần ShelbyUSD để upload" });
    if (!bal.ready) ready = false;
  }

  try {
    const client = getClient(env);
    const rpcBase = (client as any)?.baseUrl ?? (client.rpc as any)?.baseUrl ?? "unknown";
    checks.push({ name: "SDK client", status: "pass", value: `ShelbyNodeClient OK · RPC: ${rpcBase}` });
  } catch (e: any) { checks.push({ name: "SDK client", status: "fail", hint: e.message }); ready = false; }

  const failCount = checks.filter(c => c.status === "fail").length;
  return Response.json({
    ready, passCount: checks.filter(c => c.status === "pass").length, failCount,
    warnCount: checks.filter(c => c.status === "warn").length, checks,
    summary: ready ? "All checks pass — benchmark ready" : `${failCount} issue(s) to fix`,
    checkedAt: new Date().toISOString(),
  }, { headers: CORS });
}

async function handleResults(req: Request, env: Env): Promise<Response> {
  const url     = new URL(req.url);
  const address = url.searchParams.get("address") ?? env.SHELBY_WALLET_ADDRESS ?? "";
  if (!address) return Response.json({ ok: false, error: "address required" }, { status: 400, headers: CORS });
  const key = `bench:results:${address}`;

  if (req.method === "GET") {
    try {
      const raw = await env.SHELBY_KV_MAINNET.get(key);
      return Response.json({ ok: true, address, results: raw ? JSON.parse(raw) : [], count: 0 }, { headers: { ...CORS, "Cache-Control": "no-store" } });
    } catch (e: any) { return Response.json({ ok: false, error: e.message, results: [] }, { headers: CORS }); }
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400, headers: CORS }); }
    const entry = { ts: new Date().toISOString(), avgUploadKbs: nb(body.avgUploadKbs), avgDownloadKbs: nb(body.avgDownloadKbs), latencyAvg: nb(body.latency?.avg), txConfirmMs: nb(body.tx?.confirmTime), score: nb(body.score), uploadSpeeds: (body.uploads ?? []).map((u: any) => nb(u.speedKbs)), downloadSpeeds: (body.downloads ?? []).map((d: any) => nb(d.speedKbs)) };
    try {
      const raw     = await env.SHELBY_KV_MAINNET.get(key);
      const updated = [entry, ...(raw ? JSON.parse(raw) : [])].slice(0, 50);
      await env.SHELBY_KV_MAINNET.put(key, JSON.stringify(updated), { expirationTtl: 90 * 24 * 3600 });
      return Response.json({ ok: true, saved: true, total: updated.length }, { headers: CORS });
    } catch (e: any) { return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS }); }
  }
  return Response.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: CORS });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/health")   return Response.json({ ok: true, worker: "shelby-benchmark", version: "2.1.0", ts: new Date().toISOString() }, { headers: CORS });
    if (url.pathname === "/debug"     && request.method === "GET")  return handleDebug(env);
    if (url.pathname === "/diagnose"  && request.method === "GET")  return handleDiagnose(env);
    if (url.pathname === "/balance"   && request.method === "GET")  return handleBalance(env);
    if (url.pathname === "/latency"   && request.method === "GET")  return handleLatency();
    if (url.pathname === "/txtime"    && request.method === "GET")  return handleTxTime(env);
    if (url.pathname === "/faucet"    && request.method === "POST") return handleFaucet(env);
    if (url.pathname === "/upload"    && request.method === "POST") return handleUpload(request, env);
    if (url.pathname === "/download"  && request.method === "POST") return handleDownload(request, env);
    if (url.pathname === "/results")                                 return handleResults(request, env);
    return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: CORS });
  },
};