// app/api/geo-sync/stats/live/route.ts
// Real-time stats endpoint — bypass Redis cache, poll trực tiếp từ VPS.
// Dùng cho Charts page (poll mỗi 30s).

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const WORKER_URL =
  process.env.SHELBY_WORKER_URL ??
  "https://shelby-geo-sync.doanvandanh20000.workers.dev";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? "shelbynet";

  try {
    const res  = await fetch(`${WORKER_URL}/stats/live?network=${network}`, {
      signal:  AbortSignal.timeout(15_000), // SDK calls can take ~5-10s
      headers: { "Accept": "application/json" },
    });
    const data = await res.json();
    return NextResponse.json(data, {
      status:  res.status,
      headers: { "Cache-Control": "no-store" }, // no cache — real-time
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}