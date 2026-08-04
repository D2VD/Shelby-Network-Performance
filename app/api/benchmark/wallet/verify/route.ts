// app/api/benchmark/wallet/verify/route.ts — new
//
// FIX (bug #1, wallet-verify handoff): this route never existed. Directory
// listing confirmed no `wallet` folder under app/api/benchmark/, so
// POST /wallet/verify 404'd on Cloudflare Pages before any proxy code ran.
// Pages' edge-function 404 for an unmatched route returns an effectively
// empty body — that's what produced the client-side
// "Unexpected end of JSON input" in use-wallet-session.ts's verify(). Root
// cause was a missing file, not a bug in either _proxy.ts.
//
// Mirrors app/api/benchmark/results/route.ts exactly: imports from
// @/app/api/_proxy (the live VPS proxy). Do NOT import from
// app/api/benchmark/_proxy.ts — that file is confirmed dead code (see its
// own header comment) and proxies to a retired Cloudflare Worker URL.
//
// This is a pure pass-through — the request body (address, publicKey,
// signature, fullMessage per benchmark.ts's POST /wallet/verify handler) is
// forwarded as-is, so this route doesn't need to know or validate its shape.

import { type NextRequest } from "next/server";
import { proxyToBenchmarkWorker, parseBody } from "@/app/api/_proxy";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  return proxyToBenchmarkWorker(req, "/wallet/verify", "POST", body);
}