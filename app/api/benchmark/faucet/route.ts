// app/api/benchmark/faucet/route.ts
// ✅ Edge runtime — không dùng @aptos-labs/ts-sdk
// Dùng SHELBY_WALLET_ADDRESS env var thay vì derive từ private key
import { NextResponse } from "next/server";

export const runtime = "edge";

const FAUCET_URL = "https://faucet.shelbynet.shelby.xyz";
const APTOS_NODE = "https://api.shelbynet.shelby.xyz/v1";

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
      if (res.ok) return res;
    } catch {}
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`Faucet failed after ${retries} attempts`);
}

export async function POST() {
  const address = process.env.SHELBY_WALLET_ADDRESS;
  if (!address) {
    return NextResponse.json(
      { error: "SHELBY_WALLET_ADDRESS not configured" },
      { status: 500 }
    );
  }

  const results = { apt: false, shelbyusd: false, errors: [] as string[] };

  try {
    await fetchWithRetry(`${FAUCET_URL}/mint?address=${address}&amount=100000000`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    results.apt = true;
  } catch (e: any) { results.errors.push(`APT faucet failed: ${e.message}`); }

  try {
    await fetchWithRetry(`${FAUCET_URL}/mint?address=${address}&amount=10000000&token=shelbyusd`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    results.shelbyusd = true;
  } catch (e: any) { results.errors.push(`ShelbyUSD faucet failed: ${e.message}`); }

  await new Promise(r => setTimeout(r, 3000));

  let newApt = 0;
  try {
    const r = await fetch(
      `${APTOS_NODE}/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`
    );
    if (r.ok) {
      const d = await r.json();
      newApt = Number(d?.data?.coin?.value ?? 0) / 1e8;
    }
  } catch {}

  return NextResponse.json({
    address,
    aptFauceted:       results.apt,
    shelbyusdFauceted: results.shelbyusd,
    errors:            results.errors,
    newApt,
    message: results.apt || results.shelbyusd
      ? "Faucet request sent successfully."
      : "Faucet requests failed — please try again.",
  });
}