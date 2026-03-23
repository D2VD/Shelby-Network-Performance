# Shelby Analytics Dashboard

A real-time analytics dashboard for the [Shelby Protocol](https://shelby.xyz) — a decentralized blob storage network built on the Aptos blockchain.

[![Deploy to Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare)](https://pages.cloudflare.com)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org)

---

## Table of Contents

- [Overview](#overview)
- [Shelby Protocol Architecture](#shelby-protocol-architecture)
- [How Stats Are Calculated](#how-stats-are-calculated)
- [Project Architecture](#project-architecture)
- [Prerequisites](#prerequisites)
- [Setup & Deployment](#setup--deployment)
- [Environment Variables](#environment-variables)
- [Key Commands](#key-commands)
- [Important Constraints & Notes](#important-constraints--notes)

---

## Overview

This dashboard provides live network statistics, storage provider geolocation, benchmark tools, and historical charts for the Shelby Protocol's Shelbynet and Testnet networks.

**Live metrics tracked:**
- Total Blobs stored on the network
- Total Storage Used (GB)
- Total Blob Events (transactions)
- Storage Providers, Placement Groups, Slices
- Real-time block height and ledger version

---

## Shelby Protocol Architecture

Understanding how Shelby works is essential to understanding how we query its data.

### What is Shelby?

Shelby is a **decentralized blob storage protocol** on Aptos. Users upload arbitrary binary data ("blobs"), which are:

1. **Registered on-chain** — commitment written to the Aptos blockchain
2. **Encoded** using ClayCode erasure coding (16 total / 10 data / 13 helper shards)
3. **Distributed** across Storage Providers organized into Placement Groups
4. **Audited** periodically to ensure data integrity

### On-Chain Data Structures

All blob metadata lives in a **Move Table** stored on the core contract:

```
Core Contract: 0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a

blob_metadata::Blobs
  └── blob_data (Move Table)
        ├── slot 0 → BPlusTreeMap { entries: [blob_A, blob_B, ...] }
        ├── slot 1 → BPlusTreeMap { entries: [blob_C, ...] }
        └── slot N...

Each blob entry contains:
  - owner:             address
  - blob_size:         u64 (original file size in bytes)
  - is_written:        bool (true once upload confirmed)
  - encoding:          ClayCode_16Total_10Data_13Helper
  - expiration_micros: u64
  - slice:             address (which slice hosts it)
```

The table handle for `blob_data` on Shelbynet is:
```
0xe41f1fa92a4beeacd0b83b7e05d150e2b260f6b7f934f62a5843f762260d5cb8
```

### Storage Organization

```
Network
├── 10 Placement Groups
│    └── Each PG contains multiple Slices
├── 50 Slices (active)
│    └── Each Slice assigned to providers
└── 16 Storage Providers
     ├── dc_asia      (Singapore)
     ├── dc_australia (Sydney)
     ├── dc_europe    (Frankfurt)
     ├── dc_us_east   (Virginia)
     └── dc_us_west   (San Jose)
```

### Transaction Flow per Blob

```
User uploads blob:
  1. register_multiple_blobs    → writes commitment on-chain
  2. add_blob_acknowledgements  → confirms storage providers received data

→ 2 transactions per blob (used to derive totalBlobEvents)
```

### What Indexer Data is Available

The Shelbynet Indexer (`https://api.shelbynet.shelby.xyz/v1/graphql`) is a **standard Aptos indexer** — it does NOT have custom blob tables. Available tables include:

| Table | Use |
|---|---|
| `current_storage_providers` | List all 16 storage providers |
| `account_transactions_aggregate` | Count all transactions for an address |
| `current_table_items` | Read Move Table entries by handle |

> **Note:** There is no `blobs_aggregate` or `total_storage_used` field in the indexer. Stats must be computed manually.

---

## How Stats Are Calculated

After extensive research probing all on-chain resources, view functions, and indexer tables, we determined that **no aggregate storage field exists on-chain**. The Shelby Explorer computes stats by iterating all blobs at query time — which is not feasible within Cloudflare Worker CPU limits.

### Final Formulas (< 1% error vs Explorer)

#### Total Blobs — Binary Search (exact, ~10s)

The blob table uses a `BigOrderedMap` (BPlusTreeMap) where each slot = 1 blob. The Indexer caps at 100 items/query and has no aggregate support, so we use **binary search on offset** to find the total count:

```typescript
// Binary search: find last offset that returns data
let lo = 0, hi = 10_000_000, lastValid = 0;
while (hi - lo > 100) {
  const mid = floor((lo + hi) / 2);
  const hasData = await query(handle, offset=mid, limit=1);
  if (hasData) { lastValid = mid; lo = mid; }
  else hi = mid;
}
totalBlobs = lastValid + lastPageItemCount;
// Accuracy: ~0.16%
```

#### Total Blob Events — account_transactions × 2.0

Each blob = 2 on-chain transactions (register + acknowledge). The `account_transactions_aggregate` for the core contract address gives us total transaction count:

```
totalBlobEvents = account_transactions_aggregate(coreAddress).count × 2.0
```

Validated ratio: `562,212 txns → 1,126,332 events (×2.0034)`
Accuracy: ~0.9%

#### Total Storage Used — Calibrated Average

No on-chain aggregate exists for total storage. We use a calibrated average blob size derived from a known Explorer data point:

```
calibrated_avg = 169.92 GB / 563,894 blobs = 301,333 bytes/blob
totalStorageUsedBytes = totalBlobs × 301,333
```

Accuracy: ~0.9% (may drift ±5% as blob size distribution changes over time)

#### Providers, Placement Groups, Slices — On-Chain RPC (exact)

```typescript
// Storage Providers
GET /accounts/{core}/resource/{core}::storage_provider_registry::StorageProviders
→ data.active_providers_by_az.root.children.entries → sum lengths

// Placement Groups
GET /accounts/{core}/resource/{core}::placement_group_registry::PlacementGroups
→ data.next_unassigned_placement_group_index

// Slices
GET /accounts/{core}/resource/{core}::slice_registry::SliceRegistry
→ data.slices.big_vec.vec[0].end_index + data.slices.inline_vec.length
```

### Data Refresh Strategy

```
CRON (every hour) → Cloudflare Worker (scheduled handler)
  ├── Binary search blob count  (~10s)
  ├── account_tx count          (~1s)
  ├── On-chain RPC × 3          (~5s)
  ├── Write to KV[stats:blobs]
  └── Write to R2 snapshot

GET /api/network/stats (CF Pages edge route)
  ├── Read KV[stats:blobs]  → < 1ms
  └── Fresh on-chain RPC    → ~2s
  Total: ~2s response time
```

---

## Project Architecture

```
shelby-analytics/
├── app/
│   ├── api/
│   │   ├── network/
│   │   │   ├── stats/route.ts      # Edge: reads Worker KV cache
│   │   │   └── providers/route.ts  # Edge: KV → Indexer → RPC fallback
│   │   └── benchmark/
│   │       ├── upload/route.ts     # Edge: REST PUT to Shelby RPC
│   │       └── txtime/route.ts     # Edge: measure TX confirmation time
│   ├── dashboard/
│   │   ├── page.tsx                # Dashboard overview
│   │   ├── providers/page.tsx      # Globe view + provider table
│   │   └── charts/page.tsx         # Historical charts from R2
│   └── page.tsx                    # Benchmark page
├── components/
│   ├── metrics-panel.tsx           # Sidebar stats panel
│   ├── globe-engine.tsx            # WebGL globe visualization
│   ├── nav.tsx                     # Navigation bar
│   └── network-context.tsx         # Shelbynet/Testnet switcher
├── workers/
│   ├── geo-sync.ts                 # Cloudflare Worker (v4.2)
│   └── wrangler.worker.toml        # Worker config
├── wrangler.toml                   # CF Pages config
└── package.json
```

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript |
| Hosting | Cloudflare Pages (edge runtime) |
| Worker | Cloudflare Workers (scheduled + HTTP) |
| Cache | Cloudflare KV (provider data, blob stats) |
| Storage | Cloudflare R2 (hourly snapshots for charts) |
| Blockchain | Aptos (Shelbynet chain ID: 113) |
| Visualization | Canvas 2D globe, SVG charts |

---

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally
- Cloudflare account with Pages and Workers access
- A Shelby wallet with an ed25519 private key (for benchmark features)

---

## Setup & Deployment

### 1. Clone & Install

```bash
git clone https://github.com/D2VD/Shelby-Network-Performance
cd shelby-analytics
npm install
```

### 2. Create Cloudflare KV Namespaces

```bash
npx wrangler kv:namespace create "SHELBY_KV_MAINNET"
# Note the ID → paste into wrangler.worker.toml

npx wrangler kv:namespace create "SHELBY_KV_TESTNET"
# Note the ID → paste into wrangler.worker.toml
```

### 3. Create R2 Bucket

```bash
npx wrangler r2 bucket create shelby-analytics-snapshots
```

### 4. Configure Worker

Edit `workers/wrangler.worker.toml` and fill in the KV namespace IDs from step 2.

### 5. Deploy the Cloudflare Worker

```bash
npm run worker:deploy
```

After deployment, note the Worker URL:
```
https://shelby-geo-sync.<your-subdomain>.workers.dev
```

### 6. Set Environment Variables in CF Pages

Go to **CF Dashboard → Workers & Pages → your-pages-project → Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `SHELBY_PRIVATE_KEY` | `ed25519-priv-0x<64-char-hex>` |
| `SHELBY_WALLET_ADDRESS` | `0x<your-address>` |
| `SHELBY_WORKER_URL` | `https://shelby-geo-sync.<subdomain>.workers.dev` |
| `SYNC_SECRET` | Any random 32-char string |

### 7. Deploy to Cloudflare Pages

```bash
git add .
git commit -m "initial deploy"
git push
# CF Pages auto-deploys on push
```

### 8. Trigger Initial Data Sync

After deployment, trigger the first blob count and provider sync:

```bash
# Sync providers to KV
curl -X POST "https://shelby-geo-sync.<subdomain>.workers.dev/sync?network=both&secret=<SYNC_SECRET>"

# Trigger blob count (takes ~16s)
curl -X POST "https://shelby-geo-sync.<subdomain>.workers.dev/count?network=shelbynet&secret=<SYNC_SECRET>"
```

After this, the CRON job will automatically update stats every hour.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SHELBY_PRIVATE_KEY` | ✅ | Ed25519 private key (`ed25519-priv-0x...`) for benchmark uploads |
| `SHELBY_WALLET_ADDRESS` | ✅ | Your Shelby wallet address |
| `SHELBY_WORKER_URL` | ✅ | URL of deployed geo-sync Worker |
| `SYNC_SECRET` | ✅ | Secret to protect `/sync` and `/count` endpoints |
| `SHELBY_API_KEY` | Optional | Shelby API key for higher rate limits |

---

## Key Commands

```bash
# Local development
npm run dev

# Deploy Worker only
npm run worker:deploy

# Deploy Pages only
npm run pages:deploy

# Deploy everything
npm run deploy

# Trigger manual data sync
curl -X POST "https://shelby-geo-sync.<subdomain>.workers.dev/sync?network=both&secret=<SECRET>"

# Trigger manual blob count
curl -X POST "https://shelby-geo-sync.<subdomain>.workers.dev/count?network=shelbynet&secret=<SECRET>"

# Check Worker health
curl "https://shelby-geo-sync.<subdomain>.workers.dev/health"

# Check current stats
curl "https://shelby-geo-sync.<subdomain>.workers.dev/stats?network=shelbynet"

# Force redeploy after env var changes
git commit --allow-empty -m "chore: trigger redeploy" && git push
```

---

## Important Constraints & Notes

### Cloudflare Pages — Edge Runtime Only

All API routes **must** export `export const runtime = "edge"`. The Node.js Shelby SDK (which uses WASM) cannot run on CF Pages edge functions.

```typescript
// Required at the top of every API route
export const runtime = "edge";
```

### Binary Body for Uploads

When sending binary data in fetch requests from edge runtime, use `ReadableStream` instead of `Buffer` or `Uint8Array` directly:

```typescript
function toReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}
// Use as fetch body: body: toReadableStream(payload)
```

### Explorer API is Blocked

The Shelby Explorer API (`https://explorer.shelby.xyz/api/stats`) is blocked from both CF Pages edge functions and CF Workers (Cloudflare host ACL). All stats must be computed directly from on-chain data or the Indexer.

### Indexer GraphQL Limitations

The Shelbynet Indexer is a standard Aptos indexer with a **hard cap of 100 items per query**. It does NOT support:
- `_aggregate` on `current_table_items`
- Custom blob tables
- Any storage aggregate queries

This is why the binary search approach is necessary for blob counting.

### Storage Calibration

The `avgBlobSizeBytes = 301,333` constant in `workers/geo-sync.ts` was calibrated from Explorer data on March 22, 2026. If blob size distribution changes significantly over time (e.g., the network starts hosting predominantly large video files), this value should be recalibrated by comparing with Explorer periodically.

---

## Network Information

| | Shelbynet | Testnet |
|---|---|---|
| Chain ID | 113 | 2 |
| Node URL | `https://api.shelbynet.shelby.xyz/v1` | `https://api.testnet.aptoslabs.com/v1` |
| Indexer | `https://api.shelbynet.shelby.xyz/v1/graphql` | `https://api.testnet.aptoslabs.com/v1/graphql` |
| Core Contract | `0x85fd...8e6a` | `0xc63d...dbf5` |
| Storage Providers | 16 | — |
| Placement Groups | 10 | — |
| Slices | 50 | — |

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

## License

MIT