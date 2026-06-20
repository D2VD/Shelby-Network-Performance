// app/api/network/leaderboard/route.ts
// Edge proxy → VPS /api/network/leaderboard
// v1.0

import { NextRequest, NextResponse } from "next/server";

const VPS_BASE = process.env.SHELBY_API_URL ?? "";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  if (!VPS_BASE) {
    return NextResponse.json(
      { error: "SHELBY_API_URL not configured" },
      { status: 503 }
    );
  }

  // Forward only the params we care about
  const incoming = req.nextUrl.searchParams;
  const params = new URLSearchParams();

  const network = incoming.get("network") ?? "testnet";
  const sort    = incoming.get("sort")    ?? "score";
  const limit   = incoming.get("limit")   ?? "50";

  params.set("network", network);
  params.set("sort",    sort);
  params.set("limit",   limit);

  const upstream = `${VPS_BASE}/api/network/leaderboard?${params.toString()}`;

  try {
    const res = await fetch(upstream, {
      headers: { "x-shelby-internal": "1" },
      next: { revalidate: 300 }, // 5-min edge cache
    });

    const body = await res.text();

    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upstream error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}