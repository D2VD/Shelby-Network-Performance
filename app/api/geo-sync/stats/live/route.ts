// app/api/geo-sync/stats/live/route.ts — v5.0
// Better error handling with multiple VPS URL fallback

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

export async function GET(req: NextRequest) {
  if (VPS_URLS.length === 0) {
    return NextResponse.json(
      { ok: false, error: "SHELBY_API_URL not configured" },
      { status: 503 }
    );
  }

  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";
  let lastError = "";

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);

      const r = await fetch(`${vpsUrl}/api/geo-sync/stats/live?network=${network}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeoutId);

      const body = await r.text();
      return new NextResponse(body, {
        status: r.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch (e: any) {
      lastError = e.message ?? String(e);
    }
  }

  return NextResponse.json(
    { ok: false, error: `VPS unreachable: ${lastError}` },
    { status: 503 }
  );
}