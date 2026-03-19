// app/api/benchmark/upload/route.ts
// ✅ Edge runtime — gọi Shelby RPC HTTP API thay vì @shelby-protocol/sdk
// SDK dùng WASM + Node.js crypto không tương thích CF edge
// Thay thế: gọi trực tiếp REST API của Shelby RPC server
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";
const TEST_SIZES  = [1_024, 10_240, 102_400];

function generatePayload(bytes: number): Uint8Array {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

export async function POST(req: NextRequest) {
  const { sizeIndex = 0 } = await req.json().catch(() => ({}));
  const bytes    = TEST_SIZES[sizeIndex] ?? TEST_SIZES[0];
  const address  = process.env.SHELBY_WALLET_ADDRESS;
  const apiKey   = process.env.SHELBY_API_KEY;

  if (!address) {
    return NextResponse.json(
      { error: "SHELBY_WALLET_ADDRESS not configured" },
      { status: 500 }
    );
  }

  const payload  = generatePayload(bytes);
  const blobName = `bench-${bytes}-${Date.now()}`;
  const t0       = performance.now();

  try {
    // Gọi Shelby RPC REST API trực tiếp
    const headers: Record<string, string> = {
      "Content-Type":      "application/octet-stream",
      "X-Blob-Name":       blobName,
      "X-Account-Address": address,
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const r = await fetch(`${SHELBY_RPC}/v1/blobs`, {
      method:  "PUT",
      headers,
      body: new Blob([payload as any]),
      signal:  AbortSignal.timeout(30_000),
    });

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    if (!r.ok) {
      const errText = await r.text().catch(() => `HTTP ${r.status}`);
      return NextResponse.json(
        { error: `Shelby RPC error: ${errText}` },
        { status: 500 }
      );
    }

    const data = await r.json().catch(() => ({}));
    const txHash = data?.transaction_hash ?? data?.txHash ?? null;

    return NextResponse.json({
      bytes, elapsed, speedKbs, blobName, txHash,
      status: "uploaded", blobSize: bytes,
    });
  } catch (err: any) {
    // Polling fallback: kiểm tra blob đã tồn tại chưa
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const checkRes = await fetch(
          `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${address}/${blobName}`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (checkRes.ok) {
          const d = await checkRes.json();
          const elapsed  = performance.now() - t0;
          const speedKbs = (bytes / 1024) / (elapsed / 1000);
          return NextResponse.json({
            bytes, elapsed, speedKbs, blobName,
            txHash: d?.transaction_hash ?? null,
            status: "recovered", blobSize: bytes,
          });
        }
      } catch {}
    }
    return NextResponse.json(
      { error: `Upload failed: ${err.message}` },
      { status: 500 }
    );
  }
}