import { NextRequest, NextResponse } from "next/server";
import { getShelbyClient, getShelbyAccount } from "@/lib/shelby";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { blobName } = await req.json();
  if (!blobName) {
    return NextResponse.json({ error: "blobName required" }, { status: 400 });
  }

  const client = getShelbyClient();
  const account = getShelbyAccount();

  const t0 = performance.now();
  try {
    // Trả lại tên hàm đúng: download
    const blob = await client.download({
      account: account.accountAddress,
      blobName,
    });
    
    const elapsed = performance.now() - t0;
    const raw = (blob as any)?.data ?? (blob as any)?.content ?? (blob as any)?.blob ?? blob;
    
    // Xử lý đếm byte an toàn cho cả Buffer, Uint8Array và Blob
    const bytes = raw instanceof Uint8Array ? raw.byteLength
      : Buffer.isBuffer(raw) ? raw.byteLength
      : typeof raw === "string" ? raw.length
      : raw instanceof Blob ? raw.size
      : 0;
      
    const speedKbs = bytes > 0 ? (bytes / 1024) / (elapsed / 1000) : 0;

    return NextResponse.json({ bytes, elapsed, speedKbs, blobName });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Download failed" },
      { status: 500 }
    );
  }
}