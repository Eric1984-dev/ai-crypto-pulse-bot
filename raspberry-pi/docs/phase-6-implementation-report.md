# Phase 6 — AI Engine Runtime

## Outcome

Implemented a manual, one-shot Node.js AI analysis command inside `raspberry-pi/`. It reads the enabled market universe and stored market data from the existing PostgreSQL database, calculates the existing deterministic V2 analysis, and persists one idempotent decision per enabled market.

The implementation does not execute trades, modify portfolios or positions, change agent status, call Bitvavo, install or invoke PostgreSQL runtime functions, start a scheduler, add an API route, or modify the dashboard. No file outside `raspberry-pi/` was changed. No live database, deployment, or trading operation was performed.

## Implemented components

- `src/services/ai-engine.mjs` — Node.js EMA, RSI, MACD, momentum, volume, volatility, freshness, V2 signal, confidence, decision, and reasoning calculations.
- `src/repositories/ai-analysis-repository.mjs` — bounded PostgreSQL snapshot/candle reads and parameterized decision inserts with explicit columns.
- `src/services/ai-analysis-service.mjs` — uses only enabled rows from `AI_Crypto_Bot_Watched_Markets`, processes four markets at a time, and persists only after the complete analysis run succeeds.
- `src/services/ai-decision-identity.mjs` — canonical input fingerprinting and deterministic UUID generation.
- `src/services/ai-analysis-contract-validation.mjs` and `src/services/database-contracts.mjs` — read-only preflight for the existing database schema and the least-privilege AI writer.
- `src/analyze-ai.mjs` — explicitly invoked one-shot CLI; it does not run from API startup.
- `AI_DATABASE_USER` and `AI_DATABASE_PASSWORD` — separate environment credentials for the decision-writing command; the API keeps using its read-only `DATABASE_USER`.

## Strategy and calculation parity

The Pi engine is checked against the existing `lib/ai-engine.mjs` with shared fixtures for BUY, SELL, HOLD, WAIT, incomplete history, and stale data. The analysis remains one multi-timeframe decision per market, preserving the existing V2 decision granularity.

- EMA periods: 12 and 26.
- RSI period: 14.
- MACD: EMA 12/26 with a 9-period signal line.
- Existing diagnostic calculations remain available for momentum, volume, and volatility. MACD and momentum remain diagnostic; neither changes the V2 score.
- V2 market strength retains the existing daily EMA spread, hourly/daily trend alignment, hourly volume confirmation, and daily RSI weights.
- Confidence retains the existing 0–95 clamp, volatility penalty, 65 minimum directional threshold, candle-history coverage behavior, and confidence cap when fewer than four timeframes are valid.
- Snapshot availability remains a freshness gate at 15 minutes. Candle freshness limits remain 30 minutes (`1m`), 2 hours (`5m`), 6 hours (`15m`), 12 hours (`1h`), 24 hours (`4h`), and 72 hours (`1d`).
- Insufficient, missing, invalid, or stale inputs retain the existing safe WAIT/HOLD outcomes. The AI engine does not fetch or refresh market data.

The current decisions table has no `interval` column. To avoid a schema change, each decision exposes `interval: "1d"` and stores `indicators.interval: "1d"` as the V2 strategy's daily anchor; the full six-interval analysis remains in `indicators.timeframes`. The decision timestamp is stored in the existing `created_at` column.

## Database access and idempotency

- Reads use direct `pg` access, parameterized SQL, explicit columns, the existing watched-markets table, and the existing snapshot/candle tables.
- Candle retrieval is limited to 150 newest rows per market and interval. The service queries at most four markets per read group and retains only one four-market batch of candles in memory.
- The database contract requires the existing decision UUID primary key. Each decision ID is derived from the symbol, strategy name/version, exact snapshot and candle inputs, and resulting freshness state. No index, constraint, table, function, or stored procedure is added.
- Decision inserts use `ON CONFLICT (id) DO NOTHING` and 50-row write batches inside one transaction. Existing IDs are read back and accepted only if their decision payload matches; a mismatch or unverifiable conflict aborts and rolls back the full decision transaction.
- No partial decision set is reported as success. The command leaves all previously stored decisions untouched on any analysis/read/write failure.

### Required AI database role

Configure `AI_DATABASE_USER` and `AI_DATABASE_PASSWORD` for a dedicated non-owner role. It must differ from both `DATABASE_USER` and `INGESTION_DATABASE_USER`. The preflight rejects ownership, update/delete/truncate privileges, insert privileges on other project tables, sequence privileges, elevated role attributes, schema creation, missing read grants, or a missing decision insert grant.

For an already provisioned login, the required grants on the existing database are:

```sql
GRANT CONNECT ON DATABASE ai_crypto_bot_store
  TO ai_crypto_bot_ai_writer;

GRANT USAGE ON SCHEMA public
  TO ai_crypto_bot_ai_writer;

GRANT SELECT ON TABLE
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status"
  TO ai_crypto_bot_ai_writer;

GRANT INSERT ON TABLE public."AI_Crypto_Bot_AI_Decisions"
  TO ai_crypto_bot_ai_writer;
```

The role must not own project tables or have `UPDATE`, `DELETE`, `TRUNCATE`, sequence, `CREATE`-schema, `BYPASSRLS`, or elevated role privileges. The SQL above is documentation only; it was not executed. Keep the credentials in the Pi's ignored `.env`.

Run the command explicitly from `raspberry-pi/`:

```sh
npm run ai:analyze
```

## Validation results

| Check | Result |
|---|---|
| Raspberry Pi package tests: `npm.cmd --prefix raspberry-pi test` | Passed: 95 tests, 0 failures. |
| Repository tests: `npm.cmd test` | Passed: 457 tests, 0 failures. |
| Syntax validation: `node --check` across Raspberry Pi source and tests | Passed: 62 modules checked. |
| `git diff --check` | Passed. |
| Build validation | No Raspberry Pi build script is configured; the runtime uses Node.js ES modules directly. |
| Live PostgreSQL validation / decision persistence | Not run. Repository and transaction behavior were validated with local test doubles. |
| Bitvavo, scheduler, paper/live trading, and deployment | Not invoked. |

## Assumptions, limitations, and risks

- The existing Pi database still contains the reported schema, 101 enabled markets, stored candles, and no required PostgreSQL runtime functions. These deployment facts were supplied by the user and were not re-queried during this phase.
- The API read role must remain read-only. The existing ingestion owner login is not accepted for AI analysis; an authorized database administrator must provision the narrowly scoped AI writer and grant the privileges above before the first Pi execution.
- The market snapshot table retains only its existing latest snapshot row. Snapshot history is not available without a schema change; the V2 engine uses that row only for its existing availability/freshness gate.
- The command analyzes stored candles only. Missing or stale candles are handled safely, but it does not trigger ingestion or reconstruct history.
- Local tests do not verify live PostgreSQL grants, RLS behavior, on-device runtime, or Pi 3 resource usage. The bounded four-market read groups and 150-candle interval cap keep working memory limited; a production run still requires operator monitoring.

## Remaining work for Phase 7

- Implement paper-trading execution separately, preserving the existing risk manager, position and portfolio limits, fees, slippage, cooldowns, emergency controls, and paper-only mode.
- Verify decision eligibility, retry behavior, and duplicate protection against the existing paper-trading contracts before any runtime integration.
- Keep scheduler/cycle integration, dashboard cutover, and live trading out of this phase.

Phase 6 stops here. No Phase 7 work was started.
