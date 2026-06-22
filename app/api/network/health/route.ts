// app/api/network/health/route.ts — v1.0
// Bridges nav.tsx NhiBadge (expects { data: { nhi } }) to VPS /api/network/nhi
// Also used by any consumer that needs a general health envelope.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ status: "error", error: "VPS not configured" }, { status: 503 });
  }

  // nav.tsx NhiBadge does not pass ?network= — defaults to shelbynet.
  // Other consumers can pass ?network=testnet explicitly.
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";

  try {
    const upstream = await fetch(
      `${VPS_URL}/api/network/nhi?network=${encodeURIComponent(network)}`,
      { next: { revalidate: 60 } }
    );

    if (!upstream.ok) {
      return NextResponse.json({ status: "error" }, { status: upstream.status });
    }

    const nhi = await upstream.json();

    // Wrap in { data: ... } — shape required by nav.tsx NhiBadge:
    //   d?.data?.nhi  →  number 0–100
    return NextResponse.json(
      { status: "ok", data: nhi },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } }
    );
  } catch (err) {
    console.error("[health proxy]", err);
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
}