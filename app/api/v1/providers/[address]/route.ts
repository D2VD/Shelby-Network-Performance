// app/api/v1/providers/[address]/route.ts
// Proxies to backend GET /api/v1/providers/:address?network=

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } }
): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ error: "VPS not configured" }, { status: 503 });
  }

  const qs = req.nextUrl.searchParams.toString();

  let upstream: Response;
  try {
    upstream = await fetch(`${VPS_URL}/api/v1/providers/${params.address}?${qs}`, {
      next: { revalidate: 0 },
    });
  } catch {
    return NextResponse.json({ error: "Could not reach API service" }, { status: 502 });
  }

  if (!upstream.ok) {
    let message = `Upstream error (${upstream.status})`;
    try {
      const err = (await upstream.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      /* non-JSON error body */
    }
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: 200 });
}