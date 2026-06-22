// app/api/network/nhi/route.ts
// Edge proxy — forwards to VPS /api/network/nhi
// Priority 1: Network Health Index

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ error: "VPS not configured" }, { status: 503 });
  }

  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";

  try {
    const upstream = await fetch(
      `${VPS_URL}/api/network/nhi?network=${encodeURIComponent(network)}`,
      { next: { revalidate: 60 } }
    );

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Upstream error" },
        { status: upstream.status }
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  } catch (err) {
    console.error("[NHI proxy]", err);
    return NextResponse.json({ error: "Failed to fetch NHI" }, { status: 502 });
  }
}