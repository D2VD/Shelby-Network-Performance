// app/api/benchmark/upload/route.ts
// FIX: Endpoint đúng PUT /shelby/v1/blobs/{account}/{blobName} (path params)
// FIX: Thêm Content-Length header
// FIX: export const runtime = "edge" (bắt buộc cho CF Pages)
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";
const TEST_SIZES = [1_024, 10_240, 102_400];

function generatePayload(bytes: number): Uint8Array {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

export async function POST(req: NextRequest) {
  const { sizeIndex = 0 } = await req.json().catch(() => ({}));
  const bytes   = TEST_SIZES[sizeIndex] ?? TEST_SIZES[0];
  const address = process.env.SHELBY_WALLET_ADDRESS;

  if (!address) {
    return NextResponse.json(
      { error: "SHELBY_WALLET_ADDRESS not set — add it in CF Dashboard → Settings → Env Vars" },
      { status: 500 }
    );
  }

  const payload  = generatePayload(bytes);
  const blobName = `bench-${bytes}-${Date.now()}`;
  const t0       = performance.now();

  // ✅ Endpoint đúng: PUT /shelby/v1/blobs/{account}/{blobName}
  const url = `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`;

  try {
    const r = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type":   "application/octet-stream",
        "Content-Length": String(payload.length),
      },
      body: new Blob([payload as any]),
      signal: AbortSignal.timeout(30_000),
    });

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    if (r.ok) {
      const data   = await r.json().catch(() => ({}));
      const txHash = data?.transaction_hash ?? data?.txHash ?? null;
      return NextResponse.json({ bytes, elapsed, speedKbs, blobName, txHash, status: "uploaded", blobSize: bytes });
    }

    const errText = await r.text().catch(() => `HTTP ${r.status}`);
    console.warn(`[upload] PUT ${r.status}: ${errText} — starting recovery poll`);
  } catch (err: any) {
    console.warn(`[upload] fetch threw: ${err.message} — starting recovery poll`);
  }

  // Recovery: blob có thể đã commit on-chain dù RPC trả lỗi
  const checkUrl = `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 3_000));
    try {
      const res = await fetch(checkUrl, { signal: AbortSignal.timeout(4_000) });
      if (res.ok) {
        const d        = await res.json();
        const elapsed  = performance.now() - t0;
        const speedKbs = (bytes / 1024) / (elapsed / 1000);
        return NextResponse.json({
          bytes, elapsed, speedKbs, blobName,
          txHash: d?.transaction_hash ?? d?.txHash ?? null,
          status: "recovered", blobSize: bytes,
        });
      }
    } catch {}
  }

  return NextResponse.json(
    { error: "Upload failed and blob not found on-chain after 15s" },
    { status: 500 }
  );
}