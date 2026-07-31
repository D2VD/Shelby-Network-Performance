# Shelby Analytics Docs (Nextra)

Static docs site, deployed via the same Cloudflare Pages pipeline as the main dashboard.

## Local dev

```bash
npm install
npm run dev
```

## Build (static export)

```bash
npm run build
```

Output lands in `out/` (see `next.config.js` — `output: 'export'`). Point Cloudflare
Pages' build output directory at `out`.

## Suggested Cloudflare Pages config

- Build command: `npm run build`
- Build output directory: `out`
- Root directory: wherever this folder lives in the repo (e.g. `docs/`)

## Before going live

- [ ] Confirm every endpoint in `pages/api-reference/*.mdx` against the actually-deployed
      `/v1/*` API — this content was drafted from `UPGRADE_ROADMAP.md`'s Phase 3 spec, not
      verified against shipped code.
- [ ] Replace placeholder GitHub URLs in `theme.config.tsx`.
- [ ] Add a real logo/favicon.
- [ ] Wire up a subdomain (e.g. `docs.shelbyanalytics.site`) and add it to Cloudflare Pages.

## Deploy troubleshooting

`package-lock.json` is committed in this repo. If Cloudflare Pages' framework preset
runs `npm ci` (its default for detected Next.js projects) and the lockfile is ever
deleted or falls out of sync with `package.json`, the build fails with npm dumping its
own CLI help text as the error output — misleading at a glance, but it just means
`npm ci` has nothing to install from. Regenerate with `npm install` locally and commit
the updated lockfile, or set the Cloudflare Pages install command explicitly to
`npm install` instead of relying on the preset default.
