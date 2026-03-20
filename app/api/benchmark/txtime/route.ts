// app/api/benchmark/txtime/route.ts — v5
// FIX: bufferToBlob() dùng Uint8Array.from() tránh SharedArrayBuffer/BlobPart error

import { NextResponse } from "next/server";

// Node.js runtime
export const runtime = "edge"; // BỎ

function bufferToBlob(buf: Buffer): Blob {
  return new Blob([Uint8Array.from(buf)]);
}

export async function GET() {
  const address = process.env.SHELBY_WALLET_ADDRESS;
  const privKey = process.env.SHELBY_PRIVATE_KEY;

  if (!address) return NextResponse.json({ error: "SHELBY_WALLET_ADDRESS not configured" }, { status: 500 });
  if (!privKey)  return NextResponse.json({ error: "SHELBY_PRIVATE_KEY not configured" }, { status: 500 });

  const payload  = Buffer.alloc(512, 42);
  const ts       = Date.now();
  const rnd      = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  const blobName = `bench/tx/${ts}-${rnd}`;
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
      expirationMicros: (Date.now() + 1000 * 60 * 60 * 24) * 1000,
    });

    const submitTime = performance.now() - t0;
    const txHash     = result?.transaction?.hash ?? null;

    let confirmTime = submitTime;
    if (txHash) {
      const APTOS_NODE = "https://api.shelbynet.shelby.xyz/v1";
      const tc = performance.now();
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const r = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`,
            { signal: AbortSignal.timeout(3_000) });
          if (r.ok) {
            const d = await r.json();
            if (d?.success === true || d?.vm_status === "Executed successfully") {
              confirmTime = submitTime + (performance.now() - tc);
              break;
            }
          }
        } catch {}
      }
    }

    return NextResponse.json({ submitTime, confirmTime, txHash });

  } catch (err: any) {
    console.error("[txtime] SDK error:", err?.message);
  }

  // ── REST PUT fallback ─────────────────────────────────────────────────────
  const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";
  const APTOS_NODE = "https://api.shelbynet.shelby.xyz/v1";

  try {
    const headers: Record<string, string> = {
      "Content-Type":   "application/octet-stream",
      "Content-Length": String(payload.length),
    };
    if (process.env.SHELBY_API_KEY) headers["Authorization"] = `Bearer ${process.env.SHELBY_API_KEY}`;

    const r = await fetch(
      `${SHELBY_RPC}/v1/blobs/${address}/${encodeURIComponent(blobName)}`,
      {
        method: "PUT",
        headers,
        body:   bufferToBlob(payload),  // FIX: Uint8Array.from → no SharedArrayBuffer
        signal: AbortSignal.timeout(30_000),
      }
    );

    const submitTime = performance.now() - t0;
    let txHash: string | null = null;
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      txHash = d?.transaction_hash ?? d?.txHash ?? null;
    }

    let confirmTime = submitTime;
    if (txHash) {
      const tc = performance.now();
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const cr = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`,
            { signal: AbortSignal.timeout(3_000) });
          if (cr.ok) {
            const d = await cr.json();
            if (d?.success === true || d?.vm_status === "Executed successfully") {
              confirmTime = submitTime + (performance.now() - tc);
              break;
            }
          }
        } catch {}
      }
    }

    return NextResponse.json({ submitTime, confirmTime, txHash });

  } catch (restErr: any) {
    return NextResponse.json(
      { error: `TX timing failed: ${restErr?.message?.slice(0, 200)}` },
      { status: 500 }
    );
  }
}