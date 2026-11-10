# Phase 2 — Deployment and validation guide

## Scope and safety

This procedure installs and manually starts the read-only Raspberry Pi foundation for validation. It is **not** a production cutover or a complete bot deployment:

- The process performs read-only database preflight and serves local health endpoints only.
- It does not create a database, apply schema, migrate/import data, write records, change markets, run a scheduler, analyze markets, or execute paper/live trades.
- The API binds to `127.0.0.1`; do not change the bind address, create a public tunnel, or connect Vercel to it. Authentication provider integration, login, and OIDC are not implemented. The provider interface is deny-all by default.
- No `systemd` unit or timer is supplied. Run it in the foreground for validation and stop it manually.
- Keep credentials in the Pi's untracked `raspberry-pi/.env`. Do not send them in chat, add them to Git, or put them in Vercel.

The package requires Node.js `>=20.6` and uses the existing PostgreSQL database/schema. Do not run any migration or database setup command.

## 1. Check out and prepare the package on the Pi

SSH into the Raspberry Pi using the operator's normal account, then go to the repository checkout. Replace the example checkout path with the actual path on the Pi:

```sh
cd /path/to/ai-crypto-pulse-bot/raspberry-pi
node --version
npm --version
```

`node --version` must report `v20.6.0` or newer. Create the local environment file only if it does not already exist; do not overwrite an existing Pi configuration:

```sh
if [ ! -f .env ]; then cp .env.example .env; fi
chmod 600 .env
```

Edit `.env` locally with the Pi's secure editor/process, for example `nano .env`. Do not paste the password into a command argument or into this guide.

## 2. Configure environment variables

### Required values

| Variable | Required value |
|---|---|
| `DATABASE_HOST` | Hostname/IP of the already-existing Pi PostgreSQL server. Use a loopback address only if PostgreSQL is on the same host. |
| `DATABASE_NAME` | Exact name of the already-existing database. The validator compares it to `current_database()`. |
| `DATABASE_USER` | Exact PostgreSQL login used by the runtime. The validator compares it to `current_user`; use the intended restricted read-only role. |
| `DATABASE_PASSWORD` | Password for that login. Keep it only in the local ignored `.env`. |
| `ENABLE_LIVE_TRADING` | Must be `false`. The code defaults to false if omitted, but set it explicitly. `true` prevents startup. |

### Optional values and defaults

| Variable | Default | Accepted values / purpose |
|---|---:|---|
| `DATABASE_PORT` | `5432` | Integer `1`–`65535`. |
| `DATABASE_SSL` | `true` | `true` or `false`. Keep TLS verification enabled for a remote database. `false` is allowed only when `DATABASE_HOST` is loopback (`localhost`, `::1`, or `127.x.x.x`). |
| `DATABASE_SSL_CA_PATH` | empty | Optional path on the Pi to a trusted CA file; requires `DATABASE_SSL=true`. |
| `DATABASE_SSL_SERVERNAME` | empty | Optional TLS server name when it differs from `DATABASE_HOST`. |
| `API_HOST` | `127.0.0.1` | Must resolve to a loopback literal/name. `0.0.0.0` and LAN/public addresses are rejected. |
| `API_PORT` | `3002` | Integer `1024`–`65535`; `3002` avoids the existing archive health service's default port `3001`. |
| `API_CORS_ORIGINS` | empty | Comma-separated exact HTTPS origins; loopback HTTP origins are permitted for development. Wildcards and paths are rejected. Empty means no browser origin is allowed. |
| `API_SESSION_TTL_MS` | `28800000` | In-memory session lifetime in milliseconds; integer `60000`–`86400000`. No endpoint creates sessions. |
| `API_SESSION_MAX` | `1000` | Maximum in-memory sessions; integer `1`–`10000`. |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds; integer `1000`–`3600000`. |
| `API_RATE_LIMIT_MAX_REQUESTS` | `60` | Requests per socket peer per window; integer `1`–`1000`. Forwarded client-IP headers are not trusted. |
| `PG_POOL_MAX` | `4` | Integer `1`–`4`; this is the maximum runtime pool size. |
| `PG_CONNECTION_TIMEOUT_MS` | `2000` | Integer `100`–`30000`. |
| `PG_QUERY_TIMEOUT_MS` | `5000` | Integer `100`–`30000`. |
| `PG_IDLE_TIMEOUT_MS` | `10000` | Integer `100`–`60000`. |

The pool sets PostgreSQL's `default_transaction_read_only=on`, and every validation/read transaction also uses `BEGIN READ ONLY`. An invalid/missing required setting, invalid range, unsafe TLS configuration, non-loopback API host, or live-trading enablement makes startup fail closed.

