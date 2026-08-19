// app/api/v1/export/sp-history/route.ts — v1.1
// FIX: runtime = 'edge' (CF Pages requires all routes to be edge)

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ error: "VPS not configured" }, { status: 503 });
  }

  // Validate address before hitting the VPS
  if (!req.nextUrl.searchParams.get("address")) {
    return NextResponse.json({ error: "address query param is required" }, { status: 400 });
  }

  const qs = req.nextUrl.searchParams.toString();

  let upstream: Response;
  try {
    upstream = await fetch(`${VPS_URL}/api/v1/export/sp-history?${qs}`, {
      cache: "no-store",
    });
  } catch (err) {
  console.error(`[export proxy] fetch to Server failed:`, err instanceof Error ? err.message : String(err));
  return NextResponse.json({ error: "Could not reach API service" }, { status: 502 });
}

  if (upstream.status === 429) {
    return NextResponse.json(
      { error: "Rate limit exceeded. 1 export per hour per endpoint." },
      { status: 429 }
    );
  }

  if (!upstream.ok) {
    let message = `Upstream error (${upstream.status})`;
    try {
      const err = await upstream.json() as { error?: string };
      if (err.error) message = err.error;
    } catch { /* non-JSON */ }
    return NextResponse.json({ error: message }, { status: upstream.status });
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