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

The paper engine preserves the existing rules: 10% maximum position size, nine open positions, minimum BUY confidence 70, 15-minute cooldown, 0.25% fee, 0.10% slippage, 5% daily drawdown, 15% portfolio drawdown, and a 20% emergency stop. It uses existing tables only; it does not create schema objects or market rows. A failed ingestion or AI stage prevents downstream execution. Partial per-market ingestion can continue to AI so existing freshness safeguards can reject stale inputs.

Paper trading uses only the standalone system profile and has no Supabase Auth or `auth.users` dependency. Apply the [Phase 7.6 schema migration](migrations/phase-7.6-standalone-system-profile.sql), then the [Phase 7.7 bootstrap migration](migrations/phase-7.7-system-profile-bootstrap.sql) to the existing `ai_crypto_bot_store` database as its schema owner. Phase 7.7 creates a missing system profile, portfolio, and first snapshot transactionally; a repeated run preserves existing balances and history. Runtime startup still does not provision or repair database records, and paper trading skips safely if the account is absent or invalid. See the [Phase 7.7 operational validation report](docs/phase-7.7-operational-validation.md).

The scheduler is process-local, UTC-aligned, non-overlapping, and guarded by a session advisory lock. Lost lock ownership terminates the runtime with a failure so systemd can restart it. The service uses `Restart=always`; deliberate `systemctl stop` remains stopped. `systemd` starts/restarts the one runtime service but does not schedule cycles. The retention service only emits a policy plan; it never deletes data. Starter candle cadences are 1m every five minutes, 5m every fifteen minutes, 15m every thirty minutes, 1h hourly, 4h every four hours, and 1d daily. The external production cadences for 1h/4h/1d were not independently verified; confirm them before cutover.

The runtime requires a dedicated, non-owner `PAPER_DATABASE_USER` and `PAPER_DATABASE_PASSWORD`, distinct from the API, ingestion, and AI roles. `npm start` validates all four role contracts at startup. See the [Phase 7 implementation report](docs/phase-7-implementation-report.md) for exact existing-table grants, scheduler assumptions, systemd deployment steps, and validation status. The sample systemd unit is [deploy/cryptopulse-runtime.service](deploy/cryptopulse-runtime.service).

## Shadow-exit simulation

The paper-trading runtime invokes the existing `AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios()` database function before paper processing and again after a cycle that executes trades. Each invocation uses its own transaction and the function's advisory lock. Shadow exits only record hypothetical outcomes; they do not execute trades, modify real paper positions, or affect risk decisions. Evaluator failures are logged and surfaced as `lastCycle.stages.shadowExits` by `/api/v1/monitoring`, but do not roll back or block paper trading.

Phase 8.10 only grants the dashboard API read access; it does not install the evaluator. If the evaluator is missing (for example, PostgreSQL returns SQLSTATE `42883`), apply the [Phase 8.11 evaluator installation migration](migrations/phase-8.11-shadow-exit-evaluator-installation.sql) as the database schema owner. It installs only the Pi-compatible function and grants execution to the exact `PAPER_DATABASE_USER` role configured in the Pi's local `.env`:

```sh
cd raspberry-pi
psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store <<'SQL'
SELECT pg_catalog.set_config(
  'cryptopulse.paper_database_user',
  'YOUR_PAPER_DATABASE_USER',
  false
);
\i migrations/phase-8.11-shadow-exit-evaluator-installation.sql
SQL
```

The migration requires the existing positions, trades, market-data, and shadow-exit tables; it does not create or alter tables. It fails if the evaluator already exists, the migration owner cannot securely access its required tables, or the configured paper role is privileged. The function is installed as `SECURITY DEFINER` with a pinned empty `search_path`; the paper role receives schema usage and function execution only, not direct shadow-table access. Do not apply the legacy Supabase migration wholesale to the Pi. If the evaluator already exists, use the [Phase 8.9 permission migration](migrations/phase-8.9-shadow-exit-runtime-permissions.sql) instead. After applying the appropriate migration, restart the Pi runtime and check `GET /api/v1/monitoring`; the latest cycle should report `shadowExits: "COMPLETED"` or `"SKIPPED"`. No rows are expected until there are open positions and fresh market data. See the [shadow-exit reactivation report](docs/reports/shadow-exit-reactivation.md) for implementation and local validation evidence.

