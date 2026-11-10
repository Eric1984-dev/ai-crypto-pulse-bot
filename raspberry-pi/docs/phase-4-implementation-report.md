# Phase 4 – Read-Only Data API Migration

## Scope delivered

Implemented a PostgreSQL-backed, read-only API layer inside `raspberry-pi/`. The active market universe continues to come exclusively from `public."AI_Crypto_Bot_Watched_Markets"`. Existing tables, functions, views, and data were not changed. No business logic, market ingestion, scheduler, AI execution, paper trading, analytics, dashboard cutover, or live trading was added.

## Repositories

- `WatchedMarketsRepository`: reads enabled markets and verifies that a requested symbol is enabled.
- `MarketDataRepository`: reads stored market snapshots and candles for enabled markets.
- `AiDecisionsRepository`: reads a bounded set of recent AI decisions.
- `RuntimeStatusRepository`: reads the existing runtime status row.
- `postgres-read.mjs`: shared read-only transaction and result validation helpers.

Repository SQL uses `pg`, parameterized values, explicit column lists, and bounded results. Each read is run in a read-only transaction. No `SELECT *`, writes, or PostgreSQL runtime-function calls are used.

Configured limits include 500 enabled markets, 500 snapshots/candles per query, and at most 100 recent decisions (the dashboard response requests 5). An enabled-market result beyond the configured bound fails closed rather than silently truncating the market universe.

## Endpoints

All five endpoints use the existing middleware and the common `{ "data": ... }` success envelope.

| Endpoint | Behavior |
|---|---|
| `GET /api/v1/markets` | Returns the enabled watched markets as `{data:{count,items}}`. |
| `GET /api/v1/market?symbol=...` | Returns the requested enabled market, stored snapshot, and bounded candles; supports validated interval and limit parameters. Disabled and unknown symbols both return `404 MARKET_NOT_TRACKED`. |
| `GET /api/v1/dashboard-data` | Returns available runtime status, watched markets, snapshots, and recent decisions. It does not synthesize unavailable portfolio, position, trade, emergency, or analytics values. |
| `GET /api/v1/agent-status` | Preserves `{data:{status}}`; a missing or unknown stored status is represented as `null`. |
| `GET /api/v1/market-summary` | Returns counts and stored market snapshots; it does not calculate scanner rankings. |

Empty stored data is represented by empty arrays or `null` as appropriate. Missing/malformed parameters, repeated or unknown query parameters, invalid intervals/limits, and untracked symbols are rejected. Repository and database errors return safe service-unavailable responses without exposing database details.

## Security and response parity

- Data routes remain behind the Phase 3 authentication and authorization middleware. The default provider denies requests, so data endpoints return `401` until a trusted provider is explicitly supplied. Tests inject a trusted test identity; no login or identity provider was implemented.
- The runtime remains loopback-only; CORS remains disabled by default.
- Existing status and market response fields are retained where available. The market response identifies itself as read-only and does not imply a refresh occurred.
- The dashboard endpoint is deliberately partial because no Pi-side portfolio/trading/analytics repositories were migrated in this phase.
- The market summary reports stored data only; it does not reproduce the existing scanner ranking logic.

## Validation results

| Check | Result |
|---|---|
| Raspberry Pi package tests (`npm.cmd --prefix raspberry-pi test`) | Passed: 35 tests, 0 failures. |
| Repository tests (`npm.cmd test`) | Passed: 397 tests, 0 failures. |
| Build validation (`npm.cmd run build`) | Passed: static project validation and database migration validation. |
| Pi JavaScript syntax (`node --check`) | Passed: 44 `.mjs` files under `raspberry-pi/src` and `raspberry-pi/tests`. |
| `git diff --check` | Passed. |
| Lint | Not run; the Pi package and root package do not define a lint script. |
| Live Pi database / HTTP validation | Not run in this phase. The database repositories were validated with test doubles; this report does not claim a new production connectivity check. |

Tests cover bounded/parameterized SQL, read-only transactions, route contracts, invalid and disabled symbols, empty results, authentication denial, and safe database failures.

## Assumptions and limitations

- The existing Phase 2 schema and its required columns remain installed as previously validated; startup contract validation now includes the AI-decision strategy columns selected by the repository.
- Database reads were tested using mocks, not against the live Pi database. The actual runtime must still be exercised on the Pi before relying on API responses.
- Numeric database values are converted to JavaScript numbers for JSON responses, so extremely high-precision numeric values may lose precision.
- Queries are bounded but do not expose pagination. If the enabled universe grows beyond the configured cap, the request fails closed and the cap/contract must be deliberately revisited.
- Because the default authentication provider denies access, successful data API use requires a separately authorized trusted-provider integration. Authentication implementation remains out of scope.
- The Pi currently has no candle history according to the Phase 2 validation findings, so candle responses may be empty until a later authorized phase provides stored data.

## Risks and remaining work for Phase 5

The API is not yet a dashboard replacement: it lacks portfolio, positions, trades, analytics, and scanner-ranking data, and the dashboard has not been switched to the Pi API. The data routes are not externally usable with the default deny-all authentication provider. Stored candles may be empty.

Phase 5 should be separately authorized and scoped to the next migration objective. Before dashboard cutover, validate these repository queries against the live Pi schema and data, decide the authorized authentication boundary, and implement only the additional read/write or ingestion components explicitly included in that phase. No Phase 5 work was started here.
