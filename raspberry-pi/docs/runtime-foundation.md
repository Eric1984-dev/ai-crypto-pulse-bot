# Raspberry Pi runtime foundation

## Phase 2 scope and current status

This package is an isolated, read-only Node.js foundation for the existing Raspberry Pi PostgreSQL database. It validates runtime configuration, database/schema contracts, the existing enabled watched-market rows, and exposes a loopback-only health API. It does not import data, run migrations, write database rows, schedule work, analyze markets, or execute paper trades.

Authentication implementation and OIDC are explicitly out of scope. The API binds only to loopback; it must not be exposed through an Internet-facing proxy. The health endpoints are not dashboard or operational-data APIs.

The local automated contract tests use a PostgreSQL protocol mock. No Pi connection settings were available in the development environment, so live database identity, schema, functions, grants, market rows, and network connectivity remain unverified. Phase 2 production-connection acceptance therefore remains blocked.

## Startup and fail-closed behavior

1. Parse required database settings and bounded resource settings; reject non-loopback API binds, unsafe plaintext remote database access, and `ENABLE_LIVE_TRADING=true`.
2. Create a `pg` pool capped at four connections, with TLS verification enabled by default and `default_transaction_read_only=on`.
3. In explicit `BEGIN READ ONLY` transactions, verify database identity and read-only role properties, the 18 existing prefixed tables, required column/constraint/function contracts, and absence of database writes privileges.
4. Read only the existing enabled rows from `public."AI_Crypto_Bot_Watched_Markets"`. Do not seed, normalize, insert, update, or delete markets.
5. If any configuration, database, contract, privilege, or market validation fails, do not listen for requests; close the pool and exit unsuccessfully.
6. On success, listen on the configured loopback address. `SIGINT` and `SIGTERM` stop the HTTP server and close the pool. No worker or scheduler is started.

## Configuration and commands

Copy `.env.example` to a local `.env`, then provision the existing Pi database connection values using the operator's secure local process. Never commit `.env` or paste secrets into source control.

```sh
npm ci
npm test
npm run validate
npm start
```

`npm run validate` runs preflight and exits without opening an HTTP listener. `npm start` starts the local health API only after successful preflight. The example uses port `3002` to avoid the existing archive health service on `3001`.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/health/live` | Process liveness; does not assert database readiness. |
| `GET` | `/api/v1/health/ready` | Bounded read-only database check and startup contract status. |
| `GET` | `/api/v1/health/diagnostics` | Local process, memory, pool, and validation counters; never returns connection details or credentials. |

Other paths return `404`; non-GET requests return `405`. Responses are JSON, non-cacheable, and do not expose raw PostgreSQL errors. No authentication, OIDC, CORS exposure, dashboard data, or admin action is implemented.

## Database contract

The checks are read-only and use catalog queries plus the existing watched-market read. They verify the database name and configured role, enforce a read-only transaction mode, reject elevated roles and project-table write ownership/privileges, and require the expected prefixed relations and function signatures. Functions are inspected, never invoked.

The enabled market table is the source of truth. Startup requires at least one well-formed enabled row and rejects duplicate IDs/symbols, disabled rows in the result, invalid priorities, or invalid stored symbol/UUID formats. Market IDs and symbols are returned only in-memory as validated startup state; the diagnostics endpoint reports only the count.

The runtime does not connect to Supabase, issue exchange requests, or open live or paper trades. No schema or data setup is provided by this package.

## Resource and deployment boundaries

- Node.js `>=20.6`; `pg` is the only runtime dependency.
- PostgreSQL pool maximum is four; connection, query, and idle timeouts are bounded in `src/config/runtime-config.mjs`.
- API bind is restricted to loopback; port defaults to `3002`.
- The package is excluded from Vercel inputs through the root `.vercelignore`.
- The Pi host, PostgreSQL network access, OS/ARM Node build, and resource headroom must be verified before an operator deployment.
- This foundation is not a phase-complete runtime and must not be used to claim production readiness.
