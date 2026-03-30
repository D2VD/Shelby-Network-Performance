// benchmark.ts - PHIÊN BẢN HOÀN THIỆN (v2.3.9)
// Sửa lỗi: Custom Indexer URL, WASM Module Mapping và Aptos v2 Type Safety

import wasmModule from "./clay.wasm"; 
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import {
  Network,
  Ed25519PrivateKey,
  Ed25519Account,
  Aptos,
  AptosConfig,
} from "@aptos-labs/ts-sdk"; 
import type { ExecutionContext } from "@cloudflare/workers-types";
import { Buffer } from "node:buffer";

// --- Types and Interfaces ---
interface Env {
  SHELBY_PRIVATE_KEY:    string;
  SHELBY_WALLET_ADDRESS: string;
  SHELBY_API_KEY?:       string;
}

interface LocalFungibleAsset {
  asset_type: string;
  amount: number;
}

// --- Constants ---
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

// --- Singletons ---
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
    network: "shelbynet" as any,
    // Truyền trực tiếp Module đã biên dịch từ Wrangler vào SDK
    clay: { wasm: wasmModule }, 
    rpc: { baseUrl: SHELBY_RPC_BASE },
    // Cấu hình Indexer ở root level để sửa lỗi "Please provide a custom indexer url"
    indexer: { baseUrl: SHELBY_INDEXER },
    aptos: {
      network: Network.CUSTOM,
      fullnode: SHELBY_NODE,
      indexer: SHELBY_INDEXER,
    },
    ...(env.SHELBY_API_KEY ? { apiKey: env.SHELBY_API_KEY } : {}),
  } as any);
  return _client;
}

