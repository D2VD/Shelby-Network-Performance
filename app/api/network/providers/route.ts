// app/api/network/providers/route.ts — v4.0
// Simple proxy to VPS /api/geo-sync/providers

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const vpsUrl  = process.env.SHELBY_API_URL ?? "";
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";
  const noTcp   = req.nextUrl.searchParams.get("no_tcp") ?? "";

  if (!vpsUrl) {
    return NextResponse.json({ ok: false, error: "SHELBY_API_URL not configured" }, { status: 503 });
  }

  const params = new URLSearchParams({ network });
  if (noTcp) params.set("no_tcp", noTcp);

  try {
    const r = await fetch(`${vpsUrl}/api/geo-sync/providers?${params}`, {
      signal:  AbortSignal.timeout(20_000), // providers can take longer (tier 2 SP metadata)
      headers: { Accept: "application/json" },
    });
    const body = await r.text();
    return new NextResponse(body, {
      status:  r.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `VPS unreachable: ${(e as Error).message}` },
      { status: 503 }
    );
  }
}