// app/api/benchmark/upload/route.ts — v5
// FIX ts(2345): Buffer<ArrayBufferLike> not assignable to BlobPart
// Solution: Uint8Array.from(payload) — luôn có ArrayBuffer thuần, không SharedArrayBuffer

import { NextRequest, NextResponse } from "next/server";

// Node.js runtime — SDK + WASM
// export const runtime = "edge"; // BỎ

const TEST_SIZES = [1_024, 10_240, 102_400];

function generatePayload(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

function uniqueBlobName(bytes: number): string {
  const ts  = Date.now();
  const rnd = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `bench/${bytes}/${ts}-${rnd}`;
}

/** Chuyển Buffer sang Blob an toàn, tránh SharedArrayBuffer issue */
function bufferToBlob(buf: Buffer): Blob {
  // Uint8Array.from() tạo Uint8Array mới với ArrayBuffer thuần (không SharedArrayBuffer)
  return new Blob([Uint8Array.from(buf)]);
}

export async function POST(req: NextRequest) {
  const { sizeIndex = 0 } = await req.json().catch(() => ({}));
  const bytes   = TEST_SIZES[sizeIndex] ?? TEST_SIZES[0];
  const address = process.env.SHELBY_WALLET_ADDRESS;
  const privKey = process.env.SHELBY_PRIVATE_KEY;

  if (!address) return NextResponse.json({ error: "SHELBY_WALLET_ADDRESS not configured" }, { status: 500 });
  if (!privKey)  return NextResponse.json({ error: "SHELBY_PRIVATE_KEY not configured" }, { status: 500 });

  const payload  = generatePayload(bytes);
  const blobName = uniqueBlobName(bytes);
  const t0       = performance.now();

  // ── SDK path ───────────────────────────────────────────────────────────────
  try {
    const { ShelbyNodeClient }                    = await import("@shelby-protocol/sdk/node");
    const { Account, Ed25519PrivateKey, Network } = await import("@aptos-labs/ts-sdk");

    const hex    = privKey.replace(/^ed25519-priv-/, "");
    const signer = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(hex) });

    const shelbyNetwork = (Network as any).SHELBYNET ?? ("shelbynet" as any);
    const client = new ShelbyNodeClient({
      network: shelbyNetwork,
      ...(process.env.SHELBY_API_KEY ? { apiKey: process.env.SHELBY_API_KEY } : {}),
    });

    const result: any = await (client as any).upload({
      signer,
      blobData: payload,
      blobName,
      expirationMicros: (Date.now() + 1000 * 60 * 60 * 24 * 7) * 1000,
    });

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    return NextResponse.json({
      bytes, elapsed, speedKbs, blobName,
      txHash: result?.transaction?.hash ?? null,
      status: "uploaded",
      blobSize: bytes,
    });

  } catch (sdkErr: any) {
    console.error("[upload] SDK error:", sdkErr?.message);
  }

  // ── REST PUT fallback ─────────────────────────────────────────────────────
  const url = `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${address}/${encodeURIComponent(blobName)}`;
  try {
    const headers: Record<string, string> = {
      "Content-Type":   "application/octet-stream",
      "Content-Length": String(payload.length),
    };
    if (process.env.SHELBY_API_KEY) headers["Authorization"] = `Bearer ${process.env.SHELBY_API_KEY}`;

    const r = await fetch(url, {
      method: "PUT",
      headers,
      // FIX: Uint8Array.from(payload) → ArrayBuffer thuần → BlobPart OK
      body:   bufferToBlob(payload),
      signal: AbortSignal.timeout(45_000),
    });

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      return NextResponse.json({
        bytes, elapsed, speedKbs, blobName,
        txHash: data?.transaction_hash ?? data?.txHash ?? null,
        status: "uploaded-rest",
      });
    }

    const errText = await r.text().catch(() => `HTTP ${r.status}`);
    return NextResponse.json({ error: `REST PUT failed: ${errText.slice(0, 200)}` }, { status: 500 });

  } catch (restErr: any) {
    return NextResponse.json(
      { error: `Upload failed: ${restErr?.message?.slice(0, 200)}` },
      { status: 500 }
    );
  }
}