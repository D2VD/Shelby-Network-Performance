import { NextResponse } from "next/server";
import { getAptosClient } from "@/lib/shelby";

export async function GET() {
  const aptos = getAptosClient();
  const rounds = 5;
  const times: number[] = [];

  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    try {
      await aptos.getLedgerInfo();
    } catch (e) {
      return NextResponse.json({ error: "Cannot reach Shelbynet node" }, { status: 503 });
    }
    times.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, 150));
  }

  // Remove min/max outliers
  times.sort((a, b) => a - b);
  const trimmed = times.slice(1, 4);
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const min = trimmed[0];
  const max = trimmed[trimmed.length - 1];

  return NextResponse.json({ avg, min, max, samples: times });
}
