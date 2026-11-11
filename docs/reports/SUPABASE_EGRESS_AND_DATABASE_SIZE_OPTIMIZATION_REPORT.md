# Supabase Egress and Database Size Optimization Report

## Summary

Read-only database measurements identify `AI_Crypto_Bot_AI_Decisions` and `AI_Crypto_Bot_Candles` as the dominant current database relations. Database query statistics also show frequent AI-shaped candle reads, but no available evidence attributes billed egress by Supabase service, endpoint, or response bytes. The user-provided usage-panel values therefore remain unverified and cannot be treated as a measured rate.

The AI candle reader now uses a bounded, service-role-only RPC that returns no more than 150 latest rows per requested market and interval. It preserves the AI Engine's six intervals, per-market row ordering, freshness checks, validation, indicators, and decision behavior. Same-fixture tests demonstrate fewer returned rows and, for cases that previously paginated, fewer database requests. These are local fixture results, not measured production egress savings.

No data-retention or archival policy was approved, so no database-size reduction or deletion was implemented. The migration is present locally but has not been applied to production; no deployment was made.

## Observation scope and limitations

- Database observations came from read-only Supabase SQL on 2026-11-05. Relation-size and row-count measurements were observed at approximately 11:17 UTC; the three-day cutoff query returned `2026-11-05 11:18:52 UTC`.
- The Supabase usage panel values `7.17 GB / 5 GB` egress and `414 MB / 500 MB` database size were supplied by the user. The billing-cycle dates, project/environment identity, and whether egress is cached, uncached, or combined were not available for verification.
- Supabase Usage / Network Traffic service, API-path, time-series, and response-byte breakdowns were not accessible. No same-period Vercel request/response-byte export was available.
- The database-size query returned `399,953,043` bytes (399.95 decimal MB / approximately 381.4 MiB), about 14.0 MB below the user-reported 414 MB panel value. The panel and SQL observation times/definitions could not be reconciled; the difference is unresolved.
- PostgreSQL statement statistics measure database statement executions, not PostgREST response bytes, serialized JSON size, or billed network egress. No egress reduction is claimed from those counters.

## Database size and growth evidence

At the observation time:

| Relation / metric | Verified value |
|---|---:|
| Current database size (`pg_database_size`) | 399,953,043 bytes |
| `AI_Crypto_Bot_AI_Decisions` total relation size | 262,266,880 bytes |
| Decisions main relation | 237,043,712 bytes |
| Decisions indexes | 25,124,864 bytes |
| `AI_Crypto_Bot_Candles` total relation size | 123,674,624 bytes |
| Candles main relation | 71,303,168 bytes |
| Candles indexes | 52,314,112 bytes |
| AI decision rows | 123,828 |
| Candle rows | 479,908 |

The two largest relations total 385,941,504 bytes, approximately 96.5% of the measured database size. The reported TOAST components for these two relations were each 8,192 bytes; the substantial candle index footprint is expected from the indexed market/interval/timestamp history.

At `2026-11-05 11:17:37 UTC`, the decision table had 29,070 rows created in the trailing 24 hours, with 51,513,272 bytes summed by `pg_column_size`. A separate cutoff query at `2026-11-05 11:18:52 UTC` found:

| Decision age at observation | Rows | Sum of `pg_column_size` |
|---|---:|---:|
| Older than 3 days | 36,210 | 58,344,624 bytes |
| Within 3 days | 87,618 | 152,190,232 bytes |

No decision rows were older than 30 days in the measured database. `pg_column_size` is tuple size, not table/index size or the amount PostgreSQL can immediately return to the filesystem after a delete.

For scale only, extending the current 24-hour row count to 30 days gives about 872,100 decisions. Applying the present total-relation-size-per-row average would project roughly 1.85 GB for the decision relation alone. This is a linear extrapolation, not a forecast; row payloads, index growth, bloat, and decision frequency may differ over time.

### Read-only measurement methods

The measurements used `pg_database_size(current_database())`, `pg_total_relation_size`, `pg_relation_size`, and `pg_indexes_size` for project-prefixed relations; exact `count(*)` on the decision and candle tables; and `count(*)` plus `sum(pg_column_size(row))` for time-bounded decision cohorts. The three-day dry-run cohort query was:

```sql
SELECT
  now() AT TIME ZONE 'UTC' AS observed_at_utc,
  count(*) FILTER (WHERE created_at < now() - interval '3 days') AS rows_older_than_3d,
  coalesce(sum(pg_column_size(d))
    FILTER (WHERE created_at < now() - interval '3 days'), 0) AS tuple_bytes_older_than_3d,
  count(*) FILTER (WHERE created_at >= now() - interval '3 days') AS rows_within_3d,
  coalesce(sum(pg_column_size(d))
    FILTER (WHERE created_at >= now() - interval '3 days'), 0) AS tuple_bytes_within_3d
FROM public."AI_Crypto_Bot_AI_Decisions" AS d;
```

These are database relation measurements, not total disk usage, WAL, logs, transient files, or a measure of reclaimable storage after vacuuming.

## Egress evidence and attribution

The available `pg_stat_statements` snapshot had reset at `2026-11-03 20:54:18 UTC`. By approximately `2026-11-05 11:13 UTC`, the AI-shaped candle REST statement had executed 191,226 times; AI decision inserts had executed 455 times in that statistics window. These counts do not identify which Supabase service generated billed egress or how many bytes each response carried.

