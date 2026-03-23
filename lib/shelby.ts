/**
 * lib/shelby.ts — SDK helpers (Node.js runtime only)
 *
 * ⚠️  Các API routes trong dự án này chạy trên CF Pages edge runtime
 *     và KHÔNG thể import @shelby-protocol/sdk (Node.js-only / WASM).
 *     Tất cả benchmark + network routes gọi Shelby RPC HTTP trực tiếp.
 *
 * File này được giữ lại cho trường hợp trong tương lai có Node.js routes
 * (ví dụ: heavy processing, batch jobs chạy ngoài edge).
 * Hiện tại không được dùng ở bất kỳ đâu — đừng import trong edge routes.
 *
 * Shelby RPC endpoints (dùng trực tiếp trong edge routes):
 *   Blob upload/download: https://api.shelbynet.shelby.xyz/shelby/v1/blobs/{addr}/{name}
 *   Node info:            https://api.shelbynet.shelby.xyz/v1
 *   Indexer GraphQL:      https://api.shelbynet.shelby.xyz/v1/graphql
 */

function assertNodeRuntime(fnName: string): void {
  // CF Pages edge runtime không có process.versions.node
  // Next.js server (Node.js) có process.versions.node
  if (
    typeof process === "undefined" ||
    !process.versions?.node
  ) {
    throw new Error(
      `${fnName}() không thể dùng trong edge runtime. ` +
      "Dùng Shelby RPC HTTP API trực tiếp thay thế."
    );
  }
}

export async function getShelbyClient() {
  assertNodeRuntime("getShelbyClient");
  const { ShelbyNodeClient } = await import("@shelby-protocol/sdk/node");
  const { Network } = await import("@aptos-labs/ts-sdk");
  return new ShelbyNodeClient({
    network: (Network as any).SHELBYNET ?? ("shelbynet" as any),
    ...(process.env.SHELBY_API_KEY ? { apiKey: process.env.SHELBY_API_KEY } : {}),
  });
}

export async function getShelbyAccount() {
  assertNodeRuntime("getShelbyAccount");
  const { Ed25519PrivateKey, Account } = await import("@aptos-labs/ts-sdk");
  const raw = process.env.SHELBY_PRIVATE_KEY;
  if (!raw) throw new Error("SHELBY_PRIVATE_KEY not set in environment");
  const hex = raw.replace(/^ed25519-priv-/, "");
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(hex) });
}

export async function getAptosClient() {
  assertNodeRuntime("getAptosClient");
  const { Aptos, AptosConfig, Network } = await import("@aptos-labs/ts-sdk");
  return new Aptos(new AptosConfig({
    network: (Network as any).SHELBYNET ?? ("shelbynet" as any),
  }));
}