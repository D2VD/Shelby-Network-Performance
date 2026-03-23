// app/api/analytics/calibrate/route.ts
// POST — Trigger avgBlobSizeBytes recalibration sau mỗi shelbynet wipe.
//
// Logic: Lấy sample blob sizes từ indexer current_table_items,
//        tính median (chống outlier), save vào KV dưới key "calibration:avgBlobSize".
//        Worker /stats sẽ đọc key này thay vì hardcode 301_333.
//
// Bảo vệ bằng SYNC_SECRET (cùng secret với Worker /sync và /count).
//
// curl -X POST "https://<your-domain>/api/analytics/calibrate?secret=<SYNC_SECRET>&network=shelbynet"

import { NextRequest, NextResponse } from "next/server";

export const runtime   = "edge";
// Không cache — đây là write operation
export const dynamic   = "force-dynamic";

const WORKER_URL =
  process.env.SHELBY_WORKER_URL ??
  "https://shelby-geo-sync.doanvandanh20000.workers.dev";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret  = searchParams.get("secret") ?? "";
  const network = searchParams.get("network") ?? "shelbynet";

  // Auth check
  const syncSecret = process.env.SYNC_SECRET;
  if (syncSecret && secret !== syncSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Delegate sang Worker (có KV access)
  try {
    const res = await fetch(
      `${WORKER_URL}/calibrate?network=${network}&secret=${secret}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json" },
      }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
