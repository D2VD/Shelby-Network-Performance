import { NextResponse } from "next/server";
import { getShelbyAccount } from "@/lib/shelby";

export const runtime = "nodejs";

const NODE = "https://api.shelbynet.shelby.xyz/v1";
const SHELBYUSD_META = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";

async function getAptBalance(address: string): Promise<number> {
  // Use coin::balance view function — returns ["<octas>"]
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
      const data = await r.json();
      const octas = Number(Array.isArray(data) ? data[0] : data);
      if (!isNaN(octas) && octas >= 0) return octas / 1e8;
    }
  } catch {}

  // Fallback: CoinStore resource
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
      const data = await r.json();
      const val = Number(Array.isArray(data) ? data[0] : data);
      if (!isNaN(val) && val >= 0) return val / 1e8;
    }
  } catch {}

  // Fallback: scan resources
  try {
    const r = await fetch(`${NODE}/accounts/${address}/resources?limit=100`, {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const resources: any[] = await r.json();
      for (const res of resources) {
        const d = res.data ?? {};
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
  let account;
  try {
    account = getShelbyAccount();
  } catch (err: any) {
    return NextResponse.json({ error: `Wallet error: ${err.message}` }, { status: 500 });
  }

  const address = account.accountAddress.toString();

  // Run both queries in parallel, retry once if either returns 0
  const [apt1, shelbyusd1] = await Promise.all([
    getAptBalance(address),
    getShelbyUSDBalance(address),
  ]);

  // Retry failed ones after 500ms
  let apt = apt1;
  let shelbyusd = shelbyusd1;
  if (apt === 0 || shelbyusd === 0) {
    await new Promise(r => setTimeout(r, 500));
    const [apt2, usd2] = await Promise.all([
      apt === 0 ? getAptBalance(address) : Promise.resolve(apt),
      shelbyusd === 0 ? getShelbyUSDBalance(address) : Promise.resolve(shelbyusd),
    ]);
    apt = apt2;
    shelbyusd = usd2;
  }

  return NextResponse.json({
    address,
    apt,
    shelbyusd,
    ready: apt >= 0.1 && shelbyusd >= 0.001,
    // Note: This is the SERVER wallet balance (SHELBY_PRIVATE_KEY in .env.local)
    // It is different from your Petra browser wallet
  });
}