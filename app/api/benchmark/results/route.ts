// app/api/benchmark/results/route.ts — v2.0
// GET → trả all benchmark results từ Redis (cho Charts page)
// POST → lưu benchmark result lên server

import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "../_proxy";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "200";
  return proxyToBenchmarkWorker(req, `/results?limit=${limit}`, "GET");
}

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToBenchmarkWorker(req, "/results", "POST", body);
}