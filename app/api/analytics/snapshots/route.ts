// app/api/analytics/snapshots/route.ts — VPS edition
// Đọc snapshots từ VPS /api/geo-sync/snapshots (MinIO) thay vì CF R2 binding.

import { NextRequest, NextResponse } from "next/server";
import { VPS_API_URL } from "@/app/api/_proxy";

export const runtime    = "edge";
export const revalidate = 300;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? "shelbynet";
  const limit   = Math.min(168, Number(searchParams.get("limit") ?? "24"));

  try {
    const res = await fetch(
      `${VPS_API_URL}/api/geo-sync/snapshots?network=${network}&limit=${limit}`,
      { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } }
    );
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `VPS HTTP ${res.status}`, data: { snapshots: [], count: 0 } }, { status: 200 });
    }
    const data = await res.json() as any;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message, data: { snapshots: [], count: 0 }, hint: "Check SHELBY_API_URL env var" },
      { status: 200 }
    );
  }
}