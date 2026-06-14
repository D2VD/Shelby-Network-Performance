// app/api/network/blobs-data/route.ts — v2.0
// FIX: use the same env vars + fallback chain as app/api/network/providers/route.ts
//   (SHELBY_API_URL → SHELBY_WORKER_URL → SHELBY_BENCHMARK_WORKER_URL)
// No Authorization header — auth is handled at the Cloudflare Tunnel level,
// same as the providers route. VPS_API_URL / INTERNAL_API_KEY do not exist
// in this project's env and were a mistaken guess in v1.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

export async function GET(req: NextRequest) {
  // Forward all incoming query params as-is:
  //   network, status, address, name, cursor, limit
  const params = req.nextUrl.searchParams;

  if (VPS_URLS.length === 0) {
    return NextResponse.json(
      { ok: false, error: "SHELBY_API_URL not configured", blobs: [] },
      { status: 503 }
    );
  }

  let lastError = "";

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 20_000);

      const r = await fetch(`${vpsUrl}/api/network/blobs-data?${params}`, {
        signal:  controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeoutId);

      // Guard: VPS route not yet deployed → may return HTML 404 page.
      // Don't pass that through — try the next URL / surface a clean error.
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        lastError = `Non-JSON response (${r.status}) from ${vpsUrl}`;
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
      lastError = e.message ?? String(e);
    }
  }

  return NextResponse.json(
    { ok: false, error: `VPS unreachable: ${lastError}`, blobs: [] },
    { status: 503 }
  );
}