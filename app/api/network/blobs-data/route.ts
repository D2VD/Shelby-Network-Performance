// app/api/network/blobs-data/route.ts — v2.0
// Edge Proxy only — no business logic here per architecture rules.
// FIX: removed SHELBY_WORKER_URL from VPS_URLS (was causing geo-sync endpoint
//      to be called for blob data → wrong response → 502).
// Only SHELBY_API_URL is used; all query params forwarded as-is to VPS.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json(
      { error: "VPS not configured" },
      { status: 503 }
    );
  }

  const qs = req.nextUrl.searchParams.toString();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${VPS_URL}/api/network/blobs-data?${qs}`,
      { cache: "no-store" }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reach blob data service" },
      { status: 502 }
    );
  }

  // Pass upstream status through — don't swallow 404 as 502
  if (!upstream.ok) {
    let message = `Upstream error (${upstream.status})`;
    try {
      const body = await upstream.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* non-JSON body */ }
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  const data = await upstream.json();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}