// app/api/benchmark/results/route.ts — v3.0
// FIX: Use VPS proxy (proxyToBenchmarkWorker from app/api/_proxy.ts)
// NOT the old CF Worker proxy from benchmark/_proxy.ts
// GET  → VPS /api/benchmark/results (Redis bench:results:global)
// POST → VPS /api/benchmark/results (save result)

import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "@/app/api/_proxy";

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