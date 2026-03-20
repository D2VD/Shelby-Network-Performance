// app/api/benchmark/txtime/route.ts — v7 FINAL
// ✅ edge runtime
// FIX: dùng ReadableStream làm body thay vì Uint8Array

import { NextResponse } from "next/server";

export const runtime = "edge";

const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";
const APTOS_NODE = "https://api.shelbynet.shelby.xyz/v1";

function toReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

export async function GET() {
  const address = process.env.SHELBY_WALLET_ADDRESS;
  if (!address) {
    return NextResponse.json({ error: "SHELBY_WALLET_ADDRESS not configured" }, { status: 500 });
  }

  const payload  = new Uint8Array(512).fill(42);
  const ts       = Date.now();
  const rnd      = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  const blobName = `bench/tx/${ts}-${rnd}`;
  const t0       = performance.now();

  const headers: Record<string, string> = {
    "Content-Type":   "application/octet-stream",
    "Content-Length": String(payload.length),
  };
  if (process.env.SHELBY_API_KEY) headers["Authorization"] = `Bearer ${process.env.SHELBY_API_KEY}`;

  let txHash: string | null = null;
  let submitTime = 0;
  let isSuccess  = false;

  try {
    const r = await fetch(
      `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`,
      {
        method:  "PUT",
        headers,
        body:    toReadableStream(payload),
        signal:  AbortSignal.timeout(30_000),
        ...(({ duplex: "half" }) as any),
      }
    );
    submitTime = performance.now() - t0;
    if (r.ok) {
      const d = await r.json().catch(() => ({})) as any;
      txHash    = d?.transaction_hash ?? d?.txHash ?? null;
      isSuccess = true;
    }
  } catch {}

  if (!isSuccess) {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 3_000));
      try {
        const check = await fetch(
          `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`,
          { signal: AbortSignal.timeout(3_000) }
        );
        if (check.ok) {
          const d = await check.json().catch(() => ({})) as any;
          txHash    = d?.transaction_hash ?? d?.txHash ?? null;
          submitTime = performance.now() - t0;
          isSuccess = true;
          break;
        }
      } catch {}
    }
  }

  if (!isSuccess) {
    return NextResponse.json({ error: "TX failed — blob not found on-chain after 15s" }, { status: 500 });
  }

  let confirmTime = submitTime;
  if (txHash) {
    const tc = performance.now();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const r = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`, { signal: AbortSignal.timeout(3_000) });
        if (r.ok) {
          const d = await r.json() as any;
          if (d?.success === true || d?.vm_status === "Executed successfully") {
            confirmTime = submitTime + (performance.now() - tc);
            break;
          }
        }
      } catch {}
    }
  }

  return NextResponse.json({ submitTime, confirmTime, txHash });
}