# Phase 06 Candle Refresh Optimization Report

## Summary

This report documents the incremental candle-refresh work that preceded the subsequent endpoint split. The current design keeps market snapshots separate and runs candle ingestion through `/api/candle-refresh` in bounded batches; see [PHASE_06_CANDLE_BATCHING_REPORT.md](./PHASE_06_CANDLE_BATCHING_REPORT.md) for the authoritative current behavior. Candle writes still use the existing `AI_Crypto_Bot_Candles` schema.

No new tables, migrations, private Bitvavo endpoints, API keys, trading behavior, or Phase 08 functionality were added.

## Incremental refresh behavior

- The candle service loads enabled watched markets and validates them against Bitvavo's public tradable EUR catalog.
- Each candle invocation selects one interval and one deterministic batch of at most five markets, then reads latest stored timestamps for the selected symbols.
- A market/interval is skipped when its latest candle has not aged by one full interval.
- For due intervals, the Bitvavo request starts at the latest stored timestamp. The dynamic request limit is based on the elapsed interval count, includes one overlap for updating the latest candle, and is capped at 500.
- A market/interval without stored history receives a one-time bootstrap request for up to 500 recent candles.
- Valid candles are upserted using the existing `(symbol, interval, timestamp)` conflict key. OHLCV columns and timestamps remain compatible with the AI Engine.
- Candle request concurrency remains capped at four; existing timeouts, 60-second per-instance cache, failure handling, and scanner-event logging remain in place.

## Runtime metrics

The market snapshot endpoint and candle endpoint expose separate metrics. `/api/market-refresh` includes:

- `metrics.marketRefreshDurationMs` — total service refresh time.
- `metrics.marketDataRefreshDurationMs` — market snapshot refresh time.
- `metrics.recordsProcessed.marketData` — snapshot rows successfully submitted for persistence.

`/api/candle-refresh` reports `metrics.candleRefreshDurationMs` and `metrics.recordsProcessed.candles`, along with interval, batch, `batchCount`, and `providerRequests`. Each endpoint writes its own metrics to Vercel function logs on successful completion; failures log duration without credentials or raw provider/database details.

## Files changed

- `lib/market-data.mjs`
- `api/market-refresh.mjs`
- `api/candle-refresh.mjs`
- `tests/market-data.test.mjs`
- `README.md`
- `ROADMAP.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DEPLOYMENT.md`
- `docs/SCHEDULING.md`
- `docs/TESTING.MD`
- `docs/CHANGELOG.md`
- `docs/reports/PHASE_06_COMPLETION_REPORT.md`
- `docs/reports/PHASE_06_CANDLE_FIX_REPORT.md`
- `docs/reports/PHASE_06_CANDLE_OPTIMIZATION_REPORT.md`

## Tests and validation

- Focused market-data tests: **23 passed, 0 failed**.
- `npm.cmd test`: **99 passed, 0 failed**.
- `npm.cmd run build`: **passed**; static project validation and database migration validation passed for 16 prefixed tables, RLS coverage, and initial seed consistency.

Tests use mocked Bitvavo and PostgREST responses. No live Bitvavo, Supabase, scheduler, or production deployment smoke test was run.

## Known limitations

- A market/interval with no stored candles still requires a bounded initial bootstrap.
- After a long outage, requests are capped at 500 candles per market/interval per run; further scheduled runs may be needed to catch up.
- The in-memory cache remains per serverless instance. Stored timestamps provide the durable incremental checkpoint.
- Reported durations and counts are runtime measurements; production execution-time improvement must be confirmed from deployed endpoint responses or Vercel logs.

## Readiness

The scheduled Phase 06 refresh retains candle ingestion while avoiding repeated historical reads for populated intervals. The existing candle schema and data contract consumed by the AI Engine remain unchanged. Phase 08 was not started.
