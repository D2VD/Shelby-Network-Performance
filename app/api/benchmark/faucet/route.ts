import { NextResponse } from "next/server";
import { getShelbyAccount } from "@/lib/shelby";

export const runtime = "nodejs";

const FAUCET_URL  = "https://faucet.shelbynet.shelby.xyz";
const APTOS_NODE  = "https://api.shelbynet.shelby.xyz/v1";

// Hàm gọi API có kèm cơ chế retry (thử lại tối đa 3 lần)
async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
      if (res.ok) return res;
      console.warn(`Faucet attempt ${i + 1} failed with status ${res.status}`);
    } catch (err: any) {
      console.warn(`Faucet attempt ${i + 1} error: ${err.message}`);
    }
    // Đợi 1.5s trước khi thử lại
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`Failed after ${retries} attempts`);
}

export async function POST() {
  let account;
  try {
    account = getShelbyAccount();
  } catch (err: any) {
    return NextResponse.json({ error: `Wallet error: ${err.message}` }, { status: 500 });
  }

  const address = account.accountAddress.toString();
  const results: { apt: boolean; shelbyusd: boolean; errors: string[] } = {
    apt: false,
    shelbyusd: false,
    errors:[],
  };

  // ── Faucet APT (Có Retry) ──────────────────────────────────────────
  try {
    await fetchWithRetry(`${FAUCET_URL}/mint?address=${address}&amount=100000000`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    results.apt = true;
  } catch (e: any) {
    results.errors.push(`APT faucet failed: ${e.message}`);
  }

  // ── Faucet ShelbyUSD (Có Retry) ────────────────────────────────────
  try {
    await fetchWithRetry(`${FAUCET_URL}/mint?address=${address}&amount=10000000&token=shelbyusd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    results.shelbyusd = true;
  } catch (e: any) {
    results.errors.push(`ShelbyUSD faucet failed: ${e.message}`);
  }

  // ── Đợi 3s để blockchain xác nhận giao dịch ────────────────
  await new Promise(r => setTimeout(r, 3000));

  let newApt = 0;
  try {
    const res = await fetch(`${APTOS_NODE}/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`);
    if (res.ok) {
      const data = await res.json();
      newApt = Number(data?.data?.coin?.value ?? 0) / 1e8;
    }
  } catch {}

  return NextResponse.json({
    address,
    aptFauceted: results.apt,
    shelbyusdFauceted: results.shelbyusd,
    errors: results.errors,
    newApt,
    message: results.apt || results.shelbyusd
      ? "Faucet request sent successfully. Balance updated."
      : "Faucet requests failed — please try again later or use CLI.",
  });
}