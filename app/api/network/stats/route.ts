// app/api/network/stats/route.ts — v4.0
// Simple proxy to VPS /api/geo-sync/stats

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const vpsUrl  = process.env.SHELBY_API_URL ?? "";
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";

  if (!vpsUrl) {
    return NextResponse.json({ ok: false, error: "SHELBY_API_URL not configured" }, { status: 503 });
  }

  try {
    const r = await fetch(`${vpsUrl}/api/geo-sync/stats?network=${network}`, {
      signal:  AbortSignal.timeout(12_000),
      headers: { Accept: "application/json" },
    });
    const body = await r.text();
    return new NextResponse(body, {
      status:  r.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15, stale-while-revalidate=60" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `VPS unreachable: ${(e as Error).message}` },
      { status: 503 }
    );
  }
}