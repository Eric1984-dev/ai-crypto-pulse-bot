# Supabase AI Decision and Candle History Archive Feasibility

**Assessment date:** 2026-11-06  
**Mode:** Read-only; no archive, deletion, schema, code, settings, migration, or deployment changes

## Executive summary

Archiving is technically feasible, but there is no safe decision-history deletion under current application behavior. All 150,042 current AI decisions fall within Analytics' 365-day maximum range. Moving them out of PostgreSQL would make current Analytics incomplete unless it gains archive-aware reads or the archived period is restored first.

The current bot can operate with a bounded candle window, but historical investigations and future backtesting need older data. A prior runtime-window calculation identified 230,208 candle rows outside the union of the current AI, market-detail, and scanner windows, representing 22,128,864 bytes by `pg_column_size(row)`. This is a row-payload estimate from a query around 09:09 UTC; it is not an estimate of disk space that PostgreSQL will return after deletion.

**Recommendation:** begin with a private, versioned object-storage archive and a verified restore workflow. Keep every decision required by the 365-day Analytics window online; archive decisions only after they age beyond that window or after archive-aware reads are implemented. Keep the latest 5,000 decisions for scanner behavior, all trade-referenced decisions, and the latest usable decision per enabled market. Archive candle rows only after verifying the current runtime windows and a staged restore. Require a fresh preflight and explicit approval before any deletion.

## Project identity and measurement

The connected project was confirmed as Supabase project `jgnuhgsceilhxugffauj` (CryptoPulse project, `eu-west-1`, `ACTIVE_HEALTHY`, PostgreSQL 17.6). The organization plan is Free. No credentials or raw decision rows are included here.

The latest catalog and count queries ran on 2026-11-06, with decision/candle rows current through approximately 09:21 UTC. Catalog relation sizes and `pg_database_size` are physical PostgreSQL measurements at query time; they are not the same as the Supabase dashboard quota metric or billed storage.

| Measurement | Bytes | Approx. decimal MB |
|---|---:|---:|
| `pg_database_size(current_database())` | 466,979,987 | 466.98 |
| Sum of `pg_total_relation_size` for the 18 `AI_Crypto_Bot_*` tables | 453,361,664 | 453.36 |

### Current project tables

`pg_table_size` includes the table and its TOAST storage. `pg_total_relation_size` includes the complete relation footprint. Time ranges use the table's operational timestamp column; for mutable state tables the range can span `created_at` through `updated_at`.

