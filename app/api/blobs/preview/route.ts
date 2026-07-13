// app/api/blobs/preview/route.ts — v1.4
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
// Path shape, no-auth-header rule, full-buffer-before-return fix, and the
// X-Frame-Options override all carried over unchanged — nothing about
// those was shelbynet-specific to begin with.
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
//      hex body to 64 chars with "0", re-prefix "0x". Confirmed via code
//      review this had never actually been applied to this route — v1.1's
//      and v1.2's changelogs only ever addressed the truncation/CSP bugs,
//      not this one.
//
// CHANGES vs v1.1:
// The corruption bug persisted after v1.1's arrayBuffer() fix was deployed
// (confirmed via fresh incognito testing — ruled out browser cache as the
// cause). Two changes to isolate this further:
// 1. Removed the manually-set Content-Length header. Setting it explicitly
//    from the buffered byte count is redundant (the runtime derives it
//    correctly from an ArrayBuffer body on its own) and risky — if anything
//    in the response path transforms the body after this function returns,
//    a hand-set Content-Length can go stale and produce exactly this
//    "looks complete, gets cut off" symptom. Letting the platform compute
//    it removes an entire class of mismatch bugs.
// 2. Added an X-Preview-Route-Version debug header. There is no equivalent
//    of the VPS's "grep dist/ to confirm the new code is actually running"
//    check for Cloudflare Pages deployments — this header exists solely so
//    a redeploy can be confirmed unambiguously via response headers instead
//    of assumed.
//
// CHANGES vs v1.0 (all three confirmed via live DevTools testing this
// session, not guessed):
// FIX: Corrupted/truncated image bodies. Streaming upstream.body straight
//      through was returning 200 + correct Content-Type but an incomplete
//      body (DevTools Preview tab showed a partial render + checkerboard
//      gap). Now buffers the full response via arrayBuffer() before
//      returning it. Ruled out first: Cloudflare Hotlink Protection
//      (confirmed OFF in dashboard) and browser extensions (reproduced in a
//      clean profile) — this was a code bug, not an infra/extension issue.
// FIX: PDF <iframe> preview blocked by the site-wide X-Frame-Options: deny
//      (correct policy elsewhere). Now explicitly overridden to SAMEORIGIN
//      on this route's response only.
// EXPANDED: content-type map now covers xml/cfg/ini/yaml/yml/toml/env/conf
//      and common code/text extensions (deliberately served as text/plain,
//      not their "native" MIME type, to avoid script-execution risk on our
//      own origin for anything resembling html/js/css).
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
// SCOPE: shelbynet and testnet both supported as of v1.4. Their gateway
// hosts were confirmed independently and are NOT the same pattern — see
// GATEWAY_BY_NETWORK below. If a third network is ever added, its gateway
// host must be independently confirmed too, not assumed from the other two.
//
// No Authorization header is sent — matches the public-read pattern already
// established for api.shelbynet.shelby.xyz elsewhere in this project, though
// note this is a *different* host, so that assumption is carried over rather
// than independently re-confirmed for every path on shelby.shelbynet.shelby.xyz.

export const runtime = "edge";

// Gateway hosts are NOT symmetric across networks — do not derive one from
// the other by string substitution. Each was independently confirmed via
// live DevTools capture of explorer.shelby.xyz's own File Preview action.
const GATEWAY_BY_NETWORK: Record<string, string> = {
  shelbynet: "https://shelby.shelbynet.shelby.xyz/shelby/v1/blobs",
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
  // Content-Type, but a truncated/corrupted body — DevTools' own Preview tab
  // showed a partial image render followed by a transparent/checkerboard
  // gap, consistent with the stream being cut short before fully flushing.
  // Buffering trades a moment of memory for a guaranteed-complete response;
  // fine for preview-sized files.
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
      // elsewhere, per this project's security checklist) specifically for
      // this route — needed so the PDF <iframe> preview (same-origin) isn't
      // blocked. Confirmed this session: without this override, the browser
      // refuses to frame our own preview URL and shows
      // "shelbyanalytics.site refused to connect / ERR_BLOCKED_BY_RESPONSE".
      "X-Frame-Options": "SAMEORIGIN",
      // Debug marker only — confirms which version is actually live.
      // Safe to remove once corruption bug is confirmed fixed.
      "X-Preview-Route-Version": "1.4",
    },
  });
}