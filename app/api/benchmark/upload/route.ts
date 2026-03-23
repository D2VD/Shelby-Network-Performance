// app/api/benchmark/upload/route.ts — proxy to Benchmark Worker
import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "../_proxy";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToBenchmarkWorker(req, "/upload", "POST", body);
}
