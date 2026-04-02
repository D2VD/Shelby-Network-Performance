/**
 * app/api/_proxy.ts — VPS Proxy Helper v2.0
 *
 * Kiến trúc mới (VPS + Cloudflare Tunnel):
 *   Trước: CF Pages → CF Worker (benchmark) + CF Worker (geo-sync)
 *   Nay:   CF Pages → VPS/Caddy qua Cloudflare Tunnel
 *
 * 1 env var duy nhất: SHELBY_API_URL = https://api.yourdomain.com
 * Caddy routing trên VPS:
 *   /api/benchmark/* → shelby-api:3000
 *   /api/geo-sync/*  → shelby-api:3000
 *
 * KHÔNG dùng SHELBY_WORKER_URL hay SHELBY_BENCHMARK_WORKER_URL nữa.
 */

import { NextRequest, NextResponse } from "next/server";

// ── Single source of truth ────────────────────────────────────────────────────
// Set trong CF Pages environment variables:
//   SHELBY_API_URL = https://api.shelbyanalytics.site  (domain thực của bạn)
//
// Fallback chỉ dùng cho development local (không có tunnel)
export const VPS_API_URL =
  process.env.SHELBY_API_URL ??
  process.env.SHELBY_WORKER_URL ??          // backward compat nếu chưa đổi env
  process.env.SHELBY_BENCHMARK_WORKER_URL ?? // backward compat
  "http://localhost:3000";                    // local dev fallback

// ─── Generic proxy helper ─────────────────────────────────────────────────────
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
          ? "Request timed out — VPS hoặc Cloudflare Tunnel có thể đang bị tắt"
          : "Kiểm tra SHELBY_API_URL env var và Cloudflare Tunnel status",
        vpsUrl: url,
      },
      { status: 503 }
    );
  }
}

// ─── Backward-compat aliases (giữ để không phải đổi import ở mọi route) ────────
export const proxyToBenchmarkWorker = (
  req: NextRequest,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: object
) => proxyToVPS(req, `/api/benchmark${path}`, method, body, 60_000);

export const proxyToGeoSync = (
  req: NextRequest,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: object
) => proxyToVPS(req, `/api/geo-sync${path}`, method, body, 15_000);

// ─── Parse body helper ────────────────────────────────────────────────────────
export async function parseBody(req: NextRequest): Promise<Record<string, any>> {
  try { return await req.json(); }
  catch { return {}; }
}