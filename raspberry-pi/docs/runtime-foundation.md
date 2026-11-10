# Raspberry Pi runtime and read-only API

## Scope and ownership

The package is an isolated Node.js runtime for the existing Raspberry Pi PostgreSQL database. Phase 4 adds read-only repositories and API endpoints only. No schema or data migration, writes, market seeding, ingestion, scanner ranking, AI, analytics, scheduler, paper trading, live trading, or Vercel dashboard cutover is included.

The user-confirmed Pi findings are authoritative for this phase: the existing schema/data are installed; approximately 102 enabled watched markets and AI-decision history exist; no runtime PostgreSQL functions are installed; and `AI_Crypto_Bot_Candles` currently has no history. The runtime does not assume or invoke PostgreSQL functions. An empty candle result remains empty and never triggers data collection.

## Lifecycle and database access

1. Parse database/API configuration, enforce loopback binding and `ENABLE_LIVE_TRADING=false`.
2. Create the `pg` pool capped at four with TLS verification by default and `default_transaction_read_only=on`.
3. Perform read-only startup checks for database identity, role/privileges, required existing tables/columns/keys, and the complete bounded enabled watched-market set.
4. If a configuration, database, schema, privilege, or market-contract check fails, do not listen; close the pool and exit unsuccessfully.
5. On success, expose the HTTP API on loopback. No background worker or scheduler starts.
6. On `SIGINT` or `SIGTERM`, stop accepting requests and close the pool.

Every repository operation uses `BEGIN READ ONLY`/`COMMIT` and explicitly selected columns. SQL values—including symbols, intervals, and limits—are passed as parameters. Repository failures are logged with a safe error code and returned as generic `503` responses. No raw SQL, database error message, credential, or error detail is returned to the caller.

## Read-only repositories and result bounds

| Repository | Existing table(s) | Bound |
|---|---|---:|
| Watched markets | `AI_Crypto_Bot_Watched_Markets` | At most 500 enabled markets; overflow fails closed. |
| Market data and candles | `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Candles` | At most 500 snapshots and 500 candles; one market query is constrained to an enabled symbol. |
| AI decisions | `AI_Crypto_Bot_AI_Decisions` | Most recent 5 for dashboard foundation; repository hard cap 100. |
| Runtime status | `AI_Crypto_Bot_Status` | At most one singleton row. |

Market-list ordering is database-defined as `priority ASC, symbol ASC`. The application does not consult `config/markets.js`, a hardcoded symbol list, or any fallback market configuration.

## API endpoints

All data endpoints use the existing authentication middleware and return the common `{ "data": ... }` wrapper on success. Query parameters not declared by an endpoint, repeated parameters, invalid symbols/intervals/limits, and disabled/untracked symbols are rejected.

| Method and path | Behavior |
|---|---|
| `GET /api/v1/markets` | Returns `{ "data": { "count": n, "items": [...] } }` for enabled watched-market rows. |
| `GET /api/v1/market?symbol=BTC-EUR&interval=1m&limit=200` | Returns the existing market shape: `symbol`, `interval`, `marketData` (nullable), `candles` (newest first), and `refreshStatus: "read-only"`. Defaults are `1m` and `200`; supported intervals are `1m`, `5m`, `15m`, `1h`, `4h`, `1d`; the maximum candle limit is 500. Missing/malformed symbol is `400`; disabled and nonexistent symbols both return `404 MARKET_NOT_TRACKED`. |
| `GET /api/v1/dashboard-data` | Returns the existing `generatedAt`, `agentStatus`, `lastMarketDataAt`, `watchedMarkets`, and `aiDecisions` shapes plus bounded `marketData`. It is intentionally partial: it does not fabricate portfolio, positions, trades, emergency, snapshots, shadow-exit, or analytics values. |
| `GET /api/v1/agent-status` | Returns `{ "data": { "status": "ACTIVE\|ANALYZING\|IDLE\|STOPPED\|ERROR" } }`; missing or unknown status is `null`. |
| `GET /api/v1/market-summary` | Returns stored active/data-bearing counts, market snapshot items, `refreshedAt`, and `refreshStatus: "read-only"`. No scanner rankings or refresh is performed. |

An empty result is represented by the real empty/null stored state (for example `candles: []`, `marketData: null`, or `status: null`). It is not replaced with synthetic trading/dashboard values. The `market-summary` scanner-ranking subtree is deliberately absent: ranking logic is not migrated in this phase, and no candle history is currently present. This API has not been wired into the existing frontend.

## Security

- The API binds only to loopback; do not expose it through a public proxy or tunnel.
- The default authentication provider denies access. Data routes therefore return `401` until a trusted provider is injected; provider integration, OIDC, login, registration, password reset, and session creation remain outside scope.
- CORS defaults to an empty exact-origin allowlist. HTTPS origins or loopback HTTP origins can be configured, but wildcard origins are rejected.
- Unsafe methods require an exact allowed Origin and a session-bound CSRF token; this phase registers only GET data routes.
- Request validation rejects unknown/repeated query keys; error responses contain only a safe code, generic message, and request ID.
- Security headers and `Cache-Control: no-store` are applied. Rate limiting uses socket peer addresses and does not trust forwarded headers.

## Validation and limitations

Tests use local PostgreSQL mocks and an injected trusted identity for successful data-route calls. They assert read-only transaction boundaries, explicit `SELECT` columns, parameterized limits/values, disabled-market filtering, empty-result behavior, bounded failures, and the absence of writes. Tests do not independently verify the live Pi database, network connectivity, Node.js ARM compatibility, or Pi resource headroom.

No Supabase calls were added to the Raspberry Pi API. Existing Vercel/Supabase endpoints remain unchanged and continue to exist until a separately approved dashboard-cutover phase. Authentication, real Pi endpoint access, market ingestion, scanner ranking, full dashboard parity, and production validation remain open.
