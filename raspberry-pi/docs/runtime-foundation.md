# Raspberry Pi runtime, read-only API, and market ingestion

## Scope and ownership

The package is an isolated Node.js runtime for the existing Raspberry Pi PostgreSQL database. Phase 5 adds a manually invoked, one-shot Bitvavo market-data ingestion command. It does not start from the API process, install a scheduler, or expose an ingestion endpoint. The Phase 4 API remains read-only.

The current user-confirmed Pi state is approximately 102 enabled watched markets, no candle history, no AI-decision history, and no PostgreSQL runtime functions. The API does not assume or invoke runtime functions. Ingestion builds candle history from bounded Bitvavo requests; it does not generate AI decisions.

## Lifecycle and database access

1. Parse database/API configuration, enforce loopback binding and `ENABLE_LIVE_TRADING=false`.
2. Create the `pg` pool capped at four with TLS verification by default and `default_transaction_read_only=on`.
3. API startup performs read-only checks for database identity, role/privileges, required existing tables/columns/keys, and the complete bounded enabled watched-market set.
4. If a configuration, database, schema, privilege, or market-contract check fails, do not listen; close the pool and exit unsuccessfully.
5. On success, expose the HTTP API on loopback. No background worker or scheduler starts.
6. On `SIGINT` or `SIGTERM`, stop accepting requests and close the pool.

The `npm run ingest:market-data -- --intervals=...` command separately validates the existing ingestion contract, reads enabled watched markets, and runs one snapshot/candle pass. It uses no Vercel function, HTTP trigger, external scheduler, or `systemd` timer. Each write uses an explicit `BEGIN READ WRITE` transaction; API repositories continue to use `BEGIN READ ONLY`. No write targets the watched-market table. Database/provider failures are logged with safe codes; credentials and raw error details are never logged.

## Read-only repositories and result bounds

| Repository | Existing table(s) | Bound |
|---|---|---:|
| Watched markets | `AI_Crypto_Bot_Watched_Markets` | At most 500 enabled markets; overflow fails closed. |
| Market data and candles | `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Candles` | At most 500 snapshots and 500 candles; one market query is constrained to an enabled symbol. |
| AI decisions | `AI_Crypto_Bot_AI_Decisions` | Most recent 5 for dashboard foundation; repository hard cap 100. |
| Runtime status | `AI_Crypto_Bot_Status` | At most one singleton row. |
| Ingestion snapshots | `AI_Crypto_Bot_Market_Data` | Upsert the latest snapshot for each existing symbol; the existing unique symbol key prevents snapshot history. |
| Ingestion candles | `AI_Crypto_Bot_Candles` | At most 500 fetched candles per market/interval and 100 stored rows per write chunk. |
| Ingestion failure events | `AI_Crypto_Bot_Scanner_Events` | Best-effort, bounded event inserts for missing/invalid provider data and persistence failures. |

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

## Market-data ingestion

### Provider and market source

- The provider adapter uses only public `https://api.bitvavo.com/v2` GET endpoints: `/ticker/24h` and `/{symbol}/candles`.
- No API key, private account endpoint, or exchange order endpoint is used.
- Each run obtains the complete enabled market list from `public."AI_Crypto_Bot_Watched_Markets"` in priority/symbol order. No market catalog, seed, config list, or symbol fallback is consulted. Existing market rows are never written.
- Ticker payloads are capped at 2,000 entries and 2 MiB. Each candle request is capped at 500 rows and 2 MiB, with an 8-second timeout.

### Batching, checkpointing, and storage

