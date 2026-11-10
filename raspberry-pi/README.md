# CryptoPulse Raspberry Pi Runtime Foundation

This folder is an isolated Node.js runtime for the existing Raspberry Pi PostgreSQL database. It is not part of the Vercel dashboard and is excluded from Vercel deployment inputs.

## Phase 5 scope

In addition to the Phase 4 read-only API, the package now includes an explicitly invoked, one-shot market-data ingestion command. It fetches public Bitvavo 24-hour tickers and candles, then persists snapshots and candles to the existing PostgreSQL tables. The command reads enabled markets only from `AI_Crypto_Bot_Watched_Markets`; it does not consult the configured market list or Bitvavo's market catalog.

Run a deliberate ingestion pass from this directory after configuring the existing database connection:

```sh
npm run ingest:market-data -- --intervals=1m
npm run ingest:market-data -- --intervals=all
```

An interval must be selected explicitly. The command handles every enabled market in batches of at most five, uses at most four concurrent provider requests, fetches no more than 500 candles per market/interval request, and writes candles in chunks of at most 100. It exits after one pass and does not start a scheduler. A first `--intervals=all` run can request up to 306,000 candles for 102 markets; start with selected intervals and monitor Pi resources.

The existing `AI_Crypto_Bot_Market_Data` schema has a unique key on `symbol`, so it can retain only the latest snapshot per market. Ingestion upserts that row; snapshot history cannot be retained without changing the existing schema, which this phase prohibits. Candle rows remain historical and are checkpointed incrementally. No Supabase migration, schema change, market mutation, AI run, paper trade, or dashboard cutover is performed.

The read-only API remains loopback-only and authenticated routes remain denied by the default provider. Its endpoints and intentionally partial dashboard response are unchanged.

Data routes require an authenticated identity from the Phase 3 middleware. The default provider denies access, so these routes return `401` until a trusted provider is supplied. Provider integration, OIDC, login, registration, password reset, and session creation remain out of scope. The API is loopback-only; CORS is disabled by default.

The API runtime does not import Supabase data, run migrations, alter schema, seed or change markets, start a scheduler, analyze markets, or execute paper/live trades. Only the explicit ingestion CLI writes snapshots, candles, and best-effort scanner failure events. No PostgreSQL runtime function is required or invoked.

## Requirements

- Node.js 20.6 or newer
- Network access from the Pi runtime to the already-existing PostgreSQL instance
- PostgreSQL settings for the existing database. Keep `DATABASE_USER` read-only for the API; configure the paired `INGESTION_DATABASE_USER` and `INGESTION_DATABASE_PASSWORD` for the one-shot writer. `INGESTION_ALLOW_TABLE_OWNER` defaults to `false`; set it to `true` only when the ingestion login is intentionally the owner of the existing project tables.
- PostgreSQL connection settings provisioned locally; do not copy credentials into Vercel or Git

The runtime never creates a database, applies migrations, seeds markets, or changes the existing market list. It treats the installed schema and its contents as the authority.

## Install and run on the Pi

```sh
cd raspberry-pi
cp .env.example .env
# Fill the local database settings in .env using the operator's secure configuration process.
npm ci
npm test
npm run validate
npm start
```

`npm run validate` performs the read-only startup preflight and exits without listening. `npm start` validates first, then starts the local API on `127.0.0.1:3002`. No credentials or connection strings are printed. TLS certificate verification is enabled by default; `DATABASE_SSL=false` is accepted only for loopback database hosts.

## API endpoints

- `GET /api/v1/health/live` — process liveness only.
- `GET /api/v1/health/ready` — coarse read-only database readiness; it does not expose database, schema, or market details.
- `GET /api/v1/health/operational` — bounded runtime/resource counters, protected by the `admin` role and denied by default.
- `GET /api/v1/markets` — enabled watched-market rows, ordered by priority then symbol.
- `GET /api/v1/market?symbol=BTC-EUR&interval=1m&limit=200` — one enabled market's stored snapshot and bounded newest-first candle history.
- `GET /api/v1/dashboard-data` — bounded status, watched-market, snapshot, and recent-decision data; not a full dashboard parity response.
- `GET /api/v1/agent-status` — existing `{ "data": { "status": "..." } }` response; missing/unknown status is `null`.
- `GET /api/v1/market-summary` — stored enabled-market/snapshot counts and rows; no scanner rankings or refresh.

Data routes are authenticated through the existing provider interface and fail closed by default. All errors use a bounded JSON envelope with a request ID. Security headers and `Cache-Control: no-store` are applied. CORS origins default to empty; configuration accepts HTTPS origins or loopback HTTP origins only. Unsafe methods require an exact allowed Origin and a session-bound CSRF token. Rate limiting uses the socket peer address and does not trust forwarded headers.

Authentication integration, OIDC, login/registration, password reset, session-creation endpoints, and admin actions are not implemented. The API remains loopback-only; do not expose it through an Internet-facing proxy.

## Layout

- `src/api/` — built-in Node HTTP server, health/data routes, middleware, validation, and error handling.
- `src/runtime/` — API startup validation and graceful lifecycle only; no scheduler or trading worker.
- `src/services/` — database-contract, watched-market, readiness, Bitvavo public client, and one-shot ingestion orchestration.
- `src/repositories/` — parameterized, bounded PostgreSQL access for contracts, watched markets, market reads, ingestion writes, AI decisions, and runtime status.
- `src/auth/` — provider-neutral authentication, authorization, and in-memory session interfaces; no identity provider.
- `src/database/` — bounded `pg` pool plus explicit read-only and write transaction helpers.
- `src/monitoring/` — health responses, bounded operational snapshots, and request counters.
- `src/config/` — strict runtime environment parsing.
- `tests/` — isolated Node.js tests; no remote database or schema setup.
- `docs/` — implementation and operational notes for this runtime foundation.

The runtime-specific specification is in [docs/runtime-foundation.md](docs/runtime-foundation.md). The [Phase 4 implementation report](docs/phase-4-implementation-report.md) records the current API scope and validation; the [Phase 5 implementation report](docs/phase-5-implementation-report.md) records ingestion scope and validation; the [Phase 5.2 report](docs/phase-5.2-ingestion-contract-alignment.md) documents the explicit table-owner opt-in.

For environment variables, PostgreSQL contract checks, and validation commands, see the [deployment and validation guide](docs/phase-2-deployment-validation.md).
