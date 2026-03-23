// app/api/benchmark/faucet/route.ts — v3
// Proxy sang Benchmark Worker (như các routes khác).
// Worker có SHELBY_WALLET_ADDRESS trong secrets → không cần env var trên Pages.

import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "../_proxy";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToBenchmarkWorker(req, "/faucet", "POST", body);
}
