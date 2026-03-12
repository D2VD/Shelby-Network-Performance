import { NextResponse } from "next/server";
import { getShelbyAccount } from "@/lib/shelby";

const NODE = "https://api.shelbynet.shelby.xyz/v1";
const SHELBYUSD_META = "0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1";

async function getAptBalance(address: string): Promise<number> {
  // Method 1: view function (most reliable)
  try {
    const r = await fetch(`${NODE}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: "0x1::coin::balance",
        type_arguments: ["0x1::aptos_coin::AptosCoin"],
        arguments: [address],
      }),
    });
    if (r.ok) {
      const data = await r.json();
      const val = Array.isArray(data) ? data[0] : data;
      if (val !== undefined && val !== null) return Number(val) / 1e8;
    }
  } catch {}

  // Method 2: account info (balance field in octas)
  try {
    const r = await fetch(`${NODE}/accounts/${address}`);
    if (r.ok) {
      const d = await r.json();
      if (d?.sequence_number !== undefined) {
        // Try CoinStore resource
        const r2 = await fetch(
          `${NODE}/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`
        );
        if (r2.ok) {
          const d2 = await r2.json();
          return Number(d2?.data?.coin?.value ?? 0) / 1e8;
        }
      }
    }
  } catch {}

  return 0;
}

async function getShelbyUSDBalance(address: string): Promise<number> {
  // Method 1: primary_fungible_store view function
  try {
    const r = await fetch(`${NODE}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: "0x1::primary_fungible_store::balance",
        type_arguments: ["0x1::fungible_asset::Metadata"],
        arguments: [address, SHELBYUSD_META],
      }),
    });
    if (r.ok) {
      const data = await r.json();
      const val = Array.isArray(data) ? data[0] : data;
      if (val !== undefined && val !== null && Number(val) >= 0) {
        return Number(val) / 1e8;
      }
    }
  } catch {}

  // Method 2: scan resources
  try {
    const r = await fetch(`${NODE}/accounts/${address}/resources?limit=100`);
    if (r.ok) {
      const resources: any[] = await r.json();
      for (const res of resources) {
        const d = res.data ?? {};
        const meta = d?.metadata?.inner ?? d?.metadata ?? "";
        if (typeof meta === "string" &&
            meta.toLowerCase() === SHELBYUSD_META.toLowerCase()) {
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
    const [apt, shelbyusd] = await Promise.all([
      getAptBalance(address),
      getShelbyUSDBalance(address),
    ]);

    return NextResponse.json({
      address,
      apt,
      shelbyusd,
      ready: apt >= 0.1 && shelbyusd >= 0.001,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}