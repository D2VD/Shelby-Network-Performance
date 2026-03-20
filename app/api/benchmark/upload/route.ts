// app/api/benchmark/upload/route.ts — v7 FINAL
// ✅ edge runtime
// FIX ts(2345): Uint8Array<ArrayBufferLike> not BodyInit
//   → Dùng ReadableStream wrap — edge runtime luôn chấp nhận ReadableStream là body

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";
const TEST_SIZES = [1_024, 10_240, 102_400];

function generatePayload(bytes: number): Uint8Array {
  // Không dùng Buffer (Node.js only) — dùng Uint8Array thuần cho edge
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

function uniqueBlobName(bytes: number): string {
  const ts  = Date.now();
  const rnd = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `bench/${bytes}/${ts}-${rnd}`;
}

/** Wrap Uint8Array thành ReadableStream<Uint8Array> — luôn là BodyInit hợp lệ trên edge */
function toReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

export async function POST(req: NextRequest) {
  const { sizeIndex = 0 } = await req.json().catch(() => ({}));
  const bytes   = TEST_SIZES[sizeIndex] ?? TEST_SIZES[0];
  const address = process.env.SHELBY_WALLET_ADDRESS;

  if (!address) {
    return NextResponse.json({ error: "SHELBY_WALLET_ADDRESS not configured" }, { status: 500 });
  }

  const payload  = generatePayload(bytes);
  const blobName = uniqueBlobName(bytes);
  const t0       = performance.now();

  const url = `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`;

  const headers: Record<string, string> = {
    "Content-Type":   "application/octet-stream",
    "Content-Length": String(payload.length),
  };
  if (process.env.SHELBY_API_KEY) headers["Authorization"] = `Bearer ${process.env.SHELBY_API_KEY}`;

  try {
    const r = await fetch(url, {
      method:  "PUT",
      headers,
      // FIX: ReadableStream<Uint8Array> là BodyInit hợp lệ trên cả edge lẫn Node.js
      body:    toReadableStream(payload),
      signal:  AbortSignal.timeout(45_000),
      // Cần duplex cho streaming body trên fetch
      ...(({ duplex: "half" }) as any),
    });

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    if (r.ok) {
      const data = await r.json().catch(() => ({})) as any;
      return NextResponse.json({
        bytes, elapsed, speedKbs, blobName,
        txHash: data?.transaction_hash ?? data?.txHash ?? null,
        status: "uploaded", blobSize: bytes,
      });
    }

    // Blob có thể đã commit — poll verify
    const errText = await r.text().catch(() => `HTTP ${r.status}`);
    const checkUrl = `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`;
    for (let i = 0; i < 5; i++) {
      await new Promise(res => setTimeout(res, 3_000));
      try {
        const check = await fetch(checkUrl, { signal: AbortSignal.timeout(4_000) });
        if (check.ok) {
          const d      = await check.json().catch(() => ({})) as any;
          const elapsed2 = performance.now() - t0;
          return NextResponse.json({
            bytes, elapsed: elapsed2,
            speedKbs: (bytes / 1024) / (elapsed2 / 1000),
            blobName, txHash: d?.transaction_hash ?? d?.txHash ?? null,
            status: "recovered", blobSize: bytes,
          });
        }
      } catch {}
    }

    return NextResponse.json(
      { error: `Upload failed (${r.status}): ${errText.slice(0, 200)}` },
      { status: 500 }
    );

  } catch (err: any) {
    return NextResponse.json(
      { error: `Upload error: ${err.message?.slice(0, 200)}` },
      { status: 500 }
    );
  }
}