// app/api/geo-sync/benchmark-results/route.ts
// Proxy benchmark results sang VPS geo-sync service để lưu vào Redis.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const WORKER_URL =
  process.env.SHELBY_WORKER_URL ??
  "https://shelby-geo-sync.doanvandanh20000.workers.dev";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res  = await fetch(`${WORKER_URL}/benchmark-results`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    // Không throw — frontend không nên fail chỉ vì save analytics thất bại
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}

export async function GET(req: NextRequest) {
  const params  = new URL(req.url).searchParams;
  const qs      = params.toString();
  try {
    const res  = await fetch(`${WORKER_URL}/benchmark-results${qs ? `?${qs}` : ""}`, {
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}