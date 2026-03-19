// app/api/benchmark/latency/route.ts
// ✅ Edge runtime — dùng fetch() thay vì @aptos-labs/ts-sdk
import { NextResponse } from "next/server";

export const runtime = "edge";

const NODE = "https://api.shelbynet.shelby.xyz/v1";

export async function GET() {
  const rounds = 5;
  const times: number[] = [];

  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${NODE}/`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      return NextResponse.json(
        { error: "Cannot reach Shelbynet node" },
        { status: 503 }
      );
    }
    times.push(performance.now() - t0);
    // Delay giữa các round (không dùng setTimeout trong edge — dùng fetch delay)
    await new Promise(r => setTimeout(r, 150));
  }

  // Loại bỏ min và max outlier
  times.sort((a, b) => a - b);
  const trimmed = times.slice(1, 4);
  const avg     = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const min     = trimmed[0];
  const max     = trimmed[trimmed.length - 1];

  return NextResponse.json({ avg, min, max, samples: times });
}