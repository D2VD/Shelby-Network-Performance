// app/api/v1/export/snapshots/route.ts — v1.0
// Server-side proxy for /api/v1/export/snapshots
// Streams the VPS response (CSV or JSON) through Next.js — no browser→VPS fetch,
// so CSP connect-src is never involved.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs"; // NOT edge — we stream binary/text bodies

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ error: "VPS not configured" }, { status: 503 });
  }

  // Forward all query params as-is
  const qs       = req.nextUrl.searchParams.toString();
  const upstream = await fetch(`${VPS_URL}/api/v1/export/snapshots?${qs}`, {
    // No cache — this is a download endpoint
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