- Every enabled market is processed. A batch contains at most five markets; 102 markets therefore require 21 batches per interval.
- Candle requests are sequential by interval and use at most four concurrent per-market workers. Each candle response is held only for its market and written in chunks of at most 100 rows.
- When a market/interval has no stored checkpoint, ingestion requests at most the latest 500 candles. For existing history, it starts at the latest stored timestamp and requests only the bounded number needed to advance, capped at 500. Longer gaps require a later explicit run; there is no unbounded backfill.
- All six intervals are supported: `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`. The CLI requires an explicit interval selection. `--intervals=all` may produce up to 612 candle API requests for 102 markets (plus the single ticker request), and a first pass can store up to 306,000 candle rows. Operators should begin with selected intervals and measure Pi resource use.
- Candle writes update a matching `(symbol, interval, timestamp)` row or insert it. The standard path uses the existing unique key. If that legacy constraint is absent, a bounded transaction obtains a table write lock, updates matching rows, and inserts only keys not already present; no table or constraint is created. Duplicate keys already present in an inconsistent database are not deleted or repaired.
- The existing snapshot table has a unique `symbol` key and stores one latest row per market. The ingestion command updates that row, so persistent snapshot history is not available without a prohibited schema change.
- Bitvavo errors or invalid data for one market do not discard successful markets. A 429 or provider-wide 5xx stops queued requests for the affected interval/run; existing stored rows remain unchanged. Database connection/permission failures stop further persistence and make the command exit non-zero.

### Validation and role findings

- API startup retains its strict read-only contract.
- Ingestion performs a separate read-only preflight. It warns—but does not stop—on missing legacy constraints and write-capable table/sequence grants, and does not require PostgreSQL runtime functions. It still requires the existing tables/columns, correct database identity, safe role properties, and `INSERT`/`UPDATE` capability on the existing snapshot and candle tables. Table ownership remains rejected by default; `INGESTION_ALLOW_TABLE_OWNER=true` explicitly permits ownership of known project tables for ingestion only, with a warning. The API's read-only contract is unchanged.
- The ingestion command may use the paired `INGESTION_DATABASE_USER` and `INGESTION_DATABASE_PASSWORD` settings, leaving the API's `DATABASE_USER` read-only. If those optional settings are absent, it uses `DATABASE_USER`; the API's strict read-only preflight will not accept that writer identity. Owner opt-in requires the separate ingestion identity and cannot fall back to `DATABASE_USER`.
- The one-shot AI analysis command requires separate `AI_DATABASE_USER` and `AI_DATABASE_PASSWORD` credentials. Its non-owner role may read the five existing runtime read-contract tables and insert into `AI_Crypto_Bot_AI_Decisions`; it may not update, delete, truncate, own project tables, or write other tables. The command is not started by the API runtime and does not schedule future analysis.
- Writes use only parameterized SQL against existing market-data, candle, and best-effort scanner-event tables. No `CREATE`, `ALTER`, `DELETE`, `TRUNCATE`, market-list update, or project runtime-function call is issued.
- Ingestion is not scheduled or started by `npm start`; running the one-shot command is an explicit operator action.

## Security

- The API binds only to loopback; do not expose it through a public proxy or tunnel.
- The default authentication provider denies access. Data routes therefore return `401` until a trusted provider is injected; provider integration, OIDC, login, registration, password reset, and session creation remain outside scope.
- CORS defaults to an empty exact-origin allowlist. HTTPS origins or loopback HTTP origins can be configured, but wildcard origins are rejected.
- Unsafe methods require an exact allowed Origin and a session-bound CSRF token; this phase registers only GET data routes.
- Request validation rejects unknown/repeated query keys; error responses contain only a safe code, generic message, and request ID.
- Security headers and `Cache-Control: no-store` are applied. Rate limiting uses socket peer addresses and does not trust forwarded headers.

## Validation and limitations

Tests use local PostgreSQL mocks and an injected trusted identity for successful data-route calls. They assert read-only transaction boundaries, explicit `SELECT` columns, parameterized limits/values, disabled-market filtering, empty-result behavior, bounded failures, and the absence of writes. Tests do not independently verify the live Pi database, network connectivity, Node.js ARM compatibility, or Pi resource headroom.

Market-ingestion tests additionally cover the 102-market/21-batch model, all supported intervals, checkpoints, request and write bounds, duplicate protection, and per-market failure isolation. An ephemeral PGlite integration check exercised snapshot/candle upsert and the no-unique-constraint fallback; it did not connect to or alter the Raspberry Pi database.

No Supabase calls were added to the Raspberry Pi package. Existing Vercel/Supabase endpoints remain unchanged until a separately approved dashboard-cutover phase. Authentication, real Pi endpoint access, scanner ranking, full dashboard parity, scheduler integration, and production validation remain open.
