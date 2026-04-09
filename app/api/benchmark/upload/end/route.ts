// app/api/benchmark/upload/end/route.ts
// Signal end of benchmark run → starts 10s cooldown on VPS
import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker } from "@/app/api/_proxy";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  return proxyToBenchmarkWorker(req, "/upload/end", "POST", {});
}