| Table | Rows | Table + TOAST bytes | Total relation bytes | Timestamp range (UTC) |
|---|---:|---:|---:|---|
| `AI_Crypto_Bot_AI_Decisions` | 150,042 | 291,381,248 | 322,502,656 | 2026-11-01 05:57:38.832659 → 2026-11-06 09:21:07.529283 |
| `AI_Crypto_Bot_Candles` | 529,050 | 71,360,512 | 129,294,336 | 2025-06-13 00:00:00 → 2026-11-06 09:20:00 |
| `AI_Crypto_Bot_Portfolio_Snapshots` | 1,364 | 172,032 | 376,832 | 2026-11-01 16:17:16.791049 → 2026-11-06 09:18:14.494083 |
| `AI_Crypto_Bot_Trades` | 5 | 49,152 | 131,072 | 2026-11-02 14:13:09.130145 → 2026-11-04 14:48:11.863757 |
| `AI_Crypto_Bot_Shadow_Exit_Events` | 40 | 57,344 | 122,880 | 2026-11-05 12:20:20.701 → 2026-11-05 15:10:21.098 |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios` | 35 | 81,920 | 122,880 | 2026-11-05 12:23:10.845490 → 2026-11-06 09:18:14.312659 |
| `AI_Crypto_Bot_Market_Data` | 102 | 65,536 | 114,688 | 2026-11-06 09:20:19.354 → 2026-11-06 09:20:19.354 |
| `AI_Crypto_Bot_Scanner_Events` | 45 | 49,152 | 98,304 | 2026-11-01 06:32:14.490850 → 2026-11-04 20:20:21.316505 |
| `AI_Crypto_Bot_Watched_Markets` | 102 | 49,152 | 98,304 | 2026-10-31 19:14:05.621380 → 2026-11-01 00:26:33.374641 |
| `AI_Crypto_Bot_Emergency_State` | 1 | 49,152 | 81,920 | 2026-10-31 19:14:05.621380 |
| `AI_Crypto_Bot_Positions` | 5 | 49,152 | 81,920 | 2026-11-02 14:13:09.130145 → 2026-11-06 09:18:14.494083 |
| `AI_Crypto_Bot_Profiles` | 1 | 49,152 | 81,920 | 2026-10-31 19:13:32.841650 |
| `AI_Crypto_Bot_Status` | 1 | 49,152 | 81,920 | 2026-11-06 09:21:13.725 |
| `AI_Crypto_Bot_Portfolios` | 1 | 40,960 | 73,728 | 2026-11-01 16:17:16.791049 → 2026-11-06 09:18:14.494083 |
| `AI_Crypto_Bot_Strategy_Changes` | 0 | 8,192 | 32,768 | — |
| `AI_Crypto_Bot_Backtests` | 0 | 8,192 | 24,576 | — |
| `AI_Crypto_Bot_Strategies` | 0 | 8,192 | 24,576 | — |
| `AI_Crypto_Bot_Strategy_Performance` | 0 | 0 | 16,384 | — |

The snapshot records 1,364 portfolio snapshots and 102 current market-data snapshots. Portfolio snapshots describe the whole portfolio and must not be pruned as symbol-specific history.

## Records that must remain online

### AI decisions

Current consumers and constraints:

- Analytics supports 30-, 90-, and 365-day ranges and reads decisions from PostgreSQL.
- Raw exports default to all-time data. The current export path has no object-storage reader.
- The scanner reads a bounded set of up to 5,000 recent decisions.
- Paper trading needs fresh decisions; the latest usable decision per each of the 102 enabled markets must remain available.
- Trades reference AI decisions by foreign key. All five trade-referenced decisions must remain online unless the trade/decision relationship is deliberately redesigned and validated.
- The decision table currently contains 150,042 rows, all within the current 365-day Analytics window.

At query time, the newest 5,000 decisions occupied 8,815,944 bytes by `pg_column_size(row)` and covered 2026-11-06 05:01:07.221943 through 09:21:07.529283 UTC. None of the five trade-referenced decisions were in that newest-5,000 set; the five referenced rows account for 8,768 bytes by the same measure.

Therefore:

- **Safe decision rows to remove now while preserving current Analytics: zero.**
- A hypothetical archive cohort outside the scanner and trade-reference keeps contains **145,037 rows** and **248,238,712 bytes** of row payload. This is not safe to remove with current code: it includes decisions still within Analytics' 365-day window, and Analytics, exports, dashboard totals, and historical investigations do not read object storage.
- The latest decision per enabled market is a required operational keep set and is included in the conservative recent-decision keep window. Recompute the exact IDs and enabled-market set in any future deletion preflight.

### Candles

Current code uses candle history for:

- AI analysis: up to 150 latest rows per market/interval, with interval freshness limits and a minimum coverage requirement.
- Market detail: up to 500 latest rows per market/interval.
- Scanner: active-market daily data over 32 days and hourly data over 10 hours.
- Historical investigations and planned backtesting, which need an archive or restore path for older data.

A runtime-window calculation from approximately 09:09 UTC found 91,297 candle rows in the current AI retrieval windows across enabled markets. At least the 15m and 1h intervals had fresh, sufficient candles for all 102 enabled markets. Some 4h and 1d pairs had fewer than 26 candles, so those existing rows must not be pruned based on a universal minimum assumption.

The conservative online candle set was the union of:

1. The latest 500 candles for each market/interval.
2. The scanner's active-market 1d 32-day and 1h 10-hour windows.
3. Any rows needed to satisfy current per-interval AI freshness and coverage.

The earlier query classified 298,392 rows as this union and 230,208 rows outside it. The latter summed to 22,128,864 bytes by `pg_column_size(row)`. The live candle count was 529,050 at the later count query, so the candidate count and payload must be recalculated from a fresh snapshot before implementation.

### Other online data

Do not treat these as symbol-history candidates:

- Portfolio snapshots, portfolio state, open/closed positions, and trades are consumed by dashboard and Analytics calculations.
- Current `AI_Crypto_Bot_Market_Data` is one snapshot per enabled market; it is operational state, not historical candle data.
- Watched-market configuration is the active market universe.
- Status, emergency state, scanner events, and shadow-exit records support current operational/dashboard behavior or audit history. Their current footprint is small relative to decisions and candles.

## Archive-size estimate and limitations

The current decision-table row-payload aggregate is **257,063,424 bytes**. If an archive-aware implementation retained the newest 5,000 decisions and all five trade-referenced decisions, the complementary 145,037-row cohort is **248,238,712 bytes** by `pg_column_size(row)`. This is only a row-payload measurement; it is not a forecast of the compressed archive size or database space reclaimed.

The runtime-only candle candidate previously measured **22,128,864 bytes** by row payload. Combined with the hypothetical decision cohort, the payload estimate is approximately **270,367,576 bytes**. These cohorts have different safety conditions: the decision cohort cannot be removed while it is needed by current Analytics.

The current decision and candle relation sizes together are **451,796,992 bytes** (`pg_total_relation_size`). This includes relation overhead beyond row payload. A row-payload sum does not apportion indexes, free space, TOAST allocation, or page fragmentation to a proposed cohort. The current queries did not measure how much physical storage a deletion would return.

An ordinary `DELETE` does not immediately shrink relation files or guarantee lower Supabase-reported database usage. `VACUUM` can make deleted space reusable but does not guarantee returning it to the filesystem. Do not use `VACUUM FULL` as part of an archive rollout without separately assessing its lock and disk-space implications.

## Archive format, destination, costs, and access

### Recommended initial format and destination

Use client-streamed PostgreSQL `COPY (SELECT explicit full columns...) TO STDOUT` in bounded, deterministic time chunks, compressed as gzip. Preserve all typed timestamp values and complete JSON/JSONB fields; do not parse large JSON through JavaScript numbers. Store each archive object privately with an immutable versioned name and a manifest containing:

- Project reference, source table, schema/version fingerprint, extraction time, UTC filters, and exact column list.
- Exact row count, primary-key uniqueness, minimum/maximum timestamps, and a cryptographic checksum of each completed archive object.
- The archive format/tool version and a documented restore command/procedure.

For deletion eligibility, validate an archive by restoring it into an isolated staging database/table, then compare row counts, timestamp bounds, primary keys, and deterministic per-row hashes against the source selection. A checksum alone verifies file integrity, not completeness or restore correctness.

Supabase Storage is the simplest first destination to evaluate because it keeps the archive with the existing project. Current [Supabase pricing](https://supabase.com/pricing) lists Free-plan allowances including 1 GB file storage and 5 GB egress; the project's existing bucket usage and actual compressed archive size were not measured. The row-payload estimate is below 1 GB, but it does not prove that the archive will fit or be free.

Cloudflare R2 is a viable alternative if egress cost or storage growth becomes material: [R2 pricing](https://developers.cloudflare.com/r2/pricing/) lists a 10 GB-month Standard storage free tier, then $0.015/GB-month, with no egress charge. It adds a separate provider/account and integration. Git is not an archive/query/restore system, and no MEGA integration or operational controls were verified in this project; neither is recommended.

### Application access

There is currently no archive-aware reader. An object in Supabase Storage is not queryable by existing PostgreSQL Analytics or export queries. Archived rows would require one of:

1. Explicit restore to a staging/live database for historical analysis or exports; or
2. A later archive-aware service that reads and validates objects, merges the archived period with live data, and preserves existing API semantics.

If decisions are archived, dashboard totals and all-time exports must be made archive-aware too. Current 30/90/365-day Analytics would remain complete only if all rows inside those ranges stay online or Analytics explicitly reads the archive. Candle archives must be restorable for historical investigations and backtesting. None of these archive capabilities exist today.

## Staged recommendation

1. **Approve retention semantics first.** Decide whether 365-day Analytics must remain directly queryable, whether all-time exports must be seamless, and what candle window remains online. Until then, delete nothing.
2. **Create a private archive proof of concept without deletion.** Export one bounded candle interval and one bounded decision period using explicit full columns, gzip, and a manifest. Do not change production schema/settings or add API routes for this assessment.
3. **Prove restore and integrity.** Restore into an isolated staging environment and verify exact counts, primary keys, timestamps, JSON/JSONB values, and checksums. Document time-to-restore and access controls.
4. **Preserve online operational keeps.** At minimum retain the latest 5,000 decisions for scanner behavior, all trade-referenced decisions, latest usable decision per enabled market, all decisions needed by the 365-day Analytics range, and the verified candle windows described above. Keep portfolio, market snapshot, watched-market, trading, status, and emergency state intact.
5. **Add archive-aware access or accept restore-only history.** This must cover Analytics, exports, dashboard decision totals, and historical investigations before moving any in-range decisions. Keep existing API/function-count constraints in mind if implementation is later approved.
6. **Run a fresh read-only deletion preflight and seek explicit approval.** Export and verify the exact candidate set first. Delete in bounded batches with foreign-key dependencies respected; do not cascade into shared portfolio/market data.
7. **Measure actual storage behavior after deletion.** Compare Supabase's reported usage and PostgreSQL relation/database sizes before and after normal vacuuming. Do not equate deleted row payload with reclaimed storage.

### Rollback and restore

Before any future deletion, preserve immutable archive objects and a separately verified backup. On validation failure, do not delete. If a post-deletion issue occurs, stop further retention work, restore affected chunks to staging, compare them against the manifest, then restore to the live database in dependency-safe order after checking for duplicate primary keys and intervening writes. Re-enable archive-aware reads only after parity checks; otherwise restore the archived range before resuming historical queries. Keep the archive until both application behavior and database restoration have been verified.

## Decisions required before implementation

1. Keep all 365 days of AI decisions online, or approve archive-aware Analytics for in-range data?
2. For all-time exports and historical investigation, is restore-on-demand acceptable, or is seamless archive-aware reading required?
3. What candle hot window should remain online: the current runtime union, a longer fixed period, or all history?
4. Use private Supabase Storage (simplest) or add a separate object-storage provider?
5. Who owns archive access, integrity checks, restore drills, and explicit deletion approval?

## Evidence and repository references

The assessment reviewed the existing [retention assessment](./SUPABASE_DATA_RETENTION_AND_CLEANUP_ASSESSMENT.md), [egress and database-size report](./SUPABASE_EGRESS_AND_DATABASE_SIZE_OPTIMIZATION_REPORT.md), [project roadmap](../../ROADMAP.md), [AI candle retrieval](../../lib/ai-engine.mjs), [compact candle RPC](../../supabase/migrations/20261105150000_ai_candle_rpc_compact_payload.sql), [Analytics](../../lib/analytics.mjs), [exports](../../lib/exports.mjs), [dashboard data](../../api/dashboard-data.mjs), and [market data](../../lib/market-data.mjs).

The compact timeframe-payload investigation was not repeated or evaluated in this report.
