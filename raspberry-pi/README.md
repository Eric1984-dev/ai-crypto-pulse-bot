# CryptoPulse Raspberry Pi Runtime Foundation

This folder is an isolated Node.js runtime for the existing Raspberry Pi PostgreSQL database. It is not part of the Vercel dashboard and is excluded from Vercel deployment inputs.

## Phase 5 scope

In addition to the Phase 4 read-only API, the package now includes an explicitly invoked, one-shot market-data ingestion command. It fetches public Bitvavo 24-hour tickers and candles, then persists snapshots and candles to the existing PostgreSQL tables. The command reads enabled markets only from `AI_Crypto_Bot_Watched_Markets`; it does not consult the configured market list or Bitvavo's market catalog.

Run a deliberate ingestion pass from this directory after configuring the existing database connection:

```sh
npm run ingest:market-data -- --intervals=1m
npm run ingest:market-data -- --intervals=all
```

An interval must be selected explicitly. The command handles every enabled market in batches of at most five, uses at most four concurrent provider requests, fetches no more than 500 candles per market/interval request, and writes candles in chunks of at most 100. It exits after one pass and does not start a scheduler. A first `--intervals=all` run can request up to 306,000 candles for 102 markets; start with selected intervals and monitor Pi resources.

The existing `AI_Crypto_Bot_Market_Data` schema has a unique key on `symbol`, so it can retain only the latest snapshot per market. Ingestion upserts that row; snapshot history cannot be retained without changing the existing schema, which this phase prohibits. Candle rows remain historical and are checkpointed incrementally. No Supabase migration, schema change, market mutation, AI run, paper trade, or dashboard cutover is performed.

The read-only API remains loopback-only and authenticated routes remain denied by the default provider. Its endpoints and intentionally partial dashboard response are unchanged.

Data routes require an authenticated identity from the Phase 3 middleware. The default provider denies access, so these routes return `401` until a trusted provider is supplied. Provider integration, OIDC, login, registration, password reset, and session creation remain out of scope. The API is loopback-only; CORS is disabled by default.

The API and worker stages do not import Supabase data, run migrations, alter schema, seed or change markets, or invoke PostgreSQL runtime functions. The explicit ingestion CLI writes snapshots, candles, and best-effort scanner failure events. The explicit AI CLI writes AI decisions only. `npm start` runs the integrated Phase 7 pipeline; it is the only command that starts the scheduler and paper trading.

## Phase 6 scope

Run the deterministic V2 analysis once, explicitly, after configuring the separate AI database role:

```sh
npm run ai:analyze
```

The command reads enabled markets only from `AI_Crypto_Bot_Watched_Markets`, and reads existing snapshots and up to 150 newest candles per market for each of the six supported intervals. It processes at most four markets in memory at a time, calculates the existing EMA, RSI, MACD, momentum, volume, volatility, V2 score, confidence, freshness, and BUY/SELL/HOLD/WAIT outcome, then persists the complete decision set in one transaction. Duplicate inputs are idempotent; an existing deterministic decision ID with a different payload fails the run. There is no AI API endpoint, scheduler, status mutation, paper trade, or exchange order.

The existing decision table has no interval column. Decisions remain one per market using the existing multi-timeframe V2 strategy; `indicators.interval` records the strategy's daily anchor (`1d`), while `indicators.timeframes` contains the results for each interval. `created_at` is the decision timestamp. No schema change is made.

`AI_DATABASE_USER` and `AI_DATABASE_PASSWORD` are required for this command and must identify a dedicated, non-owner role distinct from both `DATABASE_USER` and `INGESTION_DATABASE_USER`. The AI role needs `CONNECT` to the existing database, `USAGE` on `public`, `SELECT` on the existing watched-markets, market-data, candles, AI-decisions, and status tables, and `INSERT` on `AI_Crypto_Bot_AI_Decisions` only. It must not own tables, have sequence or other write privileges, or have elevated role attributes. The command checks this contract before analysis. Do not reuse the table-owner ingestion login for AI.

The AI command is a manual one-shot operation. It does not backfill or refresh candles, modify status, start a scheduler, alter the schema, or enable live trading. Keep `ENABLE_LIVE_TRADING=false`.

## Phase 7 scope

`npm start` validates the existing API, ingestion, AI, and paper-writer database contracts, obtains the PostgreSQL runtime-owner lock, starts the loopback API, and schedules one pipeline every five minutes. Each cycle refreshes snapshots and due candles, runs one complete AI analysis, then evaluates paper trades using direct parameterized SQL. Live trading remains disabled and no private Bitvavo endpoint or order path is used.

The paper engine preserves the existing rules: 10% maximum position size, five open positions, minimum BUY confidence 70, 15-minute cooldown, 0.25% fee, 0.10% slippage, 5% daily drawdown, 15% portfolio drawdown, and a 20% emergency stop. It uses existing tables only; it does not create schema objects or market rows. A failed ingestion or AI stage prevents downstream execution. Partial per-market ingestion can continue to AI so existing freshness safeguards can reject stale inputs.

Paper trading uses only the standalone system profile and has no Supabase Auth or `auth.users` dependency. Apply the [Phase 7.6 schema migration](migrations/phase-7.6-standalone-system-profile.sql), then the [Phase 7.7 bootstrap migration](migrations/phase-7.7-system-profile-bootstrap.sql) to the existing `ai_crypto_bot_store` database as its schema owner. Phase 7.7 creates a missing system profile, portfolio, and first snapshot transactionally; a repeated run preserves existing balances and history. Runtime startup still does not provision or repair database records, and paper trading skips safely if the account is absent or invalid. See the [Phase 7.7 operational validation report](docs/phase-7.7-operational-validation.md).

