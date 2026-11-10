# Phase 2 — Raspberry Pi Runtime Foundation

## Outcome

Implemented an isolated `raspberry-pi/` Node.js package that provides a read-only runtime foundation for the already-existing Pi PostgreSQL database. It starts only after strict configuration, database/schema/function/grant preflight, and validation of the existing enabled watched-market rows. It provides loopback-only liveness, readiness, and bounded diagnostics endpoints.

This is not a complete or production-ready trading runtime. It does not run scheduler cycles, market-data ingestion, AI analysis, paper trading, dashboard data APIs, authentication, or OIDC. It performs no DDL, inserts, updates, deletes, seed, migration, Supabase import, Vercel deployment, or live trading.

## Implementation

- Added the isolated `raspberry-pi/` package, `pg` dependency and lockfile, Node `>=20.6` engine, local environment example, and setup instructions.
- Added strict configuration with a maximum four-connection pool, bounded timeouts, verified TLS by default, loopback-only API binding, and mandatory `ENABLE_LIVE_TRADING=false`.
- Added `default_transaction_read_only=on` plus explicit `BEGIN READ ONLY` transaction handling. Failed rollbacks discard their PostgreSQL client.
- Added read-only PostgreSQL catalog checks for the expected database and role, 18 existing prefixed tables, required columns/constraints/functions, and effective project-table/sequence write privileges. Database functions are inspected but never executed.
- Added a read-only query of enabled rows from `public."AI_Crypto_Bot_Watched_Markets"`; no market list is seeded or altered.
- Added fail-closed startup, graceful HTTP/pool shutdown, loopback health API, secret-safe bounded diagnostics, and a standalone validation command.
- Excluded `/raspberry-pi/` from Vercel deployment inputs. Authentication implementation and OIDC remain explicitly out of scope.

## Validation

| Check | Result |
|---|---|
| `npm install --ignore-scripts --no-audit --no-fund` in `raspberry-pi/` | Passed; created the isolated lockfile and installed the declared dependency. |
| `npm test` in `raspberry-pi/` | Passed: 14 tests, 0 failures, 0 skipped. |
| Root `npm test` | Passed: 376 tests, 0 failures, 0 skipped. |
| Root `npm run build` | Passed: static project validation and database migration validation (18 prefixed tables, RLS coverage, initial seed consistency). |
| Live Pi PostgreSQL connection and schema/market preflight | Not run: no Pi database connection configuration was available in the local environment. |
| Vercel deployment / Pi deployment | Not run; neither was requested or authorized. |

The contract tests use a local PostgreSQL protocol mock; they do not prove that the configured Pi database satisfies the contracts. Therefore the production connectivity/schema acceptance criteria remain blocked pending an operator-configured read-only connection and execution of `npm run validate` against the Pi database.

## Documentation

Updated the migration status, roadmap, API scope correction, project README and changelog; added local runtime setup and API documentation under `raspberry-pi/docs/`.

## Files changed

- `.vercelignore`
- `README.md`, `ROADMAP.md`, `docs/CHANGELOG.md`
- `docs/migration/README.md`, `docs/migration/architecture.md`, `docs/migration/roadmap.md`, `docs/migration/api-architecture.md`
- `raspberry-pi/` package, runtime source, focused tests, and setup documentation

## Acceptance status

The isolated runtime, local contract validation, watched-market validation, fail-closed behavior, and health API are implemented and covered by tests. Phase 2 is **not fully accepted** because actual Pi PostgreSQL connectivity and read-only production validation have not been performed. No schema or market data was changed.