The evaluator must also use an advisory-lock key distinct from the runtime ownership lock. Apply the [Phase 8.12 lock-isolation migration](migrations/phase-8.12-shadow-exit-lock-isolation.sql) as the evaluator owner on databases where Phase 8.11 was already applied. It changes only the evaluator's transaction-level lock key; the runtime ownership lock remains unchanged. This prevents the runtime's own scheduler lock from making every shadow evaluation return `SKIPPED`. The database change takes effect immediately; no runtime code deployment or restart is required, and the next five-minute cycle should report `COMPLETED`.

The authenticated dashboard reads these records through the API's read-only `DATABASE_USER`. Apply the [Phase 8.10 dashboard-read permission migration](migrations/phase-8.10-shadow-exit-dashboard-read.sql) as the database schema owner, setting `cryptopulse.dashboard_database_user` to the exact `DATABASE_USER` configured on the Pi:

```sh
cd raspberry-pi
psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store <<'SQL'
SELECT pg_catalog.set_config(
  'cryptopulse.dashboard_database_user',
  'YOUR_DATABASE_USER',
  false
);
\i migrations/phase-8.10-shadow-exit-dashboard-read.sql
SQL
```

This grants `SELECT` only on the two shadow-exit tables and fails if the configured API role is privileged, owns either table, or has table-write privileges. It does not grant shadow-table access to the browser or dashboard session. The dashboard shows current open positions, recently closed tracked positions, scenario states, and recent per-scenario events; it cannot reconstruct a price peak that occurred before tracking began or between observed market snapshots.

## systemd deployment profile

The checked-in [systemd unit](deploy/cryptopulse-runtime.service) matches the Raspberry Pi deployment reported as passing runtime validation, restart validation, and reboot validation:

```ini
User=eric
Group=eric
WorkingDirectory=/home/eric/ai-crypto-pulse-bot/raspberry-pi
EnvironmentFile=/home/eric/ai-crypto-pulse-bot/raspberry-pi/.env
ProtectHome=false
```

These are validated host-specific settings, not portable defaults. The live service required `ProtectHome=false` because its files are under `/home/eric`.

**Future recommended production deployment (not the validated deployment):** migrate to a dedicated non-root `cryptopulse` account, install the runtime under `/opt/cryptopulse/raspberry-pi`, and keep secrets in a root-owned, service-group-readable `/etc/cryptopulse/runtime.env`. With the runtime outside `/home`, `ProtectHome=true` can be used. This relocation and unit profile have not been implemented or validated; do not substitute them for the currently validated paths without a planned migration and fresh restart/reboot checks. See the [live validation addendum](docs/phase-7.7.2-live-validation-addendum.md).

## Requirements

