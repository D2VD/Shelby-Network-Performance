// app/api/benchmark/results/route.ts — proxy to Benchmark Worker
import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "../_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address") ?? "";
  return proxyToBenchmarkWorker(req, `/results${address ? `?address=${address}` : ""}`, "GET");
}

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToBenchmarkWorker(req, "/results", "POST", body);
}
