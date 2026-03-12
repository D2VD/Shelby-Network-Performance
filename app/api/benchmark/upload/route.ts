import { NextRequest, NextResponse } from "next/server";
import { getShelbyClient, getShelbyAccount } from "@/lib/shelby";

const TEST_SIZES = [1_024, 10_240, 102_400];

function generatePayload(bytes: number): Uint8Array {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 13) % 256;
  return buf;
}

export async function POST(req: NextRequest) {
  const { sizeIndex = 0 } = await req.json().catch(() => ({}));
  const bytes = TEST_SIZES[sizeIndex] ?? TEST_SIZES[0];

  let client: any, account: any;
  try {
    client  = getShelbyClient();
    account = getShelbyAccount();
  } catch (err: any) {
    return NextResponse.json({ error: `Init failed: ${err.message}` }, { status: 500 });
  }

  const blobData = generatePayload(bytes);

  // blobName: simple string, no slash at end, max 1024 chars
  const blobName = `bench-${bytes}-${Date.now()}`;

  // expirationMicros must be BigInt to avoid JS integer overflow
  // Date.now() is ms, microseconds = ms * 1000
  // Add 2 hours (2 * 60 * 60 * 1e6 microseconds)
  const nowMicros = BigInt(Date.now()) * 1000n;
  const twoHoursMicros = 2n * 60n * 60n * 1_000_000n;
  const expirationMicros = nowMicros + twoHoursMicros;

  const t0 = performance.now();
  try {
    await client.upload({
      blobData,
      signer: account,
      blobName,
      expirationMicros,
    });

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    return NextResponse.json({
      bytes,
      elapsed,
      speedKbs,
      blobName,
      txHash: null, // upload() returns void per SDK type
      status: "uploaded",
      blobSize: bytes,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }
}