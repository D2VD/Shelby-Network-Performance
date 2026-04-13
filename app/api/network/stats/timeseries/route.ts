// app/api/network/stats/timeseries/route.ts — v3.0
//
// Timeseries data comes from VPS Redis (accumulated over time).
// If VPS is down → return empty series (graceful, charts show "Collecting data...")
// Never return 503 to frontend — always return valid JSON.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const EMPTY_RESPONSE = (network: string, resolution: string, range: string) => ({
  ok: true,
  data: {
    network, resolution, range, count: 0,
    delta: { newBlobs: 0, deletedBlobs: 0, newEvents: 0, storageDeltaGB: 0 },
    series: [],
  },
});

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const network    = searchParams.get("network")    ?? "shelbynet";
  const resolution = searchParams.get("resolution") ?? "5m";
  const range      = searchParams.get("range")      ?? "24h";

  if (!["5m", "1h"].includes(resolution)) {
    return NextResponse.json({ ok: false, error: "resolution must be 5m or 1h" }, { status: 400 });
  }
  if (!["1h", "24h", "7d", "30d"].includes(range)) {
    return NextResponse.json({ ok: false, error: "range must be 1h|24h|7d|30d" }, { status: 400 });
  }

  // Testnet: no historical timeseries
  if (network === "testnet") {
    return NextResponse.json(EMPTY_RESPONSE(network, resolution, range));
  }

  // Try VPS (has Redis timeseries accumulated from cron)
  const vpsUrl = process.env.SHELBY_API_URL ?? "";
  if (vpsUrl) {
    try {
      const r = await fetch(
        `${vpsUrl}/api/geo-sync/stats/timeseries?network=${network}&resolution=${resolution}&range=${range}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (r.ok) {
        const data = await r.json();
        return NextResponse.json(data, {
          headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
        });
      }
    } catch { /* VPS down → return empty */ }
  }

  // VPS down → empty series (charts show "Collecting data..." which is correct)
  return NextResponse.json(EMPTY_RESPONSE(network, resolution, range));
}