- Node.js 20.6 or newer
- Network access from the Pi runtime to the already-existing PostgreSQL instance
- PostgreSQL settings for the existing database. Keep `DATABASE_USER` read-only for the API; configure separate paired credentials for ingestion, AI analysis, and paper trading. `INGESTION_ALLOW_TABLE_OWNER` defaults to `false`; set it to `true` only when the ingestion login is intentionally the owner of the existing project tables.
- PostgreSQL connection settings provisioned locally; do not copy credentials into Vercel or Git
- Optional paired `ANALYTICS_DATABASE_USER` and `ANALYTICS_DATABASE_PASSWORD` for the manual analytics-history generator only

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
- `GET /api/v1/health/operational` — bounded runtime/resource counters and last-cycle ingestion, AI, paper-trading, and shadow-exit stage outcomes, protected by the `admin` role and denied by default.
- `POST /api/v1/auth/login`, `GET /api/v1/auth/session`, and `DELETE /api/v1/auth/session` — single-admin login, session lookup, and CSRF-protected session revocation.
- `GET /api/v1/markets` — enabled watched-market rows, ordered by priority then symbol.
- `GET /api/v1/market?symbol=BTC-EUR&interval=1m&limit=200` — one enabled market's stored snapshot and bounded newest-first candle history.
- `GET /api/v1/dashboard-data` — system portfolio, positions, recent trades, snapshots, watched markets, latest decisions and runtime state.
- `GET /api/v1/dashboard-data?view=trade-history&page=1` — filtered, sorted and paginated trade history.
- `GET /api/v1/dashboard-data?view=ai-history&page=1` — paginated AI decisions with reasoning and indicator payloads.
- `GET /api/v1/dashboard-data?view=analytics&period=30d` — paper-trade, AI decision and portfolio analytics for `30d`, `90d` or `365d`; decision counts are aggregated in PostgreSQL so high-volume history does not exceed the row-transfer limit.
- `GET /api/v1/dashboard-data?view=recommendations&period=30d` — advisory recommendations computed from current analytics, with sample-size confidence and comparison to the latest earlier matching run when available.
- `GET /api/v1/dashboard-data?view=analytics-history&period=30d` — bounded read-only history of persisted analytics and recommendation generations.
- `GET /api/v1/dashboard-data?view=analysis-bundle&period=30d&limit=500` — authenticated JSON bundle with manifest, bounded linked source rows, decision-anchored candle windows, shadow-exit comparisons and stored run history.
- `GET /api/v1/dashboard-data?view=export-count&type=trades&period=7d` and `view=export` — bounded CSV export counts and downloads.
- `GET /api/v1/agent-status` — existing `{ "data": { "status": "..." } }` response; missing/unknown status is `null`.
- `GET /api/v1/market-summary` — scanner rankings and summaries computed from stored watched markets, snapshots, candles and decisions; no refresh or trading.
- `GET /api/v1/monitoring` — runtime status, last-cycle stages including shadow-exit evaluation, uptime, Node/process and host metrics, PostgreSQL size and estimated table row counts.

## Phase 11 historical analytics

The analytics API remains read-only. Analytics history is generated only by an explicit operator command; it is not generated on dashboard reads or by the scheduler:

See the [Phase 11.1 analytics writer role activation procedure](docs/phase-11.1-analytics-role-activation.md)
for the PostgreSQL role, minimum grants, Pi environment variables, migration,
and validation steps.

```sh
npm run analytics:generate -- --period=30d
npm run analytics:generate -- --period=90d --as-of=2026-03-31T00:00:00.000Z
```

The command reads source records with the existing read-only `DATABASE_USER` and writes one summary row with a separate `ANALYTICS_DATABASE_USER`. That writer must be a restricted login, distinct from the API, ingestion, AI-analysis, and paper-trading roles. It receives `INSERT` only on `AI_Crypto_Bot_Analytics_Runs`; it cannot read or modify source data. The API role receives `SELECT` only on the history table. Neither role owns the table or can create public-schema objects. Leave the optional analytics credentials unset for normal runtime operation; generation fails explicitly until the migration and writer role are configured.

Apply the Phase 11 migration as the existing database schema owner, setting the exact configured role names:

```sh
cd raspberry-pi
psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store <<'SQL'
SELECT pg_catalog.set_config('cryptopulse.dashboard_database_user', 'YOUR_DATABASE_USER', false);
SELECT pg_catalog.set_config('cryptopulse.analytics_database_user', 'YOUR_ANALYTICS_DATABASE_USER', false);
SELECT pg_catalog.set_config('cryptopulse.paper_trading_database_user', 'YOUR_PAPER_DATABASE_USER', false);
\i migrations/phase-11-analytics-history.sql
SQL
```

The migration intentionally fails on an existing table/index collision. It creates only the prefixed analytics-run table and generated-at index, and verifies the dashboard `SELECT`-only and analytics-writer `INSERT`-only grants. The paper-trading role is not granted access to analytics history.

Generation uses a UTC window ending at the supplied `--as-of` timestamp. A deterministic run ID and unique calculation-version/window key make retries of the same window idempotent; use the same `--as-of` to reproduce a run key. Runs retain the analytics calculation version, period boundaries, generation time, source counts, calculated metrics, strategy-version metrics and advisory insights. Runs are retained indefinitely; there is no automatic pruning or raw-source duplication.