// --- Helpers ---
const nb = (v: any, fb = 0) => { const x = Number(v ?? fb); return isNaN(x) ? fb : x; };
const generatePayload = (bytes: number) => Buffer.alloc(bytes).map((_, i) => (i * 37 + 13) % 256);
const uniqueBlobName = (bytes: number) => `bench/${bytes}/${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

async function getBalance(env: Env) {
  const address = env.SHELBY_WALLET_ADDRESS;
  const aptos = new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: SHELBY_NODE }));
  
  // Sử dụng hàm getCurrentFungibleAssetBalances thay cho các hàm cũ bị xóa trong SDK v2
  const [apt, assets] = await Promise.all([
      aptos.getAccountCoinAmount({ accountAddress: address, coinType: "0x1::aptos_coin::AptosCoin" }),
      aptos.getCurrentFungibleAssetBalances({ options: { where: { owner_address: { _eq: address } } } })
  ]);

  const shelbyusd = (assets as unknown as LocalFungibleAsset[]).find(
      (a) => a.asset_type === SHELBYUSD_META
  )?.amount ?? 0;

  const aptAmount = Number(apt) / 1e8;
  const usdAmount = Number(shelbyusd) / 1e8;
  return { 
    address, 
    apt: aptAmount, 
    shelbyusd: usdAmount, 
    ready: aptAmount >= 0.1 && usdAmount >= 0.001 
  };
}

// --- Route Handlers ---
const handle = (fn: (req: Request, env: Env) => Promise<any>) => async (req: Request, env: Env) => {
    try {
        return Response.json(await fn(req, env), { headers: CORS });
    } catch(e: any) {
        return Response.json({ error: e.message, stack: e.stack }, { status: 500, headers: CORS });
    }
};

const handleUpload = handle(async (req, env) => {
    const { sizeIndex } = await req.json().catch(() => ({})) as any;
    const bytes = TEST_SIZES[sizeIndex ?? 0] ?? TEST_SIZES[0];
    const t0 = performance.now();
    const result = await getClient(env).upload({
        signer: getAccount(env),
        blobData: generatePayload(bytes),
        blobName: uniqueBlobName(bytes),
        expirationMicros: (Date.now() + 3600 * 1000) * 1000
    });
    const elapsed = performance.now() - t0;
    return { bytes, elapsed, speedKbs: (bytes / 1024) / (elapsed / 1000), blobName: (result as any).metadata.blobName, txHash: (result as any).transaction.hash };
});

const handleDownload = handle(async (req, env) => {
    const { blobName } = await req.json() as any;
    const t0 = performance.now();
    const result = await getClient(env).download({ account: env.SHELBY_WALLET_ADDRESS, blobName });
    const elapsed = performance.now() - t0;
    const bytes = (result as any).length;
    return { bytes, elapsed, speedKbs: bytes > 0 ? (bytes / 1024) / (elapsed / 1000) : 0 };
});

const handleTxTime = handle(async (req, env) => {
    const t0 = performance.now();
    const result = await getClient(env).upload({
        signer: getAccount(env),
        blobData: generatePayload(512),
        blobName: uniqueBlobName(512),
        expirationMicros: (Date.now() + 3600 * 1000) * 1000
    });
    const elapsed = performance.now() - t0;
    return { submitTime: elapsed, confirmTime: elapsed, txHash: (result as any).transaction.hash };
});

const handleLatency = handle(async () => {
    const times = await Promise.all(Array(5).fill(0).map(async (_, i) => {
        if(i > 0) await new Promise(r => setTimeout(r, 150));
        const t0 = performance.now();
        await fetch(`${SHELBY_NODE}/`, { signal: AbortSignal.timeout(5000) });
        return performance.now() - t0;
    }));
    times.sort((a,b) => a-b);
    const trimmed = times.slice(1,4);
    return { avg: trimmed.reduce((a,b) => a+b,0)/3, min: trimmed[0], max: trimmed[2] };
});

const handleBalance = handle((req, env) => getBalance(env));

const handleFaucet = handle(async(req, env) => {
    const address = env.SHELBY_WALLET_ADDRESS;
    await Promise.all([
        fetch(`${FAUCET_BASE}/mint`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, amount: 1e8 }) }),
        fetch(`${FAUCET_BASE}/mint`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, amount: 1e7, token: 'shelbyusd' }) })
    ]);
    await new Promise(r => setTimeout(r, 3000));
    return getBalance(env);
});

const handleDiagnose = handle(async (req, env) => {
    const checks: { name: string, status: 'pass'|'fail', value?: string, hint?: string }[] = [];
    const fail = (name: string, hint: string) => checks.push({ name, status: 'fail', hint });
    const pass = (name: string, value: string) => checks.push({ name, status: 'pass', value });

    try { getAccount(env); pass("Private key", "Valid Ed25519"); } 
    catch(e:any) { fail("Private key", e.message); }

    try {
        const r = await fetch(`${SHELBY_NODE}/`);
        const d = await r.json() as any;
        pass("Shelbynet node", `Block #${nb(d.block_height).toLocaleString()}`);
    } catch(e:any) { fail("Shelbynet node", e.message); }

    try {
        const bal = await getBalance(env);
        if(bal.ready) pass("Balance", `${bal.apt.toFixed(4)} APT / ${bal.shelbyusd.toFixed(4)} USD`);
        else fail("Balance", `Cần nạp thêm APT (>0.1) hoặc USD (>0.001)`);
    } catch(e:any) { fail("Balance", e.message); }

    try {
        const client = getClient(env);
        // Kiểm tra an toàn để sửa lỗi "Clay encoder not initialized"
        const clay = (client as any)._clay;
        if (clay && typeof clay.getEncoder === 'function') {
            pass("SDK client", "OK (WASM loaded)");
        } else {
            fail("SDK client", "Clay encoder chưa được khởi tạo");
        }
    } catch(e:any) { fail("SDK client", e.message); }
    
    const failCount = checks.filter(c => c.status==='fail').length;
    return { ready: failCount === 0, checks, failCount, summary: failCount > 0 ? `${failCount} lỗi cần xử lý` : 'Sẵn sàng' };
});

// --- Main Router ---
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    
    const routes: Record<string, (req: Request, env: Env) => Promise<Response>> = {
        "/health":   async () => Response.json({ ok: true, version: "2.3.9" }, { headers: CORS }),
        "/upload":   handleUpload,
        "/download": handleDownload,
        "/txtime":   handleTxTime,
        "/latency":  handleLatency,
        "/balance":  handleBalance,
        "/faucet":   handleFaucet,
        "/diagnose": handleDiagnose,
    };
    
    const handler = routes[url.pathname];
    if (handler) return handler(request, env);
    return Response.json({ error: "Đường dẫn không tồn tại" }, { status: 404, headers: CORS });
  }
};