## 3. Install and run the local checks

From `raspberry-pi/`:

```sh
npm ci
npm test
npm run validate
```

Expected results:

1. `npm ci` exits with status `0` and installs the pinned dependencies from `package-lock.json`.
2. `npm test` exits with status `0`. The Phase 3 package suite currently reports `24` tests; test totals may change as tests are added. These tests use local mocks; they do **not** prove connectivity to the Pi database.
3. `npm run validate` connects to the configured existing database, performs the read-only preflight, and exits with status `0`. It prints one JSON line in this shape (the optional function value and market count depend on the database):

```json
{"event":"runtime_validation_passed","validation":{"database":"connected","contracts":"valid","requiredTables":18,"requiredFunctions":0,"optionalFunctions":{"AI_Crypto_Bot_Run_Database_AI_Analysis":"not-installed"},"enabledMarkets":102}}
```

The Pi's approximately 102 enabled markets are read from the existing table and are not changed. `enabledMarkets` reports the number actually read; it is not required to equal exactly 102. No runtime database function is required, installed, or invoked by this phase.

If validation fails, the command exits nonzero and prints `runtime_validation_failed` with a safe error code and, for schema-contract failures, a `contractErrors` array. Examples include `RUNTIME_CONTRACT_INVALID`, `WATCHED_MARKETS_INVALID`, `ECONNREFUSED`, or a PostgreSQL authentication code. Do not treat a successful unit-test run as a substitute for this live check.

## 4. Start and check the local runtime

Only continue after `npm run validate` succeeds. Start the server in the foreground:

```sh
npm start
```

Expected startup output is one JSON line similar to:

```json
{"event":"runtime_started","host":"127.0.0.1","port":3002,"validation":{"database":"connected","contracts":"valid","requiredTables":18,"requiredFunctions":0,"optionalFunctions":{"AI_Crypto_Bot_Run_Database_AI_Analysis":"not-installed"},"enabledMarkets":102}}
```

The process stays in the foreground. In a second SSH shell on the Pi, run:

```sh
curl -fsS http://127.0.0.1:3002/api/v1/health/live
curl -fsS http://127.0.0.1:3002/api/v1/health/ready
curl -i http://127.0.0.1:3002/api/v1/health/operational
```

Expected outputs:

```json
{"data":{"status":"live"}}
{"data":{"status":"ready"}}
HTTP/1.1 401 Unauthorized
{"error":{"code":"UNAUTHENTICATED","message":"Authentication is required.","requestId":"<request-id>"}}
```

Operational health is protected and intentionally unavailable without a trusted provider; there is no login flow in this phase. The readiness response must be HTTP `200` with `"status":"ready"`. Liveness alone only proves that the HTTP process responds; it does not prove database readiness.

Stop the foreground process with `Ctrl+C`. Expected shutdown output:

```json
{"event":"runtime_stopped","signal":"SIGINT"}
```

`SIGTERM` is also handled. Do not leave a second copy running; this Phase 2 package has no singleton scheduler or production service manager.

## 5. PostgreSQL objects and properties checked

All checks run in read-only transactions against schema `public`. The runtime inspects functions in PostgreSQL catalogs but **never invokes any database function**.

### Connection and role

- `current_database()` must equal `DATABASE_NAME`; `current_user` must equal `DATABASE_USER`.
- `default_transaction_read_only` and `transaction_read_only` must both be `on`.
- The current role must not be a superuser, have `BYPASSRLS`, `CREATEDB`, or `CREATEROLE`, or have `CREATE` on schema `public`.
- The runtime must not own or have `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` on any discovered `public.AI_Crypto_Bot_*` ordinary or partitioned table.
- It must not own or have `USAGE`/`UPDATE` on any discovered prefixed sequence.
- It must have `SELECT` on the five read tables: `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Candles`, `AI_Crypto_Bot_AI_Decisions`, and `AI_Crypto_Bot_Status`.

### Required prefixed tables

The catalog check requires these 18 existing ordinary/partitioned tables:

