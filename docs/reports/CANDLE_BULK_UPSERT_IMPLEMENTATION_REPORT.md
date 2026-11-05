# Scheduled Candle Bulk Upsert Implementation Report

**Date:** 2026-11-05<br>
**Scope:** Implemented for the existing `/api/candle-refresh` endpoint. No deployment, scheduler, database schema, or migration changes were made. Paper Trading behavior remains unchanged.

## Implementation

The scheduled refresh now validates/parses each provider response in its existing market worker and stages only valid candle rows. After provider jobs complete, the invocation sends the staged rows from successful markets in one `AI_Crypto_Bot_Candles` POST using:

- The existing service-role authorization.
- `on_conflict=symbol,interval,timestamp`.
- `resolution=merge-duplicates,return=minimal`.

The five-market maximum, batch selection, interval/range selection, provider requests, freshness checks, 60-second cache, and latest-candle overlap are unchanged. Invalid provider rows are filtered before staging. A changed latest forming candle continues to update the existing key.

If the bulk write fails, each market's already-validated rows are retried independently, with at most four fallback writes in flight. All fallbacks are attempted even if an individual market fails. This is safe if a bulk request committed but its response was lost: retries use the same unique conflict key and merge-duplicates behavior. Persistently failing markets receive a scanner error event; successful market writes are retained.

The endpoint response now includes ordered `marketOutcomes` for selected markets. `refreshed` and `candlesUpserted` count only successfully persisted markets/rows. `metrics.candleWriteRequests` counts attempted candle-table POSTs, including failed bulk and fallback attempts; `metrics.candleWriteFallbacks` counts per-market fallback attempts. Existing provider and aggregate outcome counters remain in place.

## Regression coverage

Added tests verify:

- One bulk POST for multiple successful markets with the expected conflict key and merge-duplicates preference.
- Successful rows are persisted when another market's provider request fails.
- A failed bulk write is retried per market, including a simulated commit-with-lost-response case.
- A persistently failing market does not block the other market's fallback write.
- Invalid provider candles are excluded from the payload.
- Conflict-key retry updates an existing latest candle without creating a duplicate row.
- Per-market outcomes, persisted-row counts, write-request counts, and fallback counts.

## Validation results

| Command | Result |
|---|---|
| `node --test tests/market-data.test.mjs` | Passed: 42 tests, 0 failures |
| `npm.cmd test` | Passed: 273 tests, 0 failures |
| `npm.cmd run build` | Passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency) |
| `git diff --check` | Passed |

These are local test/build results; no live Supabase write, production deployment, or production request-count measurement was performed.

## Estimated request reduction and limitations

The implementation reduces the scheduled candle write pattern from up to five candle-table POSTs per invocation to one bulk POST when successful markets have valid rows. This is **up to 80% fewer scheduled candle POSTs** at a full five-market batch. The implementation does not combine on-demand `/api/market` writes.

The external request estimate remains conditional: if the earlier **26K candle POST** and **5.3K checkpoint RPC** estimates cover the same measurement window, and batches usually write five markets, the theoretical reduction is about **20.7K fewer candle POSTs (approximately 79.6%)**. Those production counts were not independently reconciled to a common time window or attributed by function, so this is not a measured production result.

Request-count reduction is distinct from other effects:

- **Candle rows:** the same validated rows are submitted; row volume is not intentionally reduced.
- **Database work:** the same conflict-key inserts/updates are required. The bulk statement changes request/transaction grouping, not the number of candle rows.
- **CPU, latency, and cost:** no production measurements establish an improvement. Larger payloads and fallback retries can offset request overhead.
- **Failure behavior:** a bulk write can fail for all included markets; per-market fallback narrows final failure impact, but an outage can still cause repeated write attempts. Monitor fallback and persistent-failure metrics.

## Files changed

- `lib/market-data.mjs`
- `tests/market-data.test.mjs`
- `docs/API.md`
- `docs/CHANGELOG.md`
- `docs/TESTING.MD`
- `docs/reports/CANDLE_BULK_UPSERT_IMPLEMENTATION_REPORT.md`

The preceding request audit remains unchanged at [`SUPABASE_EXTERNAL_API_REQUEST_AUDIT.md`](./SUPABASE_EXTERNAL_API_REQUEST_AUDIT.md).
