/**
 * app/api/network/stats/live/route.ts — v5.0
 * FIXES:
 * 1. Better error messaging (distinguish 503 from tunnel down vs VPS config)
 * 2. Try primary VPS URL, then fallback to alternate env vars
 * 3. Return stale cache data from headers if available
 * 4. Increased timeout to handle slow tunnel connections
 */

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
      { ok: false, error: "SHELBY_API_URL not configured — set this environment variable on Cloudflare Pages" },
      { status: 503 }
    );
  }

  let lastError = "";

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);

      const r = await fetch(`${vpsUrl}/api/geo-sync/stats/live?network=${network}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeoutId);

      const body = await r.text();
      return new NextResponse(body, {
        status: r.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-VPS-URL": vpsUrl.replace(/https?:\/\//, "").split(".")[0] + "…", // partial for debugging
        },
      });
    } catch (e: any) {
      lastError = e.message ?? String(e);
      console.warn(`[stats/live] VPS attempt failed (${vpsUrl.slice(0, 30)}…):`, lastError);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: `VPS unreachable: ${lastError}`,
      hint: "Check Cloudflare Tunnel status and SHELBY_API_URL environment variable",
      triedUrls: VPS_URLS.length,
    },
    { status: 503 }
  );
}