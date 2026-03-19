// app/api/benchmark/download/route.ts
// ✅ Edge runtime — gọi Shelby RPC HTTP API thay vì @shelby-protocol/sdk
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";

export async function POST(req: NextRequest) {
  const { blobName } = await req.json();
  if (!blobName) {
    return NextResponse.json({ error: "blobName required" }, { status: 400 });
  }

  const address = process.env.SHELBY_WALLET_ADDRESS;
  const apiKey  = process.env.SHELBY_API_KEY;

  if (!address) {
    return NextResponse.json(
      { error: "SHELBY_WALLET_ADDRESS not configured" },
      { status: 500 }
    );
  }

  const t0 = performance.now();
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const r = await fetch(
      `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`,
      { headers, signal: AbortSignal.timeout(30_000) }
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => `HTTP ${r.status}`);
      return NextResponse.json(
        { error: `Download failed: ${errText}` },
        { status: 500 }
      );
    }

    const blob     = await r.arrayBuffer();
    const elapsed  = performance.now() - t0;
    const bytes    = blob.byteLength;
    const speedKbs = bytes > 0 ? (bytes / 1024) / (elapsed / 1000) : 0;

    return NextResponse.json({ bytes, elapsed, speedKbs, blobName });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Download failed" },
      { status: 500 }
    );
  }
}