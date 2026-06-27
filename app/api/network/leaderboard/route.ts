// app/api/network/leaderboard/route.ts
// Edge proxy → VPS /api/network/leaderboard
// v1.1 — remove next: { revalidate } from fetch() — not supported in CF edge runtime
//         (same issue as blobs-data v2.0 → v2.2). Cache-control on response only.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_BASE = process.env.SHELBY_API_URL ?? "";

export async function GET(req: NextRequest) {
  if (!VPS_BASE) {
    return NextResponse.json(
      { error: "SHELBY_API_URL not configured" },
      { status: 503 }
    );
  }

  const incoming = req.nextUrl.searchParams;
  const params   = new URLSearchParams();
  params.set("network", incoming.get("network") ?? "testnet");
  params.set("sort",    incoming.get("sort")    ?? "score");
  params.set("limit",   incoming.get("limit")   ?? "50");

  const upstream = `${VPS_BASE}/api/network/leaderboard?${params.toString()}`;

  try {
    const res  = await fetch(upstream);   // no fetch options — edge runtime safe
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type":  res.headers.get("content-type") ?? "application/json",
        "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upstream error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}