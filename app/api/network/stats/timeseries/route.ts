// app/api/network/stats/timeseries/route.ts — v4.0
// Better error handling, multiple VPS URL fallback

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

const EMPTY_RESPONSE = {
  ok: true,
  data: {
    count: 0,
    delta: { newBlobs: 0, deletedBlobs: 0, newEvents: 0, storageDeltaGB: 0 },
    series: [],
  },
};

export async function GET(req: NextRequest) {
  const network    = req.nextUrl.searchParams.get("network")    ?? "shelbynet";
  const resolution = req.nextUrl.searchParams.get("resolution") ?? "5m";
  const range      = req.nextUrl.searchParams.get("range")      ?? "24h";

  if (VPS_URLS.length === 0) {
    return NextResponse.json({ ...EMPTY_RESPONSE, data: { ...EMPTY_RESPONSE.data, network, resolution, range } });
  }

  let lastError = "";

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      const r = await fetch(
        `${vpsUrl}/api/geo-sync/stats/timeseries?network=${network}&resolution=${resolution}&range=${range}`,
        { signal: controller.signal, headers: { Accept: "application/json" } }
      );

      clearTimeout(timeoutId);

      const body = await r.text();
      return new NextResponse(body, {
        status: r.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    } catch (e: any) {
      lastError = e.message ?? String(e);
    }
  }

  // Graceful degrade — return empty series so charts show "Collecting data..."
  console.warn(`[timeseries] All VPS attempts failed: ${lastError}`);
  return NextResponse.json({ ...EMPTY_RESPONSE, data: { ...EMPTY_RESPONSE.data, network, resolution, range } });
}