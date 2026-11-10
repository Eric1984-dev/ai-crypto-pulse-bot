# CryptoPulse Raspberry Pi Runtime Foundation

This folder is an isolated Node.js runtime foundation for the existing Raspberry Pi PostgreSQL database. It is not part of the Vercel dashboard and is excluded from Vercel deployment inputs.

## Phase 2 scope

The current implementation is a read-only bootstrap and local health API. Startup validates database identity, a bounded read-only role, required schema/function contracts, and the complete enabled `AI_Crypto_Bot_Watched_Markets` set. It does not import Supabase data, run migrations, alter schema, write rows, start a scheduler, analyze markets, or execute paper trades.

Authentication migration and OIDC are out of scope. `src/auth/` is reserved only; there are no login, session, user-data, or admin endpoints. The API binds to loopback by default and exposes only health and local diagnostics.

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

`npm run validate` performs the same startup preflight and exits without listening. `npm start` validates first, then starts the health API on `127.0.0.1:3002`. No credentials or connection strings are printed. TLS certificate verification is enabled by default; `DATABASE_SSL=false` is accepted only for loopback database hosts.

## Local endpoints

- `GET /api/v1/health/live` — process liveness only.
- `GET /api/v1/health/ready` — read-only database connectivity plus startup contract status.
- `GET /api/v1/health/diagnostics` — bounded process, pool, and validation diagnostics. The server is loopback-only; do not expose this route through an Internet-facing proxy.

No dashboard or operational data endpoint is implemented in Phase 2. There is no CORS/authentication layer because the server is intentionally local-only; changing the bind address or publishing the API requires a separately approved, authenticated API phase.

## Layout

- `src/api/` — built-in Node HTTP health server.
- `src/runtime/` — startup validation and graceful lifecycle only; no scheduler or trading worker.
- `src/services/` — contract, watched-market, readiness, and diagnostic services.
- `src/repositories/` — parameterized, read-only PostgreSQL catalog and market queries.
- `src/auth/` — reserved; authentication implementation is explicitly out of scope.
- `src/database/` — bounded `pg` pool and read-only transaction helper.
- `src/monitoring/` — health responses and secret-safe diagnostics.
- `src/config/` — strict runtime environment parsing.
- `tests/` — isolated Node.js unit/integration-contract tests; no remote database or schema setup.
- `docs/` — implementation and operational notes for this runtime foundation.

The runtime-specific specification is in [docs/runtime-foundation.md](docs/runtime-foundation.md). Phase reporting is stored in the repository's [docs/reports/](../docs/reports/) directory.

For the exact Pi-side install, environment variables, expected output, PostgreSQL contract inventory, and Phase 2 acceptance checklist, see the [Phase 2 deployment and validation guide](docs/phase-2-deployment-validation.md).
