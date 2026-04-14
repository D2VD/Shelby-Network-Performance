// app/api/network/stats/timeseries/route.ts — v3.0
// Simple proxy to VPS /api/geo-sync/stats/timeseries

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const vpsUrl     = process.env.SHELBY_API_URL ?? "";
  const network    = req.nextUrl.searchParams.get("network")    ?? "shelbynet";
  const resolution = req.nextUrl.searchParams.get("resolution") ?? "5m";
  const range      = req.nextUrl.searchParams.get("range")      ?? "24h";

  if (!vpsUrl) {
    // Return empty series so charts show "Collecting data..." instead of crashing
    return NextResponse.json({
      ok: true,
      data: { network, resolution, range, count: 0, delta: { newBlobs: 0, deletedBlobs: 0, newEvents: 0, storageDeltaGB: 0 }, series: [] },
    });
  }

  try {
    const r = await fetch(
      `${vpsUrl}/api/geo-sync/stats/timeseries?network=${network}&resolution=${resolution}&range=${range}`,
      { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } }
    );
    const body = await r.text();
    return new NextResponse(body, {
      status:  r.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch {
    // VPS down → empty series (charts graceful degrade)
    return NextResponse.json({
      ok: true,
      data: { network, resolution, range, count: 0, delta: { newBlobs: 0, deletedBlobs: 0, newEvents: 0, storageDeltaGB: 0 }, series: [] },
    });
  }
}