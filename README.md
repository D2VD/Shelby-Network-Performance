# Shelby Analytics

**Independent, real-time analytics for the Shelby Protocol.**

Shelby Analytics is a community-built dashboard and public API tracking network health, storage provider performance, blob activity, and epoch cycles for [Shelby](https://shelby.xyz) — a decentralized blob storage network built on Aptos.

[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/API-Hono-E36002)](https://hono.dev)
[![TimescaleDB](https://img.shields.io/badge/DB-TimescaleDB-FDB515)](https://www.timescale.com)

**[Live Dashboard →](https://shelbyanalytics.site)** &nbsp;·&nbsp; **[API Docs →](https://docs.shelbyanalytics.site)**

---

## Overview

The official Shelby Explorer answers "what's happening right now" — Shelby Analytics answers "what's been happening, and is it healthy." It fills the gap with historical trends, provider health scoring, and a public API that developers and storage-provider operators can build on directly, rather than scraping a UI.

Built and maintained independently, with a focus on data accuracy: every metric traces back to confirmed on-chain state or indexer data, re-verified after each network reset rather than assumed stable.

---

## Features

- **Storage Provider Monitoring** — live health, stake, geographic distribution, and a ranked performance leaderboard across all active providers
- **Blob & Storage Analytics** — registration activity, active/pending/expired breakdowns, and network-wide storage growth over time
- **Epoch Tracking** — live countdowns and history across audit, payment, and staking epoch cycles
- **Historical Trends** — timeseries views the official Explorer doesn't expose, backed by a dedicated time-series database rather than point-in-time snapshots
- **Public REST API** — the same data powering the dashboard, available for anyone building their own tools on top of Shelby
- **Interactive API Docs** — full reference documentation with a live "try it now" playground for every endpoint

---

## Architecture

```
   Cloudflare Pages (Next.js)
              │
              ▼
      Backend Server (API)
              │
     ┌────────┴────────┐
     ▼                  ▼
Time-Series Database   Cache Layer
 (historical data)     (fast reads)
```

The frontend is a Next.js application served globally through Cloudflare's content delivery network, so pages load quickly no matter where a visitor is located.

Behind it sits a dedicated backend server that does the real work: it continuously collects data from the Shelby blockchain and its indexer, processes it into meaningful metrics, and serves it through a public API. This server runs as a set of containerized services for reliability and easy deployment, sits behind a reverse proxy for traffic routing, and connects out to the internet through an encrypted tunnel rather than exposing any open ports directly — a security-conscious setup common in modern backend infrastructure.

Two data stores support the backend:
- A **time-series database** stores historical records — provider health over time, network growth, epoch history — so the dashboard can show trends, not just a current snapshot.
- An **in-memory cache** holds frequently requested data so the API responds quickly under load, without hitting the database on every request.

A scheduled data sync process runs continuously in the background, pulling fresh data from the blockchain and indexer at regular intervals and keeping both the cache and the historical database up to date.

Documentation is a separately deployed, interactive site with live "try it now" playgrounds for every API endpoint.

The dashboard currently tracks **shelbynet**, Shelby's actively maintained developer network.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React, TypeScript |
| Backend API | Hono — a lightweight TypeScript web framework |
| Historical Data Storage | TimescaleDB — a time-series database built on PostgreSQL |
| Caching Layer | Redis — an in-memory data store for fast reads |
| Deployment | Containerized backend server, deployed via automated CI/CD on every update |
| Hosting | Cloudflare Pages (frontend + docs), served via Cloudflare's global content delivery network |
| Docs | Nextra, with live interactive API playgrounds |

---

## Public API

A free, public REST API exposes the same data behind the dashboard — network stats, provider details and leaderboard, epoch state, and data export — so developers, node operators, and other community tooling can integrate directly rather than scraping the UI.

Full reference and live testing available at **[docs.shelbyanalytics.site](https://docs.shelbyanalytics.site)**.

---

