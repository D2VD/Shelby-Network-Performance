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

  const blobData         = generatePayload(bytes);
  const blobName         = `bench-${bytes}-${Date.now()}`;
  const expirationMicros = (Date.now() + 2 * 60 * 60 * 1000) * 1000;

  const t0 = performance.now();
  try {
    let result: any;
    const errors: string[] = [];

    // Try 1: full args with blobName
    try {
      result = await client.upload({ blobData, signer: account, blobName, expirationMicros });
    } catch (e1: any) {
      errors.push(`v1: ${e1.message}`);
      // Try 2: with 'name' key instead of 'blobName'
      try {
        result = await client.upload({ blobData, signer: account, name: blobName, expirationMicros });
      } catch (e2: any) {
        errors.push(`v2: ${e2.message}`);
        // Try 3: minimal args
        try {
          result = await client.upload({ blobData, signer: account, expirationMicros });
        } catch (e3: any) {
          errors.push(`v3: ${e3.message}`);
          throw new Error(`All upload attempts failed:\n${errors.join("\n")}`);
        }
      }
    }

    const elapsed  = performance.now() - t0;
    const speedKbs = (bytes / 1024) / (elapsed / 1000);

    const txHash = result?.transaction?.hash ?? result?.txHash ?? result?.hash ?? result?.tx_hash ?? null;
    const actualBlobName = result?.blobName ?? result?.name ?? result?.blob_name ?? blobName;
    const blobId   = result?.blobId   ?? result?.blob_id   ?? result?.id   ?? null;
    const blobSize = result?.size      ?? result?.blobSize  ?? bytes;
    const status   = result?.status   ?? "uploaded";

    return NextResponse.json({
      bytes, elapsed, speedKbs,
      blobName: actualBlobName,
      blobId, txHash, status,
      blobSize,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }
}