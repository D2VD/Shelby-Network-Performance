// app/api/blobs/preview/route.ts
//
// Thin edge proxy for Shelby's own public content gateway, confirmed live via
// DevTools capture of explorer.shelby.xyz's own "File Preview" action:
//
//   GET https://shelby.shelbynet.shelby.xyz/shelby/v1/blobs/{owner_0x}/{blob_name}
//   → 200 OK, Access-Control-Allow-Origin: *, Content-Type: application/octet-stream
//
// CORS is wide open on that endpoint, so this proxy exists NOT because direct
// client access is blocked, but to:
//   1. Normalize Content-Type — upstream always returns generic
//      application/octet-stream, which some browsers won't render inline for
//      PDFs/text/etc (images tend to work via MIME-sniffing, but it's not
//      guaranteed across browsers, so we set it explicitly for every type).
//   2. Set a clean Content-Disposition filename for the Download button.
//   3. Give one seam to add auth/rate-limiting later without a frontend change.
//
// KEY FORMAT — do not confuse with the other two blob-key formats already in
// use elsewhere in this codebase:
//   - register_blob argument:              plain "{blob_name}"            (no owner)
//   - get_blob_metadata /v1/view argument:  "@{owner_hex_NO_0x}/{blob_name}"
//   - THIS gateway path:                    "{owner_hex_WITH_0x}/{blob_name}"
//
// SCOPE: shelbynet only. A testnet equivalent of this gateway host has not
// been confirmed — do not assume the same hostname/path pattern applies
// there without checking first.
//
// No Authorization header is sent — matches the public-read pattern already
// established for api.shelbynet.shelby.xyz elsewhere in this project, though
// note this is a *different* host, so that assumption is carried over rather
// than independently re-confirmed for every path on shelby.shelbynet.shelby.xyz.

export const runtime = "edge";

const SHELBYNET_GATEWAY = "https://shelby.shelbynet.shelby.xyz/shelby/v1/blobs";

// TODO: if a shared byte-content-type map already exists in lib/, replace
// this with that instead of maintaining a second copy.
const EXT_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  json: "application/json",
  md: "text/markdown",
  log: "text/plain",
  csv: "text/csv",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function inferContentType(blobName: string): string {
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const network  = searchParams.get("network");
  const owner    = searchParams.get("owner");
  const blobName = searchParams.get("name");
  const download = searchParams.get("download") === "1";

  if (network !== "shelbynet") {
    return Response.json(
      { error: "Blob preview is currently supported for shelbynet only" },
      { status: 400 },
    );
  }
  if (!owner || !blobName) {
    return Response.json(
      { error: "owner and name are required" },
      { status: 400 },
    );
  }

  const ownerHex = owner.startsWith("0x") ? owner : `0x${owner}`;
  const upstreamUrl =
    `${SHELBYNET_GATEWAY}/${ownerHex}/${encodeURIComponent(blobName).replace(/%2F/g, "/")}`;

  let upstream: Response;
  try {
    // No cache/next fetch options — both throw RequestInitializerDict errors
    // in the CF edge runtime (confirmed project constraint).
    upstream = await fetch(upstreamUrl);
  } catch {
    return Response.json({ error: "Upstream gateway unreachable" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: `Upstream returned ${upstream.status}` },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const filename    = blobName.split("/").pop() ?? blobName;
  const contentType = inferContentType(blobName);
  const disposition = download ? "attachment" : "inline";

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}