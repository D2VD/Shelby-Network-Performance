// app/api/benchmark/testnet/route.ts — v1.0
// Testnet benchmark endpoint.
// All heavy lifting (SDK, wallet, tx signing) runs on VPS.
// This route proxies to /api/benchmark/testnet/* on VPS.
// Security: validates action param, sanitizes errors.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

const ALLOWED_ACTIONS = new Set([
  "latency", "balance", "diagnose", "upload",
  "download", "txtime", "results",
]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const action = req.nextUrl.searchParams.get("action") ?? "";
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }
  return proxyTestnet(req, `/api/benchmark/testnet/${action}`, "GET");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const action = req.nextUrl.searchParams.get("action") ?? "";
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  return proxyTestnet(req, `/api/benchmark/testnet/${action}`, "POST", body);
}

async function proxyTestnet(
  _req: NextRequest,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<NextResponse> {
  if (VPS_URLS.length === 0) {
    return NextResponse.json({ ok: false, error: "SHELBY_API_URL not configured" }, { status: 503 });
  }
  let lastError = "";
  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      const res = await fetch(`${vpsUrl}${path}`, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return NextResponse.json(
    { ok: false, error: `VPS unreachable: ${lastError}` },
    { status: 503 }
  );
}