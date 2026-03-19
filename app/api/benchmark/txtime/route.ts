// app/api/benchmark/txtime/route.ts
import { NextResponse } from "next/server";
import { getShelbyClient, getShelbyAccount, getAptosClient } from "@/lib/shelby";

export const runtime = "nodejs";

export async function GET() {
  const aptos = getAptosClient();
  const account = getShelbyAccount();
  const client = getShelbyClient();

  const rawData = new Uint8Array(512).fill(42);
  const blobData = Buffer.from(rawData);
  const blobName = `bench/tx-timing-${Date.now()}.bin`;
  const address = account.accountAddress.toString();
  
  // SỬA LỖI TYPESCRIPT Ở ĐÂY: Sử dụng Number thay vì BigInt
  // Date.now() trả về mili-giây. Cộng thêm 1 giờ (60*60*1000 ms), sau đó nhân 1000 để ra micro-giây.
  const expirationMicros = (Date.now() + 60 * 60 * 1000) * 1000;

  const t0 = performance.now();
  let isSuccess = false;
  let txHash = null;
  let submitTime = 0;

  try {
    const result = await client.upload({
      blobData,
      signer: account,
      blobName,
      expirationMicros, // Đã truyền đúng kiểu 'number'
    }) as any;
    
    submitTime = performance.now() - t0;
    txHash = result?.transaction?.hash ?? result?.txHash ?? result?.hash ?? null;
    isSuccess = true;
  } catch (err: any) {
    // CƠ CHẾ RECOVERY (Polling)
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        const checkUrl = `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${address}/${blobName}`;
        const res = await fetch(checkUrl, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          txHash = data?.transaction_hash ?? data?.txHash ?? null;
          submitTime = performance.now() - t0;
          isSuccess = true;
          break;
        }
      } catch (e) {}
    }

    if (!isSuccess) {
      return NextResponse.json({ error: `TX failed and not found on-chain: ${err.message}` }, { status: 500 });
    }
  }

  // Check on-chain confirmation (Finality)
  let confirmTime = submitTime;
  if (txHash) {
    const tc = performance.now();
    try {
      await aptos.waitForTransaction({ transactionHash: txHash });
      confirmTime = submitTime + (performance.now() - tc);
    } catch {}
  }

  return NextResponse.json({ submitTime, confirmTime, txHash });
}