import { NextRequest, NextResponse } from "next/server";
import { getShelbyClient, getShelbyAccount } from "@/lib/shelby";

const TEST_SIZES =[1_024, 10_240, 102_400];

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

  const rawData = generatePayload(bytes);
  const blobData = Buffer.from(rawData);
  const blobName = `bench-${bytes}-${Date.now()}`;
  const address = account.accountAddress.toString();
  
  // Expiration: 2 hours
  const nowMicros = BigInt(Date.now()) * 1000n;
  const twoHoursMicros = 2n * 60n * 60n * 1_000_000n;
  const expirationMicros = nowMicros + twoHoursMicros;

  const t0 = performance.now();
  let isSuccess = false;
  let txHash = null;
  let status = "uploaded";

  try {
    const result = await client.upload({
      blobData,
      signer: account,
      blobName,
      expirationMicros,
    });
    txHash = result?.transaction?.hash ?? result?.txHash ?? null;
    isSuccess = true;
  } catch (err: any) {
    // CƠ CHẾ RECOVERY: Bỏ qua lỗi 500 của RPC, chủ động kiểm tra trên mạng lưới
    console.log(`[Upload] RPC error for ${blobName}, starting polling recovery...`);
    
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Đợi 3 giây mỗi lần
      try {
        // Gọi trực tiếp API của Shelby Explorer để check xem Blob đã tồn tại chưa
        const checkUrl = `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${address}/${blobName}`;
        const res = await fetch(checkUrl, { signal: AbortSignal.timeout(3000) });
        
        if (res.ok) {
          const data = await res.json();
          // Nếu tìm thấy, lấy txHash từ metadata và đánh dấu thành công
          txHash = data?.transaction_hash ?? data?.txHash ?? null;
          isSuccess = true;
          status = "recovered"; // Đánh dấu là thành công nhờ recovery
          console.log(`[Upload] Recovered ${blobName} successfully!`);
          break;
        }
      } catch (e) {
        // Bỏ qua lỗi fetch, tiếp tục vòng lặp
      }
    }

    // Nếu sau 15s (5 lần x 3s) vẫn không thấy Blob, lúc này mới thực sự báo lỗi
    if (!isSuccess) {
      return NextResponse.json({ 
        error: `Upload failed and blob not found on-chain after 15s. Original error: ${err.message}` 
      }, { status: 500 });
    }
  }

  const elapsed  = performance.now() - t0;
  const speedKbs = (bytes / 1024) / (elapsed / 1000);

  return NextResponse.json({
    bytes,
    elapsed,
    speedKbs,
    blobName,
    txHash,
    status,
    blobSize: bytes,
  });
}