The latest-150 candle set needed across the observed 102 enabled markets contains 91,674 rows across the six intervals, versus 479,908 stored candle rows. A SQL JSON-serialization estimate for that latest set was approximately 19,152,857 bytes before transport compression. This estimates the required data shape only; it is not measured network traffic, and the previous pagination algorithm did not necessarily transfer every stored row.

For a complete analysis of 102 markets, the bounded implementation issues `ceil(102 / 4) * 6 = 156` RPC calls and can return no more than 91,800 rows (102 × 6 × 150). If all 455 decision-insert executions represented full analyses over that same 102-market universe, the corresponding bounded call count would be at most 70,980. Compared with 191,226 statement executions, that scenario is 62.9% fewer statements. It depends on both assumptions and must not be interpreted as measured request or egress savings.

The prior reports on external API requests, disk I/O, candle refresh efficiency/CPU, AI history, AI analysis runtime, and bulk candle upserts were reviewed. Bulk upsert reduces write-request count but still sends the same candle records; it is not an egress-byte reduction. No other candidate had enough measured response-byte evidence to justify caching or a query-shape change safely.

## Implemented AI candle-read optimization

Added `AI_Crypto_Bot_Get_Latest_AI_Candles(text[], text)` in a new project-prefixed migration. It:

- accepts one supported interval and one to four unique, non-empty symbols;
- selects up to 150 newest rows independently for each symbol using the existing `(symbol, interval, timestamp)` index;
- returns the fields already consumed by the AI Engine, ordered by requested market and descending timestamp;
- caps a response at 600 rows, below PostgREST's default 1,000-row cap;
- runs as `SECURITY INVOKER` with an empty search path and is executable only by `service_role`.

The AI Engine still obtains its active market universe from `AI_Crypto_Bot_Watched_Markets`. Each interval remains a separate query job, and at most 24 jobs run concurrently. No indicator, signal, confidence, freshness, or decision formula changed. The RPC adds no table, API route, dependency, scheduler change, or market-data write.

### Same-fixture comparison

The regression tests run the former REST pagination algorithm and the new RPC against identical candle fixtures. Returned rows count database response rows in the test harness, not bytes.

| Fixture | Former REST requests / rows | RPC requests / rows | Row reduction |
|---|---:|---:|---:|
| One market, six intervals with 500–549 candles each | 6 / 3,078 | 6 / 900 | 70.7% |
| Four markets, 300 one-minute candles each | 2 / 1,200 | 1 / 600 | 50.0% |
| Four uneven histories: 1,205 / 20 / 10 / 40 one-minute candles | 2 / 1,070 | 1 / 220 | 79.4% |

The same tests compare persisted decisions with decisions computed from the former latest-150 input sets. Fixture results are not a production measurement; response serialization, compression, provider billing, and network conditions are not modeled.

## Database-size decision and retention/archive proposal

No safe database-size reduction can be implemented without a decision on retention and archival. The platform requires AI decision and candle history for reproducibility, analytics, strategy evaluation, and future backtesting. Reducing AI-decision payloads or removing candle/decision rows in place would compromise those requirements. No rows were deleted.

For review only, a **three-day hot decision-history window with complete cold archival** would currently place 36,210 decision rows (58,344,624 tuple bytes) outside the hot table. The remaining three-day cohort is 87,618 rows (152,190,232 tuple bytes). These are exact cohort counts at the observation time; the tuple bytes are not a promise of equivalent on-disk space recovery. A 30-day cutoff currently identifies zero rows, so it provides no immediate savings.

Before any retention migration or deletion is approved:

1. Select an archive backend only after storage, retrieval, and egress costs are measured.
2. Archive immutable daily partitions with a schema version, row count, date range, and SHA-256 manifest; preserve all decision fields required for audit and reproducibility.
3. Verify full row counts and checksums, restore a sample and a full cohort to a staging table, and compare historical analytics/recommendation/backtest results against the live-table baseline.
4. Implement a retrieval path that transparently combines hot and archived history for supported date ranges; retain an operational restore procedure and test it.
5. Run the exact cutoff query above as a dry run, obtain separate approval for deletion, and measure WAL and relation size after any approved operation. A normal `VACUUM` may make space reusable without shrinking the relation file; `VACUUM FULL` rewrites and locks the table and must not be assumed safe or necessary.

The three-day window is a quantified proposal for review, not an approved policy or recommendation to delete data.

## Files changed

- `lib/ai-engine.mjs`
- `PostgreSQL/migrations/20261105120000_ai_candle_history_rpc.sql`
- `scripts/validate-database.js`
- `tests/ai-engine.test.mjs`
- `tests/database-migrations.test.js`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEDULING.md`
- `docs/TESTING.MD`
- `docs/CHANGELOG.md`
- `README.md`
- `ROADMAP.md`
- `docs/reports/SUPABASE_EGRESS_AND_DATABASE_SIZE_OPTIMIZATION_REPORT.md`

## Validation and operational status

- Focused AI Engine tests: `node --test tests/ai-engine.test.mjs` — passed 21/21.
- Focused RPC migration tests: `node --test --test-name-pattern="AI candle history RPC" tests/database-migrations.test.js` — passed 2/2 after the RPC behavior and permission checks were added.
- Full suite: `npm.cmd test -- --test-reporter=dot` — passed (exit code 0).
- Project/database validation: `npm.cmd run build` — passed; static project validation and database migration validation both succeeded.
- The migration has not been applied to production; no deployment, scheduler change, production data deletion, or production setting change occurred.
- `ENABLE_LIVE_TRADING` and Paper Trading behavior were not changed.
