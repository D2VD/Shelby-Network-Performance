// app/api/network/leaderboard/route.ts — v1.0
// Edge proxy: forwards leaderboard requests to VPS.
// Uses SHELBY_API_URL (general base) — never SHELBY_WORKER_URL.

import { NextRequest, NextResponse } from "next/server";

const VPS_BASE = process.env.SHELBY_API_URL;

export const runtime = "edge";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!VPS_BASE) {
    return NextResponse.json(
      { error: "SHELBY_API_URL is not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);

  // Whitelist params forwarded upstream — no passthrough of arbitrary params
  const network = searchParams.get("network") ?? "shelbynet";
  const sort = searchParams.get("sort") ?? "score";
  const limit = searchParams.get("limit") ?? "50";

  const upstream = `${VPS_BASE}/api/network/leaderboard?network=${encodeURIComponent(network)}&sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(limit)}`;

  try {
    const res = await fetch(upstream, {
      headers: { "Content-Type": "application/json" },
      // 60s revalidation — leaderboard data doesn't change faster than sync interval
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Upstream error ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: {
        // Allow CDN/browser to cache for 60s
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Upstream unreachable: ${message}` },
      { status: 502 }
    );
  }
}