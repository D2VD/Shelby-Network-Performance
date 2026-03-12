import { NextResponse } from "next/server";
import { getShelbyAccount } from "@/lib/shelby";

const FAUCET_URL  = "https://faucet.shelbynet.shelby.xyz";
const APTOS_NODE  = "https://api.shelbynet.shelby.xyz/v1";

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
    errors: [],
  };

  // ── Faucet APT ──────────────────────────────────────────
  try {
    const r = await fetch(`${FAUCET_URL}/mint?address=${address}&amount=100000000`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (r.ok) {
      results.apt = true;
    } else {
      // Try alternative endpoint
      const r2 = await fetch(`${FAUCET_URL}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, amount: 100_000_000 }),
      });
      results.apt = r2.ok;
      if (!r2.ok) results.errors.push(`APT faucet: ${r2.status}`);
    }
  } catch (e: any) {
    results.errors.push(`APT faucet failed: ${e.message}`);
  }

  // ── Faucet ShelbyUSD ────────────────────────────────────
  // ShelbyUSD faucet is typically at the same endpoint with token param
  try {
    const r = await fetch(`${FAUCET_URL}/mint?address=${address}&amount=10000000&token=shelbyusd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (r.ok) {
      results.shelbyusd = true;
    } else {
      // Try shelby CLI faucet endpoint pattern
      const r2 = await fetch(`${FAUCET_URL}/shelbyusd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      results.shelbyusd = r2.ok;
      if (!r2.ok) results.errors.push(`ShelbyUSD faucet: ${r2.status}`);
    }
  } catch (e: any) {
    results.errors.push(`ShelbyUSD faucet failed: ${e.message}`);
  }

  // ── Wait a moment then check new balance ────────────────
  await new Promise(r => setTimeout(r, 2000));

  let newApt = 0;
  let newShelbyusd = 0;
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
    // Note: ShelbyUSD balance check requires indexer which may lag
    message: results.apt || results.shelbyusd
      ? "Faucet request sent. Balance may take 10-30s to update."
      : "Faucet requests failed — please use: shelby faucet --network shelbynet",
  });
}