// app/api/analytics/snapshots/route.ts
// Proxy R2 snapshot data cho analytics charts.
//
// FIX (P0): CF Pages Functions expose R2 bindings thông qua request context,
// KHÔNG phải process.env. Dùng @cloudflare/next-on-pages getRequestContext().
// Fallback: gọi Worker /snapshots endpoint nếu binding không available.

import { NextRequest, NextResponse } from "next/server";

export const runtime    = "edge";
export const revalidate = 300; // 5 phút

const WORKER_URL =
  process.env.SHELBY_WORKER_URL ??
  "https://shelby-geo-sync.doanvandanh20000.workers.dev";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? "shelbynet";
  const limit   = Math.min(168, Number(searchParams.get("limit") ?? "24"));

  // ── Strategy 1: CF Pages R2 binding via getRequestContext ────────────────
  try {
    // @cloudflare/next-on-pages inject getRequestContext() vào global scope
    // khi chạy trên CF Pages. Nếu không có (local dev / Vercel) thì throw.
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const ctx = getRequestContext();
    const r2  = (ctx.env as any).SHELBY_R2 as R2Bucket | undefined;

    if (r2) {
      const prefix = `snapshots/${network}/`;
      const list   = await r2.list({ prefix, limit: limit + 5 });

      const keys = list.objects
        .map((o) => o.key as string)
        .sort((a, b) => b.localeCompare(a))
        .slice(0, limit);

      const snapshots = (
        await Promise.all(
          keys.map(async (key) => {
            const obj = await r2.get(key);
            if (!obj) return null;
            return JSON.parse(await (obj as any).text());
          })
        )
      )
        .filter(Boolean)
        .sort(
          (a: any, b: any) =>
            new Date(a.ts).getTime() - new Date(b.ts).getTime()
        );

      return NextResponse.json({
        ok:        true,
        network,
        source:    "r2-binding",
        data:      { snapshots, count: snapshots.length },
        fetchedAt: new Date().toISOString(),
      });
    }
  } catch {
    // getRequestContext không available (local dev / Vercel) — fall through
  }

  // ── Strategy 2: Worker /snapshots endpoint ────────────────────────────────
  try {
    const res = await fetch(
      `${WORKER_URL}/snapshots?network=${network}&limit=${limit}`,
      {
        signal:  AbortSignal.timeout(10_000),
        headers: { Accept: "application/json" },
      }
    );

    if (res.ok) {
      const data = await res.json() as any;
      // Tag source để client biết từ đâu
      if (data?.data) data.source = "worker-proxy";
      return NextResponse.json(data, {
        headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
      });
    }

    return NextResponse.json(
      {
        ok:    false,
        error: `Worker responded with HTTP ${res.status}`,
        data:  { snapshots: [], count: 0 },
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok:    false,
        error: err.message,
        data:  { snapshots: [], count: 0 },
        hint:  "Deploy Worker and set SHELBY_WORKER_URL env var",
      },
      { status: 200 }
    );
  }
}
