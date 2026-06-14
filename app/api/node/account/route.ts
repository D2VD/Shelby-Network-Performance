// app/api/node/account/route.ts — v2
// Adds: balanceApt (APT coin balance, fetched from the same /resources call)
export const runtime = "edge";

const NODE: Record<string, string> = {
  shelbynet: (process.env.SHELBY_NODE_URL ?? "https://api.shelbynet.shelby.xyz/v1").replace(/\/$/, ""),
  testnet:   "https://api.testnet.aptoslabs.com/v1",
};

const APT_COIN_TYPE = "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = (searchParams.get("address") ?? "").trim().toLowerCase();
  const network = searchParams.get("network") ?? "shelbynet";

  if (!address.startsWith("0x")) {
    return Response.json({ ok: false, error: "Invalid address" }, { status: 400 });
  }

  const base = NODE[network] ?? NODE.shelbynet;

  try {
    const res = await fetch(`${base}/accounts/${address}/resources`, {
      headers: { Accept: "application/json" },
      signal:  AbortSignal.timeout(12_000),
    });

    if (res.status === 404) {
      return Response.json(
        { ok: false, error: "Account not found — wallet may not be activated on-chain", activated: false },
        { status: 404 }
      );
    }
    if (!res.ok) {
      return Response.json({ ok: false, error: `Node ${res.status}` }, { status: 502 });
    }

    const resources = (await res.json()) as Array<{ type: string; data: Record<string, unknown> }>;

    const acct = resources.find(r => r.type === "0x1::account::Account");
    const sequenceNumber = (acct?.data?.sequence_number as string) ?? "0";

    // APT balance — CoinStore resource holds { coin: { value: "..." } }, in Octas (1 APT = 1e8 Octas)
    const coinStore = resources.find(r => r.type === APT_COIN_TYPE);
    let balanceApt: string | undefined;
    if (coinStore) {
      const octas = BigInt(((coinStore.data?.coin as Record<string, unknown>)?.value as string) ?? "0");
      balanceApt = (Number(octas) / 1e8).toFixed(4);
    }

    return Response.json({ ok: true, sequenceNumber, balanceApt, activated: true });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}