import { NextResponse } from "next/server";
import { getShelbyAccount } from "@/lib/shelby";

const NODE = "https://api.shelbynet.shelby.xyz/v1";
const SHELBYUSD_META = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";

async function getAptBalance(address: string): Promise<{ apt: number; raw: number; method: string }> {
  // Method 1: coin::balance view function — returns octas (1 APT = 1e8 octas)
  try {
    const r = await fetch(`${NODE}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: "0x1::coin::balance",
        type_arguments: ["0x1::aptos_coin::AptosCoin"],
        arguments: [address],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      // Returns ["<octas_string>"]
      const raw = Number(Array.isArray(data) ? data[0] : data);
      if (!isNaN(raw) && raw >= 0) {
        return { apt: raw / 1e8, raw, method: "view:coin::balance" };
      }
    }
  } catch {}

  // Method 2: CoinStore resource
  try {
    const r = await fetch(
      `${NODE}/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const d = await r.json();
      const raw = Number(d?.data?.coin?.value ?? 0);
      return { apt: raw / 1e8, raw, method: "resource:CoinStore" };
    }
  } catch {}

  return { apt: 0, raw: 0, method: "failed" };
}

async function getShelbyUSDBalance(address: string): Promise<number> {
  // Method 1: primary_fungible_store::balance view function
  try {
    const r = await fetch(`${NODE}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: "0x1::primary_fungible_store::balance",
        type_arguments: ["0x1::fungible_asset::Metadata"],
        arguments: [address, SHELBYUSD_META],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      const val = Number(Array.isArray(data) ? data[0] : data);
      if (!isNaN(val) && val >= 0) return val / 1e8;
    }
  } catch {}

  // Method 2: scan resources for FungibleStore with matching metadata
  try {
    const r = await fetch(`${NODE}/accounts/${address}/resources?limit=100`, {
      signal: AbortSignal.timeout(5000),
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

  try {
    const [aptResult, shelbyusd] = await Promise.all([
      getAptBalance(address),
      getShelbyUSDBalance(address),
    ]);

    return NextResponse.json({
      address,
      apt: aptResult.apt,
      shelbyusd,
      ready: aptResult.apt >= 0.1 && shelbyusd >= 0.001,
      // Debug info (remove after confirming correct)
      _debug: { aptRaw: aptResult.raw, aptMethod: aptResult.method },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}