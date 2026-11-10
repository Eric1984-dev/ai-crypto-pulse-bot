# CryptoPulse Raspberry Pi Runtime Foundation

This folder is an isolated Node.js runtime for the existing Raspberry Pi PostgreSQL database. It is not part of the Vercel dashboard and is excluded from Vercel deployment inputs.

## Phase 4 scope

The runtime exposes PostgreSQL-backed read-only routes for enabled watched markets, a single enabled market's stored snapshot/candles, a partial dashboard data foundation, agent status, and a stored market summary. Repositories use explicit columns, parameterized SQL, read-only transactions, and bounded result limits. The existing enabled `AI_Crypto_Bot_Watched_Markets` table is the only market-universe source.

No scanner ranking calculations, portfolio aggregation, AI, market ingestion, scheduler, analytics, or trading logic is migrated. The dashboard response is deliberately partial and does not invent portfolio fields. Market summaries contain stored snapshot counts/data only; the scanner-ranking subtree is not implemented. Existing Vercel/Supabase endpoints and the dashboard have not been cut over.

Data routes require an authenticated identity from the Phase 3 middleware. The default provider denies access, so these routes return `401` until a trusted provider is supplied. Provider integration, OIDC, login, registration, password reset, and session creation remain out of scope. The API is loopback-only; CORS is disabled by default.

The runtime does not import Supabase data, run migrations, alter schema, write rows, seed or change markets, start a scheduler, analyze markets, or execute paper/live trades. No PostgreSQL runtime function is required or invoked, and absent candle history produces an empty candle list rather than triggering ingestion.

## Requirements

- Node.js 20.6 or newer
- Network access from the Pi runtime to the already-existing PostgreSQL instance
- A dedicated PostgreSQL login configured with `SELECT` access to the required existing objects and no project-table or schema write privileges
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
- `src/runtime/` — startup validation and graceful lifecycle only; no scheduler or trading worker.
- `src/services/` — database-contract, watched-market, and readiness services.
- `src/repositories/` — parameterized, bounded, read-only PostgreSQL queries for contracts, watched markets, market data/candles, AI decisions, and runtime status.
- `src/auth/` — provider-neutral authentication, authorization, and in-memory session interfaces; no identity provider.
- `src/database/` — bounded `pg` pool and read-only transaction helper.
- `src/monitoring/` — health responses, bounded operational snapshots, and request counters.
- `src/config/` — strict runtime environment parsing.
- `tests/` — isolated Node.js tests; no remote database or schema setup.
- `docs/` — implementation and operational notes for this runtime foundation.

The runtime-specific specification is in [docs/runtime-foundation.md](docs/runtime-foundation.md). The [Phase 4 implementation report](docs/phase-4-implementation-report.md) records the current API scope and validation.

For environment variables, PostgreSQL contract checks, and validation commands, see the [deployment and validation guide](docs/phase-2-deployment-validation.md).