The metric contract uses SELL `realized_pnl` as recorded (the paper engine already deducts fees and execution slippage), reports fees and slippage separately, and reports open-position unrealized P&L at generation time. BUY outcomes are attributed only when a BUY decision is linked to a BUY trade and the period's FIFO trade history can match that entry to a later SELL; unmatched or pre-window entries are not silently attributed. HOLD and WAIT outcomes remain unscored. Confidence bands are `[50,60)`, `[60,70)`, `[70,80)`, `[80,90)`, and `[90,100]`. Indicator results are descriptive associations, not causal claims. Strategy-version comparisons require at least five linked SELL outcomes per version. Shadow-exit comparisons require both modeled and actual net P&L; direct scenario-to-strategy-version linkage is unavailable and is reported as such.

The bounded `analysis-bundle` view remains available for compatibility and recent, sampled analysis; it is not a complete-history export. The Exports page now uses the authenticated `analysis-export-manifest` and `analysis-export-page` views for the primary AI-analysis export. It reads every available trade, position row, AI decision, portfolio snapshot, shadow-exit scenario/event, and persisted analytics run through one fixed `asOf` time. Candle data is intentionally limited to windows around every unique trade or decision timestamp: up to ten candles before and ten after each anchor for each of the six supported intervals. Each `(symbol, interval, timestamp)` candle is written once; `candle-window-links` JSONL files preserve which anchors selected each candle. It does not export the full candle table.

The browser requests one bounded page at a time (250 rows, or ten candle anchors and at most 1,200 candle rows), retries `429` responses according to `Retry-After`, and creates a timestamped `cryptopulse-analysis-ddMMyyyyHHmmss` subfolder inside the user-selected folder. JSONL files are split at 5 MiB, and the export folder contains a manifest with source descriptions, the as-of boundary, counts, output files, paper-trading mode, active markets, and risk settings. No AI upload occurs. If one record itself exceeds the file limit, the export fails and the manifest marks the partial result. The pages are not one database transaction; mutable position and scenario rows may change while pages are read, and the positions table represents stored current state rather than a full state-change log. The export currently cannot resume a failed run; restart it into a new output folder. The browser's File System Access API is required (for example, a current desktop Chromium browser).

The legacy `recommendation-history` CSV endpoint reads persisted insight runs rather than recalculating recommendations. Existing analytics, recommendation, trade, position, portfolio-snapshot, and AI-decision CSV endpoints remain available for API compatibility, but their overlapping export cards have been removed from the Exports page; the complete-history JSONL export is the sole export UI. Exports do not expose credentials, cookies, or arbitrary query access. See the [stratified sampling adjustment report](docs/reports/analysis-bundle-stratified-sampling-report.md) and [full-history export report](docs/reports/full-history-analysis-export.md).

Dashboard authentication uses one administrator configured with `DASHBOARD_USERNAME` and a bcrypt `DASHBOARD_PASSWORD_HASH`. Runtime startup fails closed if either value is missing or the hash is invalid. Login creates an opaque session; only its SHA-256 token hash and session metadata are stored in the persistent file configured by `API_SESSION_STORE_PATH`. The systemd unit places this file at `/var/lib/cryptopulse/dashboard-sessions.json` with directory mode `0700` and file mode `0600`; it survives runtime restarts and package deployments. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, and expires after `API_SESSION_TTL_MS` (eight hours by default). Logout revokes the persisted session, and changing the dashboard username or password hash invalidates existing sessions.

Install the updated [systemd unit](deploy/cryptopulse-runtime.service) so systemd creates and grants the runtime access to its persistent state directory:

```sh
sudo cp deploy/cryptopulse-runtime.service /etc/systemd/system/cryptopulse-runtime.service
sudo systemctl daemon-reload
sudo systemctl restart cryptopulse-runtime.service
```

`API_SESSION_STORE_PATH` is optional for other deployments and defaults to `~/.local/state/cryptopulse/dashboard-sessions.json`; the parent directory must be persistent and writable by the runtime user. The checked-in systemd unit overrides it to the managed `/var/lib/cryptopulse` state directory because the service runs with `ProtectSystem=strict`.

