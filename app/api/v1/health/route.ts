// app/api/v1/health/route.ts
// Proxies to backend GET /api/v1/health.
// NOTE: backend returns 200 (all services ok) OR 503 (degraded) — both are
// meaningful JSON bodies ({ status, version, latencyMs, services, timeseries,
// timestamp }), not an { error } shape. So unlike other v1 routes, this one
// passes the body through unchanged at whatever status the backend gives it,
// rather than trying to extract an "error" field on non-200 responses.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URL = process.env.SHELBY_API_URL;

export async function GET(_req: NextRequest): Promise<NextResponse> {
  if (!VPS_URL) {
    return NextResponse.json({ error: "VPS not configured" }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${VPS_URL}/api/v1/health`, { next: { revalidate: 0 } });
  } catch {
    return NextResponse.json(
      { status: "unreachable", error: "Could not reach API service" },
      { status: 502 }
    );
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return NextResponse.json(
      { status: "unreachable", error: "Upstream returned non-JSON response" },
      { status: 502 }
    );
  }

  // Pass through as-is — preserves the full degraded/ok body and status code.
  return NextResponse.json(data as object, { status: upstream.status });
}