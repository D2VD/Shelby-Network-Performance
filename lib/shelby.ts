import { Ed25519PrivateKey, Network, Account, Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";

let _client: ShelbyNodeClient | null = null;
let _account: Account | null = null;

export function getShelbyAccount(): Account {
  if (_account) return _account;
  const raw = process.env.SHELBY_PRIVATE_KEY!;
  if (!raw) throw new Error("SHELBY_PRIVATE_KEY not set in environment");
  const hex = raw.replace(/^ed25519-priv-/, "");
  _account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(hex) });
  return _account;
}

export function getShelbyClient(): ShelbyNodeClient {
  if (_client) return _client;
  // Network.SHELBYNET exists in @aptos-labs/ts-sdk v5+
  _client = new ShelbyNodeClient({
    network: (Network as any).SHELBYNET ?? "shelbynet",
    ...(process.env.SHELBY_API_KEY ? { apiKey: process.env.SHELBY_API_KEY } : {}),
  });
  return _client;
}

export function getAptosClient(): Aptos {
  return new Aptos(new AptosConfig({
    network: (Network as any).SHELBYNET ?? ("shelbynet" as any),
  }));
}