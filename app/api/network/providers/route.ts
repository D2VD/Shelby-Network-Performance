// app/api/network/providers/route.ts — v5.0
// Better error handling, multiple VPS URL fallback, longer timeout for provider metadata

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

export async function GET(req: NextRequest) {
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";
  const noTcp   = req.nextUrl.searchParams.get("no_tcp") ?? "";

  if (VPS_URLS.length === 0) {
    return NextResponse.json(
      { ok: false, error: "SHELBY_API_URL not configured", data: { providers: [], count: 0 } },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({ network });
  if (noTcp) params.set("no_tcp", noTcp);

  let lastError = "";

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      // Providers can take longer — SP metadata lookup in batches
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      const r = await fetch(`${vpsUrl}/api/geo-sync/providers?${params}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeoutId);

      const body = await r.text();
      return new NextResponse(body, {
        status: r.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    } catch (e: any) {
      lastError = e.message ?? String(e);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: `VPS unreachable: ${lastError}`,
      data: { providers: [], count: 0 },
    },
    { status: 503 }
  );
}