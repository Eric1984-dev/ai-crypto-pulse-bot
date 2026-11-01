# Phase 06 Candle Batching Report

## Status

Implemented as a Phase 06 follow-up. Candle ingestion is separate from market snapshots, uses bounded incremental batches, and continues to write to the existing database schema. Phase 08 was not started.

## Architecture

- `GET /api/market-refresh` synchronizes configured watched markets, refreshes stale ticker snapshots, and updates market summaries. It does not request or write candle data.
- `GET /api/candle-refresh?interval=1m&batch=0` runs a separate candle job for one supported interval and one zero-based market batch.
- The candle service reads enabled watched markets, validates them against Bitvavo's public tradable EUR catalog, orders them by priority and symbol, and selects at most five markets for the requested batch.
- `batchCount` is calculated from the current eligible market set. For 102 eligible markets, there are 21 batches per interval.
- Candle work is limited to four concurrent provider requests. Repeated or overlapping invocations remain safe through the existing candle upsert key.

## Incremental candle behavior

For the selected symbols and interval, the service reads the latest stored candle timestamp. It skips a market when no completed candle is due; otherwise, it requests from the latest stored timestamp with a gap-sized limit capped at 500. The latest stored candle overlaps the request to allow final-value updates. A market/interval with no stored history receives a bounded bootstrap of up to 500 records.

Validated OHLCV data is upserted into `AI_Crypto_Bot_Candles` using the existing `(symbol, interval, timestamp)` conflict key. Supported intervals remain `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`. The AI Engine's input schema is unchanged. The existing 60-second per-instance cache and eight-second outbound request timeout remain in place.

## Authentication and data safety

Both scheduler endpoints require `Authorization: Bearer <CRON_SECRET>`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. The service role and cron secret are not returned to callers. Bitvavo access remains limited to public market and candle endpoints; no exchange account access, orders, trading, schema changes, or new tables were added.

Invalid candle intervals or batch indices return `400`; missing cron authorization returns `401`; missing runtime configuration returns `503`. Provider and storage failures are reported in the batch result and scanner-event log while existing candle history remains available to the AI Engine.

## Runtime metrics

The endpoints report and log metrics independently:

- Market snapshots: `marketRefreshDurationMs`, `marketDataRefreshDurationMs`, and `recordsProcessed.marketData`.
- Candle batches: `candleRefreshDurationMs`, `recordsProcessed.candles`, `providerRequests`, status counts, `batch`, `batchSize`, and `batchCount`.

The market endpoint no longer waits for candle work, so candle-provider or candle-storage latency does not delay ticker snapshot refresh.

## Scheduler setup

Configure an external scheduler such as cron-job.org; no Vercel Cron route is required:

1. Schedule `GET https://<deployment-host>/api/market-refresh` for ticker snapshots.
2. Schedule `GET https://<deployment-host>/api/candle-refresh?interval=<interval>&batch=<index>` for candle ingestion.
3. Use all six supported intervals and each batch index from `0` to `batchCount - 1`. Stagger batches where possible to avoid bursts.
4. Set the scheduler's HTTP timeout to at least 90 seconds. Each candle invocation is bounded to one interval and five markets; the timeout recommendation accounts for existing per-request limits and database operations. Confirm actual deployed durations in response metrics or Vercel logs because provider and database latency can vary.
5. Add the authorization header in protected scheduler settings. Never put secrets in URLs, query parameters, or task names.

At 102 eligible markets, a complete candle pass requires 21 batch requests per interval. Schedule each interval's batches at a cadence appropriate to its freshness requirement. The eligible market count is dynamic; use the returned `batchCount` when maintaining scheduler tasks.

## Files changed

Implementation and validation:

- `lib/market-data.mjs`
- `api/candle-refresh.mjs`
- `scripts/validate-project.js`
- `tests/market-data.test.mjs`
- `tests/project-setup.test.js`

Documentation:

- `README.md`
- `ROADMAP.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/CHANGELOG.md`
- `docs/DEPLOYMENT.md`
- `docs/SCHEDULING.md`
- `docs/TESTING.md`
- `docs/PHASE_06_COMPLETION_REPORT.md`
- `docs/PHASE_06_CANDLE_FIX_REPORT.md`
- `docs/PHASE_06_CANDLE_OPTIMIZATION_REPORT.md`
- `docs/PHASE_06_CANDLE_BATCHING_REPORT.md`

`api/market-refresh.mjs` retains its existing handler contract; its delegated service operation is now snapshot-only.

## Tests and validation

- Focused market-data and project validation tests: passed.
- `npm.cmd test`: passed, 102 tests, 0 failures.
- `npm.cmd run build`: passed; static project validation and database migration validation passed for 16 prefixed tables, RLS coverage, and initial seed consistency.

Tests use mocked Bitvavo and PostgREST responses. No live scheduler, provider, Supabase project, or production deployment was exercised.

## Known limitations

- Batch count changes when the enabled, Bitvavo-valid market universe changes; external scheduler task coverage must be kept in sync.
- Each candle route call has a strict market/interval work bound, but no production latency guarantee is claimed. Verify the configured scheduler timeout and monitor real deployment metrics.
- The per-instance cache is not shared across serverless instances. Persisted candle timestamps remain the durable incremental checkpoint.
- A long outage can exceed the 500-candle per-market request cap and require subsequent batches/runs to catch up.

## Readiness

Scheduled ticker refresh is isolated from candle ingestion, and candle work is bounded and incremental while preserving existing schema and AI Engine compatibility. Phase 08 was not started.
