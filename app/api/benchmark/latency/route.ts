// app/api/benchmark/latency/route.ts — proxy to Benchmark Worker
import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker } from "../_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  return proxyToBenchmarkWorker(req, "/latency", "GET");
}
