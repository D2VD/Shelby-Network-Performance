// app/api/benchmark/balance/route.ts
// ✅ Edge runtime — không dùng @aptos-labs/ts-sdk
// Địa chỉ ví đọc từ SHELBY_WALLET_ADDRESS (env var, không phải private key)
import { NextResponse } from "next/server";

export const runtime = "edge";

const NODE          = "https://api.shelbynet.shelby.xyz/v1";
const SHELBYUSD_META = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";

async function getAptBalance(address: string): Promise<number> {
  try {
    const r = await fetch(`${NODE}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: "0x1::coin::balance",
        type_arguments: ["0x1::aptos_coin::AptosCoin"],
        arguments: [address],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const d = await r.json();
      const v = Number(Array.isArray(d) ? d[0] : d);
      if (!isNaN(v) && v >= 0) return v / 1e8;
    }
  } catch {}
  try {
    const r = await fetch(
      `${NODE}/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const d = await r.json();
      return Number(d?.data?.coin?.value ?? 0) / 1e8;
    }
  } catch {}
  return 0;
}

async function getShelbyUSDBalance(address: string): Promise<number> {
  try {
    const r = await fetch(`${NODE}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: "0x1::primary_fungible_store::balance",
        type_arguments: ["0x1::fungible_asset::Metadata"],
        arguments: [address, SHELBYUSD_META],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const d = await r.json();
      const v = Number(Array.isArray(d) ? d[0] : d);
      if (!isNaN(v) && v >= 0) return v / 1e8;
    }
  } catch {}
  try {
    const r = await fetch(`${NODE}/accounts/${address}/resources?limit=100`, {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const resources: any[] = await r.json();
      for (const res of resources) {
        const d    = res.data ?? {};
        const meta = d?.metadata?.inner ?? d?.metadata ?? "";
        if (typeof meta === "string" && meta.toLowerCase() === SHELBYUSD_META.toLowerCase()) {
          const bal = d?.balance ?? d?.amount ?? d?.value;
          if (bal !== undefined) return Number(bal) / 1e8;
        }
      }
    }
  } catch {}
  return 0;
}

export async function GET() {
  // Đọc địa chỉ ví từ env var SHELBY_WALLET_ADDRESS
  // (set trong CF Dashboard → Pages → Settings → Env Vars)
  const address = process.env.SHELBY_WALLET_ADDRESS;
  if (!address) {
    return NextResponse.json(
      { error: "SHELBY_WALLET_ADDRESS not configured in environment variables" },
      { status: 500 }
    );
  }

  const [apt1, shelbyusd1] = await Promise.all([
    getAptBalance(address),
    getShelbyUSDBalance(address),
  ]);

  let apt = apt1, shelbyusd = shelbyusd1;
  if (apt === 0 || shelbyusd === 0) {
    await new Promise(r => setTimeout(r, 500));
    const [apt2, usd2] = await Promise.all([
      apt      === 0 ? getAptBalance(address)        : Promise.resolve(apt),
      shelbyusd === 0 ? getShelbyUSDBalance(address) : Promise.resolve(shelbyusd),
    ]);
    apt = apt2; shelbyusd = usd2;
  }

  return NextResponse.json({
    address,
    apt,
    shelbyusd,
    ready: apt >= 0.1 && shelbyusd >= 0.001,
  });
}