1. `AI_Crypto_Bot_Profiles`
2. `AI_Crypto_Bot_Portfolios`
3. `AI_Crypto_Bot_Positions`
4. `AI_Crypto_Bot_Trades`
5. `AI_Crypto_Bot_AI_Decisions`
6. `AI_Crypto_Bot_Status`
7. `AI_Crypto_Bot_Watched_Markets`
8. `AI_Crypto_Bot_Market_Data`
9. `AI_Crypto_Bot_Candles`
10. `AI_Crypto_Bot_Strategies`
11. `AI_Crypto_Bot_Strategy_Changes`
12. `AI_Crypto_Bot_Strategy_Performance`
13. `AI_Crypto_Bot_Backtests`
14. `AI_Crypto_Bot_Portfolio_Snapshots`
15. `AI_Crypto_Bot_Scanner_Events`
16. `AI_Crypto_Bot_Emergency_State`
17. `AI_Crypto_Bot_Shadow_Exit_Scenarios`
18. `AI_Crypto_Bot_Shadow_Exit_Events`

### Required column and key contracts

The validator checks these specific columns and data types:

- `AI_Crypto_Bot_Watched_Markets`: `id uuid`, `symbol text`, `enabled boolean`, `priority integer`, `created_at timestamp with time zone`, `updated_at timestamp with time zone`.
- `AI_Crypto_Bot_Market_Data`: `symbol text`, `price numeric`, `volume numeric`, `daily_change numeric`, `high_24h numeric`, `low_24h numeric`, `captured_at timestamp with time zone`.
- `AI_Crypto_Bot_Candles`: `symbol text`, `interval text`, `open/high/low/close/volume numeric`, `timestamp timestamp with time zone`.
- `AI_Crypto_Bot_AI_Decisions`: `id uuid`, `symbol text`, `decision text`, `confidence numeric`, `indicators jsonb`, `reason text`, `created_at timestamp with time zone`.
- `AI_Crypto_Bot_Status`: `singleton boolean`, `is_active boolean`, `is_analyzing boolean`, `status text`, `last_run timestamp with time zone`, `updated_at timestamp with time zone`.

It also requires these primary/unique key column sets:

- `AI_Crypto_Bot_Watched_Markets`: primary key `(id)` and unique `(symbol)`.
- `AI_Crypto_Bot_Candles`: unique `(symbol, interval, timestamp)`.
- `AI_Crypto_Bot_AI_Decisions`: primary key `(id)`.

### Runtime functions

The Phase 2 audit had listed expected PostgreSQL functions, but subsequent Pi validation confirmed that no runtime PostgreSQL functions are installed. Phase 3 therefore no longer requires or invokes any runtime function. The preflight may inspect the optional `AI_Crypto_Bot_Run_Database_AI_Analysis` name in PostgreSQL catalogs for compatibility reporting, but its absence is accepted and no function is executed.

### Deliberate limits of this preflight

The validator is a runtime contract check, not an exhaustive audit of the full schema. It does not validate every column in all 18 tables, views, indexes, foreign keys, check constraints, triggers, row-level-security policy behavior, or function `EXECUTE` grants. It checks only the column/key contracts listed above, the listed table/sequence privileges, and enabled-market row shape. A successful result does not certify every object or historical row in PostgreSQL.

### Existing watched-market rows

The runtime reads only enabled rows from `public."AI_Crypto_Bot_Watched_Markets"` using `SELECT id, symbol, enabled, priority ... WHERE enabled IS TRUE ORDER BY priority, symbol`. It requires at least one result and validates UUID format, uppercase `BASE-QUOTE` symbol format, `enabled = true`, positive integer priority, and unique IDs/symbols. The startup output reports the count, not the symbol list; it does not compare symbols with a separate historical baseline or enforce exactly 100 markets.

## 6. Phase 2 acceptance checklist

Phase 2 may be marked successful only after all of the following are true:

- [ ] Node.js is `>=20.6`, `.env` is local and protected, `ENABLE_LIVE_TRADING=false`, and the API remains bound to loopback.
- [ ] `npm ci` and `npm test` both exit `0`.
- [ ] `npm run validate` exits `0` against the intended existing Pi database and reports `database:"connected"`, `contracts:"valid"`, `requiredTables:18`, `requiredFunctions:0`, and the expected nonzero enabled-market count.
- [ ] The actual market count is compared with the operator's known existing enabled-market count. The runtime validates rows but does not print or baseline-compare the complete symbol set.
- [ ] `npm start` reports `runtime_started`; `/health/live` and `/health/ready` return HTTP `200`. `/health/operational` returns `401` without an injected trusted authentication provider.
- [ ] The process stops cleanly with `Ctrl+C`; no Vercel deployment, remote exposure, schema/data change, scheduled execution, or trading order occurred.

A local mock test, successful build, liveness response alone, or a connection to a different database is not sufficient. If the live preflight fails, preserve the error code/contract error list (without secrets), stop, and investigate the existing database configuration/schema read-only. Do not “fix” a mismatch by applying migrations or changing tables/markets during Phase 2.
