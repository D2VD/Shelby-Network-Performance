// app/api/geo-sync/benchmark-results/route.ts — VPS edition
import { NextRequest } from "next/server";
import { proxyToGeoSync, parseBody } from "@/app/api/_proxy";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToGeoSync(req, "/benchmark-results", "POST", body);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  return proxyToGeoSync(req, `/benchmark-results${qs ? `?${qs}` : ""}`, "GET");
}