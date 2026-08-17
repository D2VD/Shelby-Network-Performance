// app/api/v1/activity/stream/route.ts
// Proxies to backend GET /api/v1/activity/stream?network= (Server-Sent Events)
// NOTE: unlike the other v1 proxies, this streams the response body through
// unbuffered rather than awaiting .json() — SSE requires this to stay real-time.

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
    upstream = await fetch(`${VPS_URL}/api/v1/activity/stream?${qs}`, {
      // No revalidate/cache directives — this is a live stream, never cached.
      headers: { Accept: "text/event-stream" },
    });
  } catch {
    return NextResponse.json({ error: "Could not reach API service" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    let message = `Upstream error (${upstream.status})`;
    try {
      const err = (await upstream.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      /* non-JSON error body */
    }
    return NextResponse.json({ error: message }, { status: upstream.status || 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}