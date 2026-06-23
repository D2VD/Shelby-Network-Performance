// app/api/v1/export/snapshots/route.ts — v1.1
// FIX: runtime = 'edge' (CF Pages requires all routes to be edge)
// arrayBuffer() passthrough works fine on edge — no Node.js APIs needed.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ error: "VPS not configured" }, { status: 503 });
  }

  const qs = req.nextUrl.searchParams.toString();

  let upstream: Response;
  try {
    upstream = await fetch(`${VPS_URL}/api/v1/export/snapshots?${qs}`, {
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Could not reach export service" }, { status: 502 });
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