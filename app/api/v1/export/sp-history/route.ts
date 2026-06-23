// app/api/v1/export/sp-history/route.ts — v1.0
// Server-side proxy for /api/v1/export/sp-history
// See snapshots/route.ts for rationale (CSP, no-store, binary passthrough).

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ error: "VPS not configured" }, { status: 503 });
  }

  const qs = req.nextUrl.searchParams.toString();

  // Validate address early — avoids unnecessary VPS round-trip
  if (!req.nextUrl.searchParams.get("address")) {
    return NextResponse.json({ error: "address query param is required" }, { status: 400 });
  }

  const upstream = await fetch(`${VPS_URL}/api/v1/export/sp-history?${qs}`, {
    cache: "no-store",
  });

  if (upstream.status === 429) {
    return NextResponse.json(
      { error: "Rate limit exceeded. 1 export per hour per endpoint." },
      { status: 429 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Upstream error (${upstream.status})` },
      { status: upstream.status }
    );
  }

  const body        = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const disposition = upstream.headers.get("content-disposition") ?? "";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":        contentType,
      "Content-Disposition": disposition,
      "Cache-Control":       "no-store",
    },
  });
}