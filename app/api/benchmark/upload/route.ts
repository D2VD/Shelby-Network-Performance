// app/api/benchmark/upload/route.ts — v2.0
// FIX: Use VPS proxy (app/api/_proxy.ts) not old CF Worker proxy
import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "@/app/api/_proxy";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToBenchmarkWorker(req, "/upload", "POST", body);
}