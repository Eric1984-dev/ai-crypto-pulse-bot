# Phase 06 Candle Refresh Fix Report

## Summary

Extended the existing scheduled market refresh so it now refreshes both ticker snapshots and candle history. For each enabled watched market that is currently tradable on Bitvavo, the service fetches candles for `1m`, `5m`, `15m`, `1h`, `4h`, and `1d` from Bitvavo's public candle endpoint and upserts validated OHLCV rows into the existing `AI_Crypto_Bot_Candles` table.

No new tables, migrations, private Bitvavo endpoints, API keys, or trading functionality were added. Phase 08 was not started.

## Refresh behavior

- `GET /api/market-refresh` continues to refresh stale `AI_Crypto_Bot_Market_Data` snapshots and now also refreshes scheduled candle intervals.
- The service reads enabled markets from `AI_Crypto_Bot_Watched_Markets` and filters them against Bitvavo's live tradable EUR market catalog.
- Each market/interval request asks for up to 500 recent candles. Valid records are upserted on the existing `(symbol, interval, timestamp)` conflict key, preserving retry safety and existing history.
- Candle requests are bounded to four concurrent provider calls. Existing eight-second request timeouts and 60-second per-instance caching remain in effect.
- Cache entries track the requested history limit so a prior small market-page request cannot suppress the scheduled history refresh. Provider/empty-data failures are cached for the existing TTL to avoid request bursts.
- The response includes a `candleRefresh` summary with market/interval counts, attempted/refreshed/missing/failed/cached/skipped counts, and upserted candle count.
- Empty or invalid responses create `CANDLE_DATA_MISSING` scanner events. Isolated market errors are recorded and remaining intervals continue. Timeouts, rate limits, provider outages, and database storage failures stop queuing more work and report the skipped counts.

## Files changed

Implementation and tests:

- `lib/market-data.mjs`
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

- Initial scheduled collection requests up to 500 candles for every enabled market and each of the six intervals. Total provider work scales with the enabled market count; concurrency is capped at four, but operators should monitor refresh duration and partial-result counts.
- The 60-second cache is per serverless instance. Scheduled calls farther apart than the TTL perform provider requests again.
- Actual candle availability depends on Bitvavo returning valid data and the server having the existing Supabase service-role configuration.
