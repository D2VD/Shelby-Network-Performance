// app/api/dashboard/route.ts
// DEPRECATED — redirects to /api/network/stats for backward compatibility
// The dashboard page now calls /api/network/stats directly
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: Request) {
  // Forward to the new consolidated endpoint
  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const res = await fetch(`${base}/api/network/stats`, {
    headers: { "x-forwarded-from": "api/dashboard" },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}