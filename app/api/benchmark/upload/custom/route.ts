// app/api/benchmark/upload/custom/route.ts
// Custom upload — no rate limiting, proxies to VPS /api/benchmark/upload/custom
import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "@/app/api/_proxy";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToBenchmarkWorker(req, "/upload/custom", "POST", body);
}