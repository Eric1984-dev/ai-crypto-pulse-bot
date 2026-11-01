# Phase 06 Candle Refresh Fix Report

## Summary

The original candle-ingestion fix added scheduled collection alongside ticker snapshots. That combined architecture has since been superseded: `/api/market-refresh` is snapshot-only, and `/api/candle-refresh` now owns incremental candle collection in bounded batches. See [PHASE_06_CANDLE_BATCHING_REPORT.md](./PHASE_06_CANDLE_BATCHING_REPORT.md) for the current design.

No new tables, migrations, private Bitvavo endpoints, API keys, or trading functionality were added. Phase 08 was not started.

## Refresh behavior

- `GET /api/market-refresh` refreshes stale `AI_Crypto_Bot_Market_Data` snapshots only.
- `GET /api/candle-refresh` handles one of the six supported intervals and at most five enabled, Bitvavo-valid watched markets per invocation.
- The service reads enabled markets from `AI_Crypto_Bot_Watched_Markets` and filters them against Bitvavo's live tradable EUR market catalog.
- Initial market/interval history is bootstrapped with up to 500 recent candles. Later scheduled calls batch-read the latest stored timestamp, skip intervals without a completed new candle, and request only the gap with a gap-sized limit capped at 500. The latest stored candle overlaps the range once so mutable final values can be updated. Valid rows are upserted on the existing `(symbol, interval, timestamp)` conflict key.
- Candle requests are bounded to four concurrent provider calls. Existing eight-second request timeouts and 60-second per-instance caching remain in effect.
- Cache entries track the requested history limit so a prior small market-page request cannot suppress the scheduled history refresh. Provider/empty-data failures are cached for the existing TTL to avoid request bursts.
- The candle endpoint includes batch/interval counts, attempted/refreshed/missing/failed/cached/unchanged/provider-request/skipped counts, and upserted candle count. Snapshot and candle duration/record metrics are returned and logged separately.
- Empty or invalid responses create `CANDLE_DATA_MISSING` scanner events. Isolated market errors are recorded and remaining intervals continue. Timeouts, rate limits, provider outages, and database storage failures stop queuing more work and report the skipped counts.

## Files changed

Implementation and tests:

- `lib/market-data.mjs`
- `api/candle-refresh.mjs`
- `tests/market-data.test.mjs`

Documentation:

- `README.md`
- `ROADMAP.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DEPLOYMENT.md`
- `docs/SCHEDULING.md`
- `docs/TESTING.MD`
- `docs/CHANGELOG.md`
- `docs/PHASE_06_COMPLETION_REPORT.md`
- `docs/PHASE_06_CANDLE_FIX_REPORT.md`

## Tests and validation

- Focused market-data suite: passed, 21 tests.
- `npm.cmd test`: passed, 97 tests, 0 failures.
- `npm.cmd run build`: passed; static project validation and database migration validation passed (16 prefixed tables, RLS coverage, and initial seed consistency).

Tests use mocked Bitvavo and PostgREST responses. No live Supabase, Bitvavo, external scheduler, or production deployment smoke test was performed.

## Limitations

- Only a market/interval with no stored history requests the bounded 500-candle bootstrap. Normal scheduled work requests the due incremental range, not the existing history; long outages are still capped at 500 candles per market/interval per run and may need subsequent runs to catch up.
- The 60-second cache is per serverless instance. Scheduled calls farther apart than the TTL perform provider requests again.
- Actual candle availability depends on Bitvavo returning valid data and the server having the existing Supabase service-role configuration.