The scheduler is process-local, UTC-aligned, non-overlapping, and guarded by a session advisory lock. Lost lock ownership terminates the runtime with a failure so systemd can restart it. The service uses `Restart=always`; deliberate `systemctl stop` remains stopped. `systemd` starts/restarts the one runtime service but does not schedule cycles. The retention service only emits a policy plan; it never deletes data. Starter candle cadences are 1m every five minutes, 5m every fifteen minutes, 15m every thirty minutes, 1h hourly, 4h every four hours, and 1d daily. The external production cadences for 1h/4h/1d were not independently verified; confirm them before cutover.

The runtime requires a dedicated, non-owner `PAPER_DATABASE_USER` and `PAPER_DATABASE_PASSWORD`, distinct from the API, ingestion, and AI roles. `npm start` validates all four role contracts at startup. See the [Phase 7 implementation report](docs/phase-7-implementation-report.md) for exact existing-table grants, scheduler assumptions, systemd deployment steps, and validation status. The sample systemd unit is [deploy/cryptopulse-runtime.service](deploy/cryptopulse-runtime.service).

## Requirements

- Node.js 20.6 or newer
- Network access from the Pi runtime to the already-existing PostgreSQL instance
- PostgreSQL settings for the existing database. Keep `DATABASE_USER` read-only for the API; configure separate paired credentials for ingestion, AI analysis, and paper trading. `INGESTION_ALLOW_TABLE_OWNER` defaults to `false`; set it to `true` only when the ingestion login is intentionally the owner of the existing project tables.
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

`npm run validate` performs the API read-only preflight and exits without listening. `npm start` validates all runtime role contracts, then starts the local API on `127.0.0.1:3002` and the internal scheduler. No credentials or connection strings are printed. TLS certificate verification is enabled by default; `DATABASE_SSL=false` is accepted only for loopback database hosts.

## API endpoints

- `GET /api/v1/health/live` — process liveness only.
- `GET /api/v1/health/ready` — coarse read-only database readiness; it does not expose database, schema, or market details.
- `GET /api/v1/health/operational` — bounded runtime/resource counters and last-cycle ingestion, AI, and paper-trading stage outcomes, protected by the `admin` role and denied by default.
- `GET /api/v1/markets` — enabled watched-market rows, ordered by priority then symbol.
- `GET /api/v1/market?symbol=BTC-EUR&interval=1m&limit=200` — one enabled market's stored snapshot and bounded newest-first candle history.
- `GET /api/v1/dashboard-data` — bounded status, watched-market, snapshot, and recent-decision data; not a full dashboard parity response.
- `GET /api/v1/agent-status` — existing `{ "data": { "status": "..." } }` response; missing/unknown status is `null`.
- `GET /api/v1/market-summary` — stored enabled-market/snapshot counts and rows; no scanner rankings or refresh.

Data routes are authenticated through the existing provider interface and fail closed by default. All errors use a bounded JSON envelope with a request ID. Security headers and `Cache-Control: no-store` are applied. CORS origins default to empty; configuration accepts HTTPS origins or loopback HTTP origins only. Unsafe methods require an exact allowed Origin and a session-bound CSRF token. Rate limiting uses the socket peer address and does not trust forwarded headers.

Authentication integration, OIDC, login/registration, password reset, session-creation endpoints, and admin actions are not implemented. The API remains loopback-only; do not expose it through an Internet-facing proxy.

## Layout

- `src/api/` — built-in Node HTTP server, health/data routes, middleware, validation, and error handling.
- `src/runtime/` — API startup, worker-stage orchestration, bounded pools, lock ownership, and graceful lifecycle.
- `src/services/` — database contracts, public Bitvavo ingestion, deterministic AI analysis, paper trading, UTC scheduling, and non-destructive retention planning.
- `src/repositories/` — parameterized, bounded PostgreSQL access for API reads, ingestion, AI decisions, and paper portfolios/positions/trades.
- `src/auth/` — provider-neutral authentication, authorization, and in-memory session interfaces; no identity provider.
- `src/database/` — bounded `pg` pool plus explicit read-only and write transaction helpers.
- `src/monitoring/` — health responses, bounded operational snapshots, and request counters.
- `src/config/` — strict runtime environment parsing.
- `tests/` — isolated Node.js tests; no remote database or schema setup.
- `docs/` — implementation and operational notes for this runtime foundation.

The runtime-specific specification is in [docs/runtime-foundation.md](docs/runtime-foundation.md). The [Phase 4 implementation report](docs/phase-4-implementation-report.md) records the API scope; the [Phase 5 implementation report](docs/phase-5-implementation-report.md) records ingestion; the [Phase 5.2 report](docs/phase-5.2-ingestion-contract-alignment.md) documents the ingestion owner opt-in; the [Phase 5.4 report](docs/phase-5.4-ingestion-user-resolution.md) resolves API/ingestion identities; the [Phase 6 implementation report](docs/phase-6-implementation-report.md) records AI analysis; the [Phase 7 report](docs/phase-7-implementation-report.md) records scheduler, paper trading, and retention; and the [Phase 7.6 report](docs/phase-7.6-standalone-system-profile.md) documents standalone paper-account provisioning.

For environment variables, PostgreSQL contract checks, and validation commands, see the [deployment and validation guide](docs/phase-2-deployment-validation.md).
