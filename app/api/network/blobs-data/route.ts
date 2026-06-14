// app/api/network/blobs-data/route.ts — v3.0
// FIX vs v2: dropped SHELBY_BENCHMARK_WORKER_URL from the fallback chain —
// it's a different service and was producing a confusing "last tried" error
// (e.g. "Non-JSON response (404) from https://…/api/benchmark"). Errors from
// every attempted URL are now collected and reported together so it's clear
// whether the problem is "VPS route not deployed yet" (404, text/plain) vs
// "VPS unreachable" (network error).

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Only the main API + its load-balanced worker handle /api/network/*.
// SHELBY_BENCHMARK_WORKER_URL is a separate service (benchmark results only)
// and never has this route — including it just produced misleading errors.
const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
].filter(Boolean) as string[];

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  if (VPS_URLS.length === 0) {
    return NextResponse.json(
      { ok: false, error: "SHELBY_API_URL not configured", blobs: [] },
      { status: 503 }
    );
  }

  const attempts: string[] = [];

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 20_000);

      const r = await fetch(`${vpsUrl}/api/network/blobs-data?${params}`, {
        signal:  controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeoutId);

      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        // Most common cause: route not yet mounted on this backend (Hono's
        // default 404 handler returns text/plain, not JSON)
        attempts.push(`${vpsUrl} → HTTP ${r.status} (${ct || "no content-type"})`);
        continue;
      }

      const body = await r.text();
      return new NextResponse(body, {
        status:  r.status,
        headers: {
          "Content-Type":  "application/json",
          "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        },
      });
    } catch (e: any) {
      attempts.push(`${vpsUrl} → ${e.message ?? String(e)}`);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Blob search endpoint not available on any backend yet",
      detail: attempts,
      note: "If all attempts show 'HTTP 404 (no content-type)', the /api/network/blobs-data route hasn't been deployed/mounted on the VPS yet.",
      blobs: [],
    },
    { status: 503 }
  );
}