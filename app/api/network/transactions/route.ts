// app/api/network/transactions/route.ts — v1.0
// Edge proxy: forwards wallet address transaction queries to VPS.
// Used by Explorer page AddressView "Transactions" tab.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [
  process.env.SHELBY_API_URL,
  process.env.SHELBY_WORKER_URL,
  process.env.SHELBY_BENCHMARK_WORKER_URL,
].filter(Boolean) as string[];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const address = searchParams.get("address") ?? "";
  const network = searchParams.get("network") ?? "shelbynet";
  const limit   = searchParams.get("limit")   ?? "25";
  const offset  = searchParams.get("offset")  ?? "0";

  // Basic validation — address must look like a hex address
  const clean = address.trim().toLowerCase();
  if (!clean || !/^(0x)?[0-9a-f]{1,64}$/.test(clean)) {
    return NextResponse.json(
      { ok: false, error: "Invalid address", data: { transactions: [] } },
      { status: 400 }
    );
  }

  if (VPS_URLS.length === 0) {
    return NextResponse.json(
      { ok: false, error: "SHELBY_API_URL not configured", data: { transactions: [] } },
      { status: 503 }
    );
  }

  const qs = new URLSearchParams({ address: clean, network, limit, offset }).toString();
  let lastError = "";

  for (const vpsUrl of VPS_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18_000);

      const r = await fetch(`${vpsUrl}/api/geo-sync/transactions?${qs}`, {
        signal:  controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timer);

      const body = await r.text();
      return new NextResponse(body, {
        status:  r.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(
    { ok: false, error: `VPS unreachable: ${lastError}`, data: { transactions: [] } },
    { status: 503 }
  );
}