Generate a cost-12 bcrypt hash without echoing the password by running `npm run auth:hash-password` from this package in an interactive terminal. Put the resulting hash and the single username in the Pi `.env`; never place the plaintext password or hash in Vercel variables, source code, logs, or shell arguments. Bcrypt passwords are limited to 72 UTF-8 bytes.

Keep `API_HOST=127.0.0.1`. Set `API_CORS_ORIGINS` to the exact dashboard origin(s); login and logout require an allowed origin, and wildcard origins are rejected. The Vercel same-origin proxy forwards the opaque cookie to the Pi and uses the existing `api/auth-session`, `api/dashboard-data`, and `api/protected-page` functions; no new Vercel function is added. Configure `CRYPTOPULSE_RUNTIME_API_ORIGIN` as a Vercel server environment value as well as a build value. Cloudflare Access remains optional as an additional network boundary; when enabled, its issuer, audience and operator allowlist remain required, and the dashboard's Vercel origin must also provide the Access assertion that the proxy forwards. No Supabase Auth or profile mapping is used; the single system portfolio remains read-only. See the [Phase 9 dashboard authentication report](docs/phase-9-dashboard-authentication.md).

The runtime preflight checks read privileges for every table used by the dashboard API. Apply the [Phase 8.3 permission migration](migrations/phase-8.3-dashboard-permissions.sql) to the existing database before restarting with a role that lacks those dashboard-specific `SELECT` grants. See the [Phase 8.3 permission validation report](docs/phase-8.3-dashboard-permission-validation.md) for the read set and verification query.

All JSON responses use a `{ "data": ... }` envelope; errors use `{ "error": { "code", "message", "requestId" } }`. Invalid query input is rejected, market candle results are limited to 500 rows, trade/AI history pages are limited to 100 rows, analytics and CSV reads are capped at 10,000 rows, and monitoring table counts are PostgreSQL estimates. CPU, disk, temperature or other host details may be unavailable on unsupported systems. The admin-only operational health route is not used by the dashboard.

The existing Vercel dashboard now reads its runtime data from these Pi APIs and uses aligned polling instead of Supabase Realtime. See the [Phase 8 dashboard cutover report](docs/phase-8-dashboard-cutover.md) for the dependency mapping, full route contracts, security assumptions, limitations and validation results.

## Raspberry Pi migration roadmap status

The operator reports the Phase 8 read-only dashboard cutover is operational on the live Pi. PostgreSQL, the runtime, scheduler, AI, paper trading, Cloudflare Tunnel and Quick Tunnel were reported operational; `/api/v1/health/live`, `/api/v1/markets` and `/api/v1/dashboard-data` returned `200`. The runtime reader's six dashboard `SELECT` grants were reported missing and then resolved using the [Phase 8.3 migration](migrations/phase-8.3-dashboard-permissions.sql). See the [Phase 8.4 live validation report](docs/phase-8.4-live-validation-report.md).

The reported Phase 8 deployment uses `CLOUDFLARE_ACCESS_ENABLED=false`. The API origin and exact Vercel CORS origin were configured; these settings alone do not authenticate clients. Phase 8.7 documents a named Tunnel hostname, but a permanent hostname has not been independently validated from this worktree. Phase 9 adds local single-admin sessions. Phase 9.1 confirms the authentication routes are registered by runtime bootstrap in source and local integration tests; the operator-reported live `404` remains unresolved until the Pi runtime package is updated and restarted. See the [Phase 9.1 route validation report](docs/phase-9.1-auth-route-validation.md).

Phase 8.5 fixes the Analytics export-count contract, Trade History query handling, and Open Positions AI Status payload locally. Raspberry Pi and repository test suites pass, but these changes have not been deployed to the live Pi; a later live probe was blocked by the Quick Tunnel returning `530`. See the [Phase 8.5 dashboard function validation report](docs/phase-8.5-dashboard-function-validation.md) for evidence and outstanding live checks. Do not treat Phase 8.5 as production-validated until those checks pass.

Phase 8.6 reports `ACTIVE` after healthy runtime startup and each successful cycle, retains `ERROR` on failed cycles and `STOPPED` emergency state, and reports `IDLE` on shutdown. The dashboard's infrastructure monitor is labeled Raspberry Pi; see the [Phase 8.6 dashboard UI alignment report](docs/phase-8.6-dashboard-ui-alignment.md).

## Permanent dashboard connectivity

For unattended dashboard access, use the existing named Cloudflare Tunnel `ai-crypto-pulse-bot` with a stable hostname such as `api.example.com`. Configure that public hostname to forward to `http://127.0.0.1:3002`; keep the Node API loopback-bound and do not expose PostgreSQL. The repository includes a placeholder [cloudflared configuration example](deploy/cloudflared-config.example.yml); replace the tunnel UUID, credentials path and hostname using operator-owned Cloudflare values before installing it. Quick Tunnel origins are allowed for development/validation builds only; production builds reject them.

Configure the static dashboard through Vercel build-time environment variables:

- `CRYPTOPULSE_RUNTIME_API_ORIGIN` — required for Vercel builds; an HTTPS API origin, with no path. Use a stable hostname in Production; Quick Tunnel hosts are for validation/development only.
- `CRYPTOPULSE_ENVIRONMENT` — optional `development`, `validation`, or `production`; Vercel `VERCEL_ENV` automatically selects production or preview/validation.
- `CRYPTOPULSE_ACCESS_ENABLED` — optional `true` or `false`, default `false`.
- `CRYPTOPULSE_ACCESS_AUDIENCE` — required when dashboard Access is enabled.

The Vercel build generates `js/runtime-api-config.js` from these values. The origin and Access audience are embedded in a public static file and must not contain secrets. Changing them requires a new Vercel build/deployment. The build rejects missing origins, and a production build cannot be downgraded to allow Quick Tunnels. Vercel Preview defaults to validation mode; local builds default to development mode. On the Pi, configure `API_CORS_ORIGINS` to the exact Vercel dashboard origin and keep the API host set to `127.0.0.1`. See the [Phase 8.7 permanent connectivity report](docs/phase-8.7-permanent-connectivity.md) for setup and verification steps.

## Layout

- `src/api/` — built-in Node HTTP server, health/data routes, middleware, validation, and error handling.
- `src/runtime/` — API startup, worker-stage orchestration, bounded pools, lock ownership, and graceful lifecycle.
- `src/services/` — database contracts, public Bitvavo ingestion, deterministic AI analysis, paper trading, UTC scheduling, and non-destructive retention planning.
- `src/repositories/` — parameterized, bounded PostgreSQL access for API reads, ingestion, AI decisions, and paper portfolios/positions/trades.
- `src/auth/` — provider-neutral authentication and authorization interfaces, optional Cloudflare Access JWT validation, bounded in-memory test sessions, and persistent file-backed dashboard sessions.
- `src/database/` — bounded `pg` pool plus explicit read-only and write transaction helpers.
- `src/monitoring/` — health responses, bounded operational snapshots, and request counters.
- `src/config/` — strict runtime environment parsing.
- `tests/` — isolated Node.js tests; no remote database or schema setup.
- `docs/` — implementation and operational notes for this runtime foundation.

The runtime-specific specification is in [docs/runtime-foundation.md](docs/runtime-foundation.md). The [Phase 4 implementation report](docs/phase-4-implementation-report.md) records the API scope; the [Phase 5 implementation report](docs/phase-5-implementation-report.md) records ingestion; the [Phase 5.2 report](docs/phase-5.2-ingestion-contract-alignment.md) documents the ingestion owner opt-in; the [Phase 5.4 report](docs/phase-5.4-ingestion-user-resolution.md) resolves API/ingestion identities; the [Phase 6 implementation report](docs/phase-6-implementation-report.md) records AI analysis; the [Phase 7 report](docs/phase-7-implementation-report.md) records scheduler, paper trading, and retention; and the [Phase 7.6 report](docs/phase-7.6-standalone-system-profile.md) documents standalone paper-account provisioning.

For environment variables, PostgreSQL contract checks, and validation commands, see the [deployment and validation guide](docs/phase-2-deployment-validation.md).
