import { NextResponse } from "next/server";
import { getShelbyClient, getShelbyAccount, getAptosClient } from "@/lib/shelby";

export async function GET() {
  const aptos = getAptosClient();
  const account = getShelbyAccount();
  const client = getShelbyClient();

  // Upload tiny 512-byte blob and measure full round-trip time
  const blobData = new Uint8Array(512).fill(42);
  const blobName = `bench/tx-timing-${Date.now()}.bin`;
  const expirationMicros = (Date.now() + 60 * 60 * 1000) * 1000; // 1h

  const t0 = performance.now();
  try {
    const result = await client.upload({
      blobData,
      signer: account,
      blobName,
      expirationMicros,
    }) as any;
    const submitTime = performance.now() - t0;

    // Check on-chain confirmation
    let confirmTime = submitTime;
    const txHash = result?.transaction?.hash ?? result?.txHash ?? result?.hash ?? null;
    if (txHash) {
      const tc = performance.now();
      try {
        await aptos.waitForTransaction({ transactionHash: txHash });
        confirmTime = performance.now() - tc;
      } catch {}
    }

    return NextResponse.json({ submitTime, confirmTime, txHash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}