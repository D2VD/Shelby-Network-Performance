// app/api/analytics/calibrate/route.ts — VPS edition

import { NextRequest, NextResponse } from "next/server";
import { VPS_API_URL } from "@/app/api/_proxy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret  = searchParams.get("secret") ?? "";
  const network = searchParams.get("network") ?? "shelbynet";

  const syncSecret = process.env.SYNC_SECRET;
  if (syncSecret && secret !== syncSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(
      `${VPS_API_URL}/api/geo-sync/calibrate?network=${network}&secret=${secret}`,
      { method: "POST", signal: AbortSignal.timeout(30_000), headers: { Accept: "application/json" } }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}