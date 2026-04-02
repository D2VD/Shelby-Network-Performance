// app/api/geo-sync/debug/route.ts — VPS edition
import { NextRequest, NextResponse } from "next/server";
import { VPS_API_URL } from "@/app/api/_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? "shelbynet";
  try {
    const res = await fetch(
      `${VPS_API_URL}/api/geo-sync/debug?network=${network}`,
      { signal: AbortSignal.timeout(30_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}