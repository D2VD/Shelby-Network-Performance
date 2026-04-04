// app/api/network/stats/live/route.ts
import { type NextRequest } from "next/server";
import { proxyToGeoSync } from "@/app/api/_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";
  return proxyToGeoSync(req, `/stats/live?network=${network}`, "GET", undefined);
}