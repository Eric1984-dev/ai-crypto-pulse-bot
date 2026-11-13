# Raspberry Pi runtime, API, ingestion, AI, and paper trading

## Scope and ownership

The package is an isolated Node.js runtime for the existing Raspberry Pi PostgreSQL database. The Phase 4 API remains read-only. Phase 5's one-shot Bitvavo ingestion and Phase 6's one-shot AI command remain available for explicit operation; Phase 7 also wires them into the long-running Node.js runtime with paper-only trade processing.

The runtime uses only the existing `AI_Crypto_Bot_Watched_Markets` universe and existing PostgreSQL tables. The paper worker applies stored AI decisions and one position-aware ATR trailing exit; it does not invoke the experimental shadow-exit evaluator, database AI, or exchange order functions. The paper role reads 5-minute candles for the exit ATR and updates persisted high-water/stop state. The API, ingestion, AI, and paper-trading roles are separately validated; the latter three use bounded worker connections. No schema creation, migration, seed, live trade, or private exchange API is performed by the runtime.

## Lifecycle and database access

1. Parse configuration, enforce loopback binding and `ENABLE_LIVE_TRADING=false`.
2. Create the API pool (two connections maximum), acquire the exclusive PostgreSQL session advisory lock, and validate the API contract.
3. Validate ingestion and AI identities/contracts with one short-lived connection each. Open a one-connection paper writer pool and validate its exact existing-table grants.
4. Require the singleton status row. A leftover `ANALYZING` state is changed to `ERROR`; `STOPPED` is never cleared automatically.
5. Start the API and an in-process scheduler. UTC cycles run every five minutes and do not replay missed slots. The API pool is capped at two connections including its reserved owner-lock connection, the paper pool at one, and the sequential worker pool at one; total concurrent PostgreSQL connections remain at most four.
6. Each cycle runs market ingestion, AI analysis, paper trading (including the active position-exit policy), then a non-destructive retention plan. A failed ingestion or AI stage skips dependent downstream stages; safely partial per-market ingestion can continue to AI.
7. On `SIGINT` or `SIGTERM`, stop scheduling, wait up to 120 seconds for the active cycle, preserve `STOPPED`, set status to `IDLE` only when safe, release the lock, and close pools.

The `npm run ingest:market-data -- --intervals=...` command separately validates the existing ingestion contract, reads enabled watched markets, and runs one snapshot/candle pass. It uses no Vercel function, HTTP trigger, external scheduler, or `systemd` timer. Each write uses an explicit `BEGIN READ WRITE` transaction; API repositories continue to use `BEGIN READ ONLY`. No write targets the watched-market table. Database/provider failures are logged with safe codes; credentials and raw error details are never logged.

## Phase 7 scheduler and paper trading

The internal scheduler aligns to five-minute UTC slots. It runs snapshot refresh each cycle and requests candles on the current defaults: `1m` every five minutes, `5m` every fifteen minutes, `15m` every thirty minutes, `1h` hourly, `4h` every four hours, and `1d` daily. The `1h`, `4h`, and `1d` active production cadences were not independently verified; confirm them against the external scheduler before cutover. Missed slots are skipped; bounded ingestion checkpoints advance only during later normal cycles.

A process-level session advisory lock (`882018082`) prevents a second runtime instance and is checked at pipeline-stage boundaries. Losing the lock stops further scheduling. Paper runs also take a separate transaction-level lock (`882018081`) and persist a deterministic idempotency key for each portfolio/decision pair. BUY sizing and SELL accounting keep numeric arithmetic in PostgreSQL. The runtime honors confidence, position count/size, cooldown, market freshness, daily/portfolio drawdown, emergency stop, fees, and slippage rules. It never uses an authenticated Bitvavo API.

The retention service creates a plan for candle and AI-decision age cutoffs but issues no `DELETE` or other data-removal statement. Its deletion flag remains false until a separately authorized implementation changes that policy.

The systemd sample is `deploy/cryptopulse-runtime.service`. systemd starts and restarts the single Node service; it is not a timer and does not trigger pipeline cycles.

## Read-only repositories and result bounds

| Repository | Existing table(s) | Bound |
|---|---|---:|
| Watched markets | `AI_Crypto_Bot_Watched_Markets` | At most 500 enabled markets; overflow fails closed. |
| Market data and candles | `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Candles` | At most 500 snapshots and 500 candles; one market query is constrained to an enabled symbol. |
| AI decisions | `AI_Crypto_Bot_AI_Decisions` | Most recent 5 for dashboard foundation; repository hard cap 100. |
| Runtime status | `AI_Crypto_Bot_Status` | At most one singleton row. |
| Shadow exits | `AI_Crypto_Bot_Shadow_Exit_Scenarios`, `AI_Crypto_Bot_Shadow_Exit_Events` | Up to 350 scenario rows, with up to 10 latest events per scenario; dashboard queries are read-only and optional failures are reported independently. |
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
| `GET /api/v1/dashboard-data` | Returns portfolio and current dashboard data, plus up to 350 shadow-exit scenario rows grouped by position and the latest 10 events per scenario. It includes open positions awaiting their first fresh mark and tracked positions closed within 30 days. Shadow data failures return `shadowExitScenarios.status: "UNAVAILABLE"` without hiding actual portfolio data. |
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
