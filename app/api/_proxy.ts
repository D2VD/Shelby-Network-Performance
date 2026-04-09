/**
 * app/api/_proxy.ts — VPS Proxy Helper v3.0
 *
 * Single source of truth: SHELBY_API_URL env var → VPS via Cloudflare Tunnel
 *
 * Routes:
 *   /api/benchmark/* → VPS shelby-api:3000/api/benchmark/*
 *   /api/geo-sync/*  → VPS shelby-api:3000/api/geo-sync/*
 *
 * IMPORTANT: DO NOT use benchmark/_proxy.ts anymore.
 * All benchmark routes must import from @/app/api/_proxy
 */

import { NextRequest, NextResponse } from "next/server";

// ── Single source of truth ────────────────────────────────────────────────────
export const VPS_API_URL =
  process.env.SHELBY_API_URL ??
  process.env.SHELBY_WORKER_URL ??
  process.env.SHELBY_BENCHMARK_WORKER_URL ??
  "http://localhost:3000";

// ── Generic VPS proxy helper ──────────────────────────────────────────────────
export async function proxyToVPS(
  _req: NextRequest,
  vpsPath: string,
  method: "GET" | "POST" = "GET",
  body?: object,
  timeoutMs = 60_000
): Promise<NextResponse> {
  const url = `${VPS_API_URL}${vpsPath}`;
  try {
    const res = await fetch(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body:    method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal:  AbortSignal.timeout(timeoutMs),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
    return NextResponse.json(
      {
        ok:    false,
        error: `VPS unreachable: ${err.message}`,
        hint:  isTimeout
          ? "Request timed out — VPS or Cloudflare Tunnel may be down"
          : "Check SHELBY_API_URL env var and Cloudflare Tunnel status",
        vpsUrl: url,
      },
      { status: 503 }
    );
  }
}

// ── Benchmark proxy → VPS /api/benchmark/* ───────────────────────────────────
// Previously routed to a separate CF Worker — now all goes to VPS
export const proxyToBenchmarkWorker = (
  req: NextRequest,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: object
) => proxyToVPS(req, `/api/benchmark${path}`, method, body, 60_000);

// ── Geo-sync proxy → VPS /api/geo-sync/* ─────────────────────────────────────
export const proxyToGeoSync = (
  req: NextRequest,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: object
) => proxyToVPS(req, `/api/geo-sync${path}`, method, body, 15_000);

// ── Parse body helper ─────────────────────────────────────────────────────────
export async function parseBody(req: NextRequest): Promise<Record<string, any>> {
  try { return await req.json(); }
  catch { return {}; }
}