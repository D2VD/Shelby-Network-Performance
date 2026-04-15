// app/api/network/providers/route.ts — v6.0
// FIX: Always request no_tcp=1 — health comes from on-chain condition field
// This makes providers load FAST (no TCP wait for private IPs)

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

export async function GET(req: NextRequest) {
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";

  if (VPS_URLS.length === 0) {
    return NextResponse.json(
      { ok: false, error: "SHELBY_API_URL not configured", data: { providers: [], count: 0 } },
      { status: 503 }
    );
  }

  // Always no_tcp=1: health derived from on-chain condition field (faster & accurate)
  // Shelbynet SPs use private IPs (172.16.x.x) unreachable from VPS
  const params = new URLSearchParams({ network, no_tcp: "1" });
  let lastError = "";

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 25_000);

      const r = await fetch(`${vpsUrl}/api/geo-sync/providers?${params}`, {
        signal:  controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeoutId);

      const body = await r.text();
      return new NextResponse(body, {
        status:  r.status,
        headers: {
          "Content-Type":  "application/json",
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    } catch (e: any) {
      lastError = e.message ?? String(e);
    }
  }

  return NextResponse.json(
    { ok: false, error: `VPS unreachable: ${lastError}`, data: { providers: [], count: 0 } },
    { status: 503 }
  );
}