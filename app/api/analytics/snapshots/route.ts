// app/api/analytics/snapshots/route.ts
// Proxy R2 snapshot data cho analytics charts
// Worker trực tiếp expose /snapshots endpoint tốt hơn,
// nhưng route này là fallback khi frontend gọi qua Next.js API.

import { NextRequest, NextResponse } from "next/server";

export const runtime    = "edge";
export const revalidate = 300; // 5 phút

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? "shelbynet";
  const limit   = Math.min(168, Number(searchParams.get("limit") ?? "24"));

  try {
    // Đọc trực tiếp từ Cloudflare R2 qua binding (chỉ hoạt động trên CF edge)
    // Không dùng R2Bucket type ở đây vì file này chạy trong Next.js context
    // (không có @cloudflare/workers-types). Dùng any để tránh ts(2304)
    const r2 = (process.env as any).SHELBY_R2 as any | undefined;

    if (!r2) {
      // Fallback khi chạy local / Vercel: trả empty nhưng không crash
      return NextResponse.json({
        ok: false,
        error: "R2 not available in this environment",
        data: { snapshots: [], count: 0 },
        hint: "Deploy to Cloudflare Pages for R2 snapshot access",
      });
    }

    const prefix = `snapshots/${network}/`;
    const list   = await r2.list({ prefix, limit: limit + 5 });

    const keys = list.objects
      .map((o: any) => o.key as string)
      .sort((a: string, b: string) => b.localeCompare(a))
      .slice(0, limit);

    const snapshots = await Promise.all(
      keys.map(async (key: string) => {
        const obj = await r2.get(key);
        if (!obj) return null;
        const text = await (obj as any).text();
        return JSON.parse(text);
      })
    );

    const data = snapshots
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    return NextResponse.json({
      ok: true,
      network,
      data: { snapshots: data, count: data.length },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message,
      data: { snapshots: [], count: 0 },
    }, { status: 500 });
  }
}