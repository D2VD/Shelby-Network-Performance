// app/api/node/transactions/route.ts
// Two modes:
//   ?address=0x...&network=...&limit=25&cursor=   → account tx list  (Flow 1)
//   ?version=12345&network=...                    → single tx detail (Flow 2)
export const runtime = "edge";

const NODE: Record<string, string> = {
  shelbynet: (process.env.SHELBY_NODE_URL ?? "https://api.shelbynet.shelby.xyz/v1").replace(/\/$/, ""),
  testnet:   "https://api.testnet.aptoslabs.com/v1",
};

const CONTRACT = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

/* ── normalise a raw REST transaction to display-ready shape ──────────────── */
function normTx(tx: Record<string, unknown>) {
  const payload = tx.payload as Record<string, string> | undefined;
  const fn      = payload?.function ?? "";
  const short   = fn.includes("::") ? fn.split("::").at(-1)! : (tx.type as string ?? "unknown");
  const gasUsed  = BigInt((tx.gas_used  as string) ?? "0");
  const gasPrice = BigInt((tx.gas_unit_price as string) ?? "0");
  // Gas fee in APT: (gas_used × gas_unit_price) / 100_000_000
  const gasFeeApt = Number(gasUsed * gasPrice) / 1e8;

  return {
    version:    (tx.version  as string) ?? "",
    hash:       (tx.hash     as string) ?? "",
    type:       short,
    fullFn:     fn,
    sender:     (tx.sender   as string) ?? "",
    success:    (tx.success  as boolean) ?? false,
    gasFeeApt:  gasFeeApt.toFixed(8),
    gasFeeRaw:  gasFeeApt,          // numeric — used for client-side sort
    timestamp:  (tx.timestamp as string) ?? "",
    isShelby:   fn.startsWith(CONTRACT),
  };
}

/* ── parse BlobRegisteredEvent from tx.events ─────────────────────────────── */
function parseBlobEvents(tx: Record<string, unknown>) {
  const events = (tx.events as Array<{ type: string; data: Record<string, unknown> }>) ?? [];
  return events
    .filter(e => e.type?.includes("blob_metadata::BlobRegisteredEvent"))
    .map(e => {
      const d = e.data ?? {};
      const expiryMicros = parseInt((d.expiration_micros as string) ?? "0");
      const expiryDate   = expiryMicros > 0
        ? new Date(expiryMicros / 1000).toLocaleString("vi-VN", {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            day: "2-digit", month: "2-digit", year: "numeric",
          })
        : "—";
      const sizeBytes = parseInt((d.blob_size as string) ?? "0");

      return {
        blobName:       (d.blob_name       as string) ?? "",
        sizeBytes,
        sizeKB:         (sizeBytes / 1024).toFixed(2),
        encoding:       ((d.encoding as Record<string, string>)?.__variant__) ?? "—",
        chunksetCount:  (d.chunkset_count  as string) ?? "—",
        blobCommitment: (d.blob_commitment as string) ?? "—",
        expiryMicros:   (d.expiration_micros as string) ?? "0",
        expiryDate,
      };
    });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = (searchParams.get("address") ?? "").trim().toLowerCase();
  const version = (searchParams.get("version") ?? "").trim();
  const network = searchParams.get("network") ?? "shelbynet";
  const limit   = Math.min(Number(searchParams.get("limit") ?? "25"), 50);
  const cursor  = searchParams.get("cursor") ?? "";

  const base = NODE[network] ?? NODE.shelbynet;

  try {
    /* ── Flow 2: single transaction by version ──────────────────────────── */
    if (version) {
      const res = await fetch(`${base}/transactions/by_version/${version}`, {
        headers: { Accept: "application/json" },
        signal:  AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        return Response.json({ ok: false, error: `Transaction v${version} not found` }, { status: res.status });
      }
      const raw = (await res.json()) as Record<string, unknown>;
      const tx  = normTx(raw);

      if (!raw.success) {
        return Response.json({
          ok: true, tx, blobEvents: [],
          note: "Transaction failed — no blob metadata available.",
        });
      }

      const blobEvents = parseBlobEvents(raw);
      return Response.json({ ok: true, tx, blobEvents });
    }

    /* ── Flow 1: account transaction list ───────────────────────────────── */
    if (address) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set("start", cursor);

      const res = await fetch(`${base}/accounts/${address}/transactions?${params}`, {
        headers: { Accept: "application/json" },
        signal:  AbortSignal.timeout(12_000),
      });

      if (res.status === 404) {
        return Response.json({ ok: true, txs: [], nextCursor: "",
          note: "Account not found — wallet may not be activated on-chain." });
      }
      if (!res.ok) {
        return Response.json({ ok: false, error: `Node ${res.status}` }, { status: 502 });
      }

      const raw = (await res.json()) as Record<string, unknown>[];
      const txs = raw.map(normTx);
      // Cursor for next page = version of last item (Aptos uses version as start offset)
      const nextCursor = raw.length === limit ? (raw.at(-1)?.version as string ?? "") : "";

      return Response.json({ ok: true, txs, nextCursor });
    }

    return Response.json({ ok: false, error: "Provide address or version" }, { status: 400 });

  } catch (e: unknown) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}