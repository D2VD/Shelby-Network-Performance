// app/api/benchmark/diagnose/route.ts — v2.0
// FIX: Use VPS proxy
import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker } from "@/app/api/_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  return proxyToBenchmarkWorker(req, "/diagnose", "GET");
}