# Varible

Market data for tokenized collectibles: physical collectibles held in vaults and traded as tokens. Live at [varible.rarible.com](https://varible.rarible.com).

Varible tracks six venues: Collector Crypt, Courtyard, Beezie, Phygitals, DYLI and Renaiss. It covers pack (gacha) spend, resale, market cap and holders, plus a monthly price index. There are pages per IP, per card and per venue, and a keyed public API.

**Taking it over? Start with [docs/HANDOVER.md](docs/HANDOVER.md).** It covers how the data flows, every scheduled job, every secret, the one process that needs a host, the runbooks and the open pull requests.

## How it works

Pages never call a data source while they render. Scheduled warmers in GitHub Actions read each venue's feeds and write snapshots and a daily time series to Supabase Postgres. The Next.js app on Vercel reads only those rows. One always-on process, the gacha listener, records Collector Crypt and Phygitals pack pulls as they happen.

| Layer | What |
|---|---|
| App | Next.js 16.2, React 19, TypeScript, Tailwind CSS v4, hosted on Vercel |
| Data | Supabase Postgres: `snapshots` (the JSON blobs pages read), `metric_snapshots` (the daily time series), `source_freshness` (one row per feed), and row stores such as `cards`, `secondary_sales`, `gacha_pulls` and `renaiss_pulls` |
| Jobs | GitHub Actions: [`.github/workflows/warm.yml`](.github/workflows/warm.yml) (the warmers) and [`warm-backup.yml`](.github/workflows/warm-backup.yml) (re-dispatches dropped runs) |
| Sources | Dune, Helius, the Rarible API, Etherscan, venue APIs (Collector Crypt, Beezie, Phygitals, DYLI, Renaiss), Polygon and BNB Smart Chain over RPC, FRED and CoinGecko |

## Run it locally

1. Install. CI uses Node 22.
   ```bash
   npm ci
   ```
2. Copy the env template and fill in values. [`.env.example`](.env.example) lists names only.
   ```bash
   cp .env.example .env.local
   ```
   Pages need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Each warmer needs its own source keys; the table in [docs/HANDOVER.md](docs/HANDOVER.md#secrets-and-environment) says which.
3. Start the dev server and open http://localhost:3000.
   ```bash
   npm run dev
   ```
   - Set `NEXT_PUBLIC_SHELL_V2=true` to get the production layout (see `src/lib/flags.ts`).
   - If Turbopack fails on a symlinked `node_modules` (for example in a git worktree), run `npx next dev --webpack`.

> **The keys in `.env.local` point at production.** Pages only read. Warmers write to production unless they are run with `--out=<dir>`, which writes JSON locally. Some warmers write only with `--apply`. To render a locally built snapshot, run the warmer with `--out=<dir>`, then start the dev server with `SNAPSHOT_LOCAL_DIR=<dir>`. Keys that have a file in that folder are read from disk.

Checks:

```bash
npx tsc --noEmit
npm run lint
npm run test:renaiss
```

`package.json` has one `test:*` script per suite.

## Repo map

| Path | What |
|---|---|
| `src/app/` | Routes: home, `/ips` and `/ip/[key]`, `/platforms` and `/platform/[key]`, `/card/[id]`, `/i/[...slug]` (a card identity across venues), `/index/[...path]` (price index receipts), `/stats`, `/economics`, `/report`, `/gacha`, `/status` (per-feed freshness), `/methodology`, and the API under `/api` (public v1 documented in [docs/api-v1.md](docs/api-v1.md)) |
| `src/lib/` | The data layer: venue clients (`cc`, `courtyard`, `beezie`, `phygitals`, `dyli`, `renaiss`, `rarible`, `helius`, `etherscan`, `dune`), warmer logic (`data/warmers`), Postgres access (`db`) and the index engine (`indices`) |
| `src/components/` | UI components |
| `scripts/` | Warmers (`warm-*.ts`), the two gates (`check-freshness.ts`, `check-invariants.ts`), backfills and one-off tools. `scripts/dev/` holds read-only analyses. |
| `dune/` | SQL for the Dune queries the warmers read; their IDs are in `src/lib/dune/queryIds.ts` |
| `supabase/migrations/` | The schema, applied by hand |
| `docs/` | The handover, API docs, briefs and audits (`docs/roadmap/`), post-card specs |
| `DATA_MODEL.md` | The schema design |
| `HANDOVER.md`, `MIGRATION_PLAN.md`, `DUNE_BACKFILL_QUERIES.md`, `memory.md` (root) | Notes from the June 2026 prototype, kept for history. [docs/HANDOVER.md](docs/HANDOVER.md) replaces them. |
| `AGENTS.md`, `CLAUDE.md` | A note for coding agents: this Next.js version differs from older ones, so read `node_modules/next/dist/docs/` first |
