// app/api/network/blobs-data/route.ts — v2.1
// v2.1: Expose fetch exception detail in 502 response for diagnostics.
//       Remove after root cause confirmed.

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

  const qs       = req.nextUrl.searchParams.toString();
  const upstream = `${VPS_URL}/api/network/blobs-data?${qs}`;

  let res: Response;
  try {
    res = await fetch(upstream, { cache: "no-store" });
  } catch (err) {
    // v2.1: expose exception so we can diagnose CF edge → VPS routing
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Could not reach blob data service", detail, upstream },
      { status: 502 }
    );
  }

  if (!res.ok) {
    let message = `Upstream error (${res.status})`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* non-JSON body */ }
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}