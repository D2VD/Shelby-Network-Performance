// app/api/geo-sync/stats/live/route.ts — v4.0
//
// Simple proxy to VPS. VPS confirmed working (Apr 12 13:42).
// VPS handles all testnet + shelbynet logic in geo-sync-testnet.ts / geo-sync-shelbynet.ts
// Frontend just forwards the request and returns VPS response.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const vpsUrl = process.env.SHELBY_API_URL ?? "";
  if (!vpsUrl) {
    return NextResponse.json({ ok: false, error: "SHELBY_API_URL not configured" }, { status: 503 });
  }

  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";
  const url     = `${vpsUrl}/api/geo-sync/stats/live?network=${network}`;

  try {
    const r = await fetch(url, {
      signal:  AbortSignal.timeout(15_000),
      headers: { Accept: "application/json" },
    });
    const body = await r.text();
    return new NextResponse(body, {
      status:  r.status,
      headers: {
        "Content-Type":  "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `VPS unreachable: ${(e as Error).message}` },
      { status: 503 }
    );
  }
}