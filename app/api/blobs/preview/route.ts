// app/api/blobs/preview/route.ts — v1.5
//
// CHANGES vs v1.4:
// FIX: 502s on every preview request. Root cause confirmed 2026-08-25:
//   `shelby.shelbynet.shelby.xyz` (the host this route used, copied from a
//   DevTools capture of explorer.shelby.xyz's own preview flow) REQUIRES an
//   Authorization: Bearer header — confirmed via direct curl, which returned
//   an explicit "Unauthorized. Rejected because anonymous requests are not
//   allowed" error, not a generic failure. This route was never sending one
//   (the v1.4 comment claiming a "public-read pattern" for this host was
//   incorrect — that assumption was carried over from a *different* host,
//   api.shelbynet.shelby.xyz's Node REST API, and never independently
//   verified for this gateway host specifically).
//
//   Cross-checked against a live DevTools capture of the Explorer's own
//   OPTIONS preflight to this exact host: it shows
//   `Access-Control-Request-Headers: authorization` /
//   `Access-Control-Allow-Headers: authorization` — a browser only sends
//   that preflight because the real follow-up GET carries a custom
//   Authorization header. The Explorer's real flow authenticates here; ours
//   silently didn't.
//
//   FIX APPLIED: switched the shelbynet gateway host to
//   `api.shelbynet.shelby.xyz` instead — confirmed via direct curl to
//   return a clean 200 with the identical 62,115-byte body (matches the
//   Explorer's own displayed "60.66 KB" for the same blob, byte-exact), with
//   NO Authorization header required. Same content, publicly served, zero
//   key management needed on this edge route.
//
//   ⚠️ OPEN RISK, not fully resolved: `api.shelbynet.shelby.xyz`'s content-
//   gateway path is not the host Shelby's own Explorer actually uses for
//   this purpose — it may be an unofficial mirror, a different CDN tier, or
//   simply undocumented, and there's no guarantee it stays public or stays
//   in sync with the authenticated host long-term. If previews start 404ing
//   or returning stale content again, re-check this host choice first
//   before assuming a regression elsewhere. The more durable long-term fix,
//   if this host ever stops working, is wiring this route to send a
//   Bearer key against `shelby.shelbynet.shelby.xyz` — either via a
//   dedicated Cloudflare Pages env var, or by proxying this call through
//   the backend's existing shelbynetKeyRotator instead of duplicating key
//   management on the edge. Deferred for now since the simpler fix works
//   and is confirmed correct.
//
//   testnet gateway host (api.testnet.shelby.xyz) was NOT re-tested for the
//   same auth requirement this session — it may or may not have the same
//   issue. Low priority since testnet sync is otherwise retired project-wide.
//
// CHANGES vs v1.3:
// FEATURE: testnet support. Previously hard-blocked to shelbynet only,
// because no testnet content gateway host had been confirmed. Confirmed
// this session via live DevTools capture of explorer.shelby.xyz with its
// network switched to TESTNET:
//
//   GET https://api.testnet.shelby.xyz/shelby/v1/blobs/{owner_0x}/{blob_name}
//   → 200 OK, same PRIVATE-OR-AUTHENTICATED-RESPONSE cache-status label as
//     shelbynet (confirmed harmless/non-blocking on both networks — do not
//     treat that label as an auth or permission signal on either network).
//
// IMPORTANT — the testnet gateway host is NOT a parallel rename of the
// shelbynet pattern. It is NOT "shelby.testnet.shelby.xyz". It is
// "api.testnet.shelby.xyz". Do not assume naming symmetry between networks
// without checking — this project has already been burned once by an
// assumed-symmetric hostname pattern.
//
// Path shape, full-buffer-before-return fix, and the X-Frame-Options
// override all carried over unchanged — nothing about those was
// shelbynet-specific to begin with.
//
// CHANGES vs v1.2:
// FIX: ownerHex was only prepending "0x" when missing — it never padded
//      the hex body to 64 chars. Aptos addresses that come in one digit
//      short (the same failure mode already fixed in blob-registry-sync.ts
//      via normalizeAddress(), and confirmed to starve get_blob_metadata
//      elsewhere in this project) were being passed straight through
//      unpadded to the gateway URL, which would 404/mismatch against the
//      real on-chain path. Added normalizeOwnerAddress() mirroring the
//      backend's normalizeAddress() logic: strip any "0x", left-pad the
//      hex body to 64 chars with "0", re-prefix "0x".
//
// CHANGES vs v1.1:
// The corruption bug persisted after v1.1's arrayBuffer() fix was deployed
// (confirmed via fresh incognito testing — ruled out browser cache as the
// cause). Two changes to isolate this further:
// 1. Removed the manually-set Content-Length header — the runtime derives
//    it correctly from an ArrayBuffer body on its own; a hand-set value can
//    go stale and produce a "looks complete, gets cut off" symptom.
// 2. Added an X-Preview-Route-Version debug header so a redeploy can be
//    confirmed unambiguously via response headers instead of assumed.
//
// CHANGES vs v1.0:
// FIX: Corrupted/truncated image bodies — streaming upstream.body straight
//      through returned 200 + correct Content-Type but an incomplete body.
//      Now buffers the full response via arrayBuffer() before returning it.
// FIX: PDF <iframe> preview blocked by the site-wide X-Frame-Options: deny.
//      Now explicitly overridden to SAMEORIGIN on this route's response only.
// EXPANDED: content-type map now covers xml/cfg/ini/yaml/yml/toml/env/conf
//      and common code/text extensions (served as text/plain, not their
//      "native" MIME type, to avoid script-execution risk on our own origin).
//

