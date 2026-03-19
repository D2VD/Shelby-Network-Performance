// app/api/benchmark/faucet/route.ts
// FIX: export const runtime = "edge"
// FIX: Dùng SHELBY_WALLET_ADDRESS thay vì derive từ private key
// FIX: Đúng faucet endpoint shelbynet
import { NextResponse } from "next/server";

export const runtime = "edge";

// Shelbynet faucet (từ docs.shelby.xyz)
const FAUCET_APT      = "https://faucet.shelbynet.shelby.xyz/mint";
const FAUCET_SHELBYUSD = "https://faucet.shelbynet.shelby.xyz/mint";
const APTOS_NODE      = "https://api.shelbynet.shelby.xyz/v1";

async function tryFaucet(url: string, retries = 3): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) return true;
    } catch {}
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1_500));
  }
  return false;
}

export async function POST() {
  const address = process.env.SHELBY_WALLET_ADDRESS;
  if (!address) {
    return NextResponse.json(
      { error: "SHELBY_WALLET_ADDRESS not configured" },
      { status: 500 }
    );
  }

  const [aptOk, usdOk] = await Promise.all([
    tryFaucet(`${FAUCET_APT}?address=${address}&amount=100000000`),
    tryFaucet(`${FAUCET_SHELBYUSD}?address=${address}&amount=10000000&token=shelbyusd`),
  ]);

  // Đợi blockchain confirm
  await new Promise(r => setTimeout(r, 3_000));

  let newApt = 0;
  try {
    const r = await fetch(
      `${APTOS_NODE}/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`
    );
    if (r.ok) { const d = await r.json(); newApt = Number(d?.data?.coin?.value ?? 0) / 1e8; }
  } catch {}

  return NextResponse.json({
    address,
    aptFauceted: aptOk,
    shelbyusdFauceted: usdOk,
    newApt,
    message: (aptOk || usdOk) ? "Faucet OK" : "Faucet failed — shelbynet faucet may be down",
  });
}