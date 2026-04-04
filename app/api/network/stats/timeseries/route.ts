// app/api/network/stats/timeseries/route.ts
import { type NextRequest } from "next/server";
import { proxyToGeoSync } from "@/app/api/_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const network    = searchParams.get("network")    ?? "shelbynet";
  const resolution = searchParams.get("resolution") ?? "5m";
  const range      = searchParams.get("range")      ?? "24h";
  return proxyToGeoSync(
    req,
    `/stats/timeseries?network=${network}&resolution=${resolution}&range=${range}`,
    "GET",
    undefined
  );
}