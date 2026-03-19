// app/api/benchmark/txtime/route.ts
// ✅ Edge runtime — gọi Shelby RPC HTTP + Aptos REST thay vì SDK
import { NextResponse } from "next/server";

export const runtime = "edge";

const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";
const APTOS_NODE = "https://api.shelbynet.shelby.xyz/v1";

export async function GET() {
  const address = process.env.SHELBY_WALLET_ADDRESS;
  const apiKey  = process.env.SHELBY_API_KEY;

  if (!address) {
    return NextResponse.json(
      { error: "SHELBY_WALLET_ADDRESS not configured" },
      { status: 500 }
    );
  }

  // Tạo payload nhỏ 512 bytes để đo TX time
  const blobData = new Uint8Array(512).fill(42);
  const blobName = `bench/tx-timing-${Date.now()}.bin`;
  const t0       = performance.now();

  let txHash: string | null = null;
  let submitTime             = 0;
  let isSuccess              = false;

  // Upload blob nhỏ qua Shelby RPC REST
  try {
    const headers: Record<string, string> = {
      "Content-Type":      "application/octet-stream",
      "X-Blob-Name":       blobName,
      "X-Account-Address": address,
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const r = await fetch(`${SHELBY_RPC}/v1/blobs`, {
      method:  "PUT",
      headers,
      body:    blobData,
      signal:  AbortSignal.timeout(30_000),
    });

    submitTime = performance.now() - t0;

    if (r.ok) {
      const d  = await r.json().catch(() => ({}));
      txHash   = d?.transaction_hash ?? d?.txHash ?? null;
      isSuccess = true;
    }
  } catch {}

  // Polling fallback
  if (!isSuccess) {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const checkRes = await fetch(
          `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${address}/${blobName}`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (checkRes.ok) {
          const d  = await checkRes.json();
          txHash   = d?.transaction_hash ?? d?.txHash ?? null;
          submitTime = performance.now() - t0;
          isSuccess  = true;
          break;
        }
      } catch {}
    }
  }

  if (!isSuccess) {
    return NextResponse.json(
      { error: "TX failed and blob not found on-chain after 15s" },
      { status: 500 }
    );
  }

  // Đợi xác nhận on-chain qua Aptos REST
  let confirmTime = submitTime;
  if (txHash) {
    const tc = performance.now();
    try {
      // Poll cho đến khi transaction được confirm
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        const r = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (r.ok) {
          const d = await r.json();
          if (d?.success === true || d?.vm_status === "Executed successfully") {
            confirmTime = submitTime + (performance.now() - tc);
            break;
          }
        }
      }
    } catch {}
  }

  return NextResponse.json({ submitTime, confirmTime, txHash });
}