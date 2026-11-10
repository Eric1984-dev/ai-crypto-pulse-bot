# CryptoPulse Raspberry Pi Runtime Foundation

This folder is an isolated Node.js runtime for the existing Raspberry Pi PostgreSQL database. It is not part of the Vercel dashboard and is excluded from Vercel deployment inputs.

## Phase 3 scope

The current implementation is a read-only runtime and API foundation. Startup validates database identity, a bounded read-only role, required table/column/key contracts, and the enabled `AI_Crypto_Bot_Watched_Markets` set. Runtime PostgreSQL functions are not required or invoked. The Pi validation found no installed runtime functions and no candle history; neither is a Phase 3 startup dependency.

The API has static routes, middleware, bounded error responses, CORS/CSRF frameworks, in-memory session and provider interfaces, role authorization, request logging/metrics, and fixed-window rate limiting. No identity provider, OIDC, login, registration, password reset, session-creation endpoint, operational data API, or dashboard business logic is implemented. Authentication is deny-all by default; operational health is Admin-only and therefore returns `401` unless a trusted provider is explicitly injected. CORS is disabled by default, and the API remains loopback-only.

The runtime does not import Supabase data, run migrations, alter schema, write rows, start a scheduler, analyze markets, or execute paper/live trades. It continues to read the existing watched-market list without changing it.

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

## Foundation endpoints

- `GET /api/v1/health/live` — process liveness only.
- `GET /api/v1/health/ready` — coarse read-only database readiness; it does not expose database, schema, or market details.
- `GET /api/v1/health/operational` — bounded runtime/resource counters, protected by the `admin` role and denied by default.

All errors use a bounded JSON envelope with a request ID. Security headers and `Cache-Control: no-store` are applied. CORS origins default to empty; configuration accepts HTTPS origins or loopback HTTP origins only. Unsafe methods require an exact allowed Origin and a session-bound CSRF token. Rate limiting uses the socket peer address and does not trust forwarded headers.

Authentication integration, OIDC, login/registration, password reset, session-creation endpoints, and admin actions are not implemented. The API remains loopback-only; do not expose it through an Internet-facing proxy.

## Layout

- `src/api/` — built-in Node HTTP server, static routes, middleware, validation, and error handling.
- `src/runtime/` — startup validation and graceful lifecycle only; no scheduler or trading worker.
- `src/services/` — database-contract, watched-market, and readiness services.
- `src/repositories/` — parameterized, read-only PostgreSQL catalog and market queries.
- `src/auth/` — provider-neutral authentication, authorization, and in-memory session interfaces; no identity provider.
- `src/database/` — bounded `pg` pool and read-only transaction helper.
- `src/monitoring/` — health responses, bounded operational snapshots, and request counters.
- `src/config/` — strict runtime environment parsing.
- `tests/` — isolated Node.js tests; no remote database or schema setup.
- `docs/` — implementation and operational notes for this runtime foundation.

The runtime-specific specification is in [docs/runtime-foundation.md](docs/runtime-foundation.md). Phase reporting is in the repository's [migration report](../docs/migration/phase-3-implementation-report.md).

For environment variables, PostgreSQL contract checks, and validation commands, see the [deployment and validation guide](docs/phase-2-deployment-validation.md).