export const runtime = "edge";

// Gateway hosts are NOT symmetric across networks — do not derive one from
// the other by string substitution. shelbynet's host below is the CONFIRMED
// PUBLIC, NO-AUTH-REQUIRED mirror (api.shelbynet.shelby.xyz), not the
// authenticated host Shelby's own Explorer uses (shelby.shelbynet.shelby.xyz)
// — see the v1.5 changelog above for why, and the open risk of relying on it.
const GATEWAY_BY_NETWORK: Record<string, string> = {
  shelbynet: "https://api.shelbynet.shelby.xyz/shelby/v1/blobs",
  testnet: "https://api.testnet.shelby.xyz/shelby/v1/blobs",
};
const SUPPORTED_NETWORKS = Object.keys(GATEWAY_BY_NETWORK);
const APTOS_ADDRESS_HEX_LENGTH = 64;

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
  xml: "application/xml",
  cfg: "text/plain",
  ini: "text/plain",
  yaml: "text/plain",
  yml: "text/plain",
  toml: "text/plain",
  env: "text/plain",
  conf: "text/plain",
  sh: "text/plain",
  html: "text/plain", // deliberately plain, not text/html — avoid accidental script execution on preview
  css: "text/plain",
  js: "text/plain",
  ts: "text/plain",
  py: "text/plain",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function inferContentType(blobName: string): string {
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

// Mirrors normalizeAddress() in blob-registry-sync.ts. Aptos Node REST
// serializes addresses one hex digit short in some cases — without this,
// an unpadded owner address silently 404s against the real on-chain path
// instead of matching it. Left-pads the hex body to 64 chars, independent
// of whether the caller included a "0x" prefix.
function normalizeOwnerAddress(owner: string): string {
  const hexBody = owner.startsWith("0x") ? owner.slice(2) : owner;
  const padded = hexBody.padStart(APTOS_ADDRESS_HEX_LENGTH, "0");
  return `0x${padded}`;
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const network  = searchParams.get("network");
  const owner    = searchParams.get("owner");
  const blobName = searchParams.get("name");
  const download = searchParams.get("download") === "1";

  if (!network || !SUPPORTED_NETWORKS.includes(network)) {
    return Response.json(
      { error: `network must be one of: ${SUPPORTED_NETWORKS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!owner || !blobName) {
    return Response.json(
      { error: "owner and name are required" },
      { status: 400 },
    );
  }

  const ownerHex = normalizeOwnerAddress(owner);
  const gatewayBase = GATEWAY_BY_NETWORK[network];
  const upstreamUrl =
    `${gatewayBase}/${ownerHex}/${encodeURIComponent(blobName).replace(/%2F/g, "/")}`;

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

  // Buffer fully rather than pipe upstream.body through as a live stream.
  // CONFIRMED BUG (v1.1 session): streaming pass-through via
  // `new Response(upstream.body, ...)` was returning a 200 with the correct
  // Content-Type, but a truncated/corrupted body. Buffering trades a moment
  // of memory for a guaranteed-complete response; fine for preview-sized files.
  let bytes: ArrayBuffer;
  try {
    bytes = await upstream.arrayBuffer();
  } catch {
    return Response.json({ error: "Failed to read upstream response body" }, { status: 502 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
      // Overrides the site-wide X-Frame-Options: deny (correct policy
      // elsewhere) specifically for this route — needed so the PDF
      // <iframe> preview (same-origin) isn't blocked.
      "X-Frame-Options": "SAMEORIGIN",
      // Debug marker only — confirms which version is actually live.
      "X-Preview-Route-Version": "1.5",
    },
  });
}