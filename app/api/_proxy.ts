/**
 * app/api/_proxy.ts — VPS Proxy Helper v4.0
 *
 * FIXES:
 * 1. Try multiple VPS URLs (SHELBY_API_URL, SHELBY_WORKER_URL, SHELBY_BENCHMARK_WORKER_URL)
 * 2. Better timeout handling — use AbortController (Edge-compatible)
 * 3. Clear error messages distinguishing config issues from network issues
 * 4. Benchmark routes all point to VPS /api/benchmark/*
 */

import { NextRequest, NextResponse } from "next/server";

// ── Multiple VPS URL candidates (try in order) ────────────────────────────────
const ALL_VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter((u): u is string => Boolean(u));

// Primary URL for display/logging
export const VPS_API_URL = ALL_VPS_URLS[0] ?? "http://localhost:3000";

// ── Generic VPS proxy helper ──────────────────────────────────────────────────
export async function proxyToVPS(
  _req: NextRequest,
  vpsPath: string,
  method: "GET" | "POST" = "GET",
  body?: object,
  timeoutMs = 60_000
): Promise<NextResponse> {
  if (ALL_VPS_URLS.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No VPS URL configured",
        hint: "Set SHELBY_API_URL environment variable in Cloudflare Pages settings",
      },
      { status: 503 }
    );
  }

  let lastError = "";

  for (const vpsUrl of ALL_VPS_URLS) {
    const url = `${vpsUrl}${vpsPath}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body:    method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal:  controller.signal,
      });

      clearTimeout(timer);

      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (err: any) {
      lastError = err.message ?? String(err);
      console.warn(`[proxy] ${method} ${url} failed:`, lastError);
    }
  }

  const isTimeout = lastError.includes("abort") || lastError.includes("timeout") || lastError.includes("Abort");
  return NextResponse.json(
    {
      ok: false,
      error: `VPS unreachable: ${lastError}`,
      hint: isTimeout
        ? "Request timed out — check Cloudflare Tunnel status and VPS health"
        : "Check SHELBY_API_URL env var and ensure the VPS Docker stack is running",
      triedCount: ALL_VPS_URLS.length,
    },
    { status: 503 }
  );
}

// ── Benchmark proxy → VPS /api/benchmark/* ───────────────────────────────────
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
) => proxyToVPS(req, `/api/geo-sync${path}`, method, body, 20_000);

// ── Parse body helper ─────────────────────────────────────────────────────────
export async function parseBody(req: NextRequest): Promise<Record<string, any>> {
  try { return await req.json(); }
  catch { return {}; }
}