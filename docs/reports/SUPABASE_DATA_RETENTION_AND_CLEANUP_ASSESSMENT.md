# Supabase Data Retention and Cleanup Assessment

## Executive decision

**Do not implement periodic cleanup or archival yet.** The repository and production schema establish that candles, AI decisions, trades, portfolio snapshots, strategy history, and shadow-exit records support current product behavior, auditability, reproducibility, or planned backtesting. No retention period or archive/retrieval design has been approved. No table is demonstrably disposable under the current requirements.

The measured database footprint is concentrated in `AI_Crypto_Bot_AI_Decisions` and `AI_Crypto_Bot_Candles`, but deleting either history would discard required data. A prior three-day decision-history window is an explicitly unapproved proposal, not a policy. This assessment implements no deletion, archive, schema, or scheduling behavior.

## Scope and evidence boundaries

- Reviewed the retention backlog in [ROADMAP.md](../../ROADMAP.md), [DATABASE.md](../DATABASE.md), [SCHEDULING.md](../SCHEDULING.md), the prior [Supabase egress and database-size report](./SUPABASE_EGRESS_AND_DATABASE_SIZE_OPTIMIZATION_REPORT.md), relevant migrations, and current application readers/writers.
- All Supabase access in this assessment was read-only. The SQL connection reported database `postgres`, role `supabase_read_only_user`, and PostgreSQL 17.6.
- The Supabase organization view listed a single `CRYPTO PULSE BOT` project, but the SQL connection did not expose a project reference that could be matched to it. Treat the following database measurements as belonging to the configured connection; their mapping to the intended production project is **not independently verified**.
- The Supabase migration-list operation returned no rows, and `supabase_migrations.schema_migrations` was not present. The remote migration history therefore cannot be reconciled with the local migration files. This is not proof that no migrations were applied.
- The database contained 18 `AI_Crypto_Bot_` tables, with RLS enabled. The exact counts below are from `count(*)`; table and index sizes are PostgreSQL relation sizes. The application-table sum does not include every database object.
- User-reported usage-panel observations (`7.17 GB / 5 GB` egress and `414 MB / 500 MB` database size) remain unverified. Billing-cycle dates, service attribution, cache classification, and project mapping were unavailable. No egress or billed-disk savings are claimed.

## Current database measurements

Measured at **2026-11-05 12:31:41 UTC**:

| Metric | Value |
|---|---:|
| `pg_database_size(current_database())` | 403,983,507 bytes (403.98 decimal MB; approximately 385.4 MiB) |
| Sum of the 18 project-prefixed table relations | 390,897,664 bytes |
| Decision relation total (heap + indexes + TOAST) | 265,560,064 bytes |
| Candle relation total (heap + indexes + TOAST) | 124,043,264 bytes |
| Decisions plus candles | 389,603,328 bytes (96.4% of measured database size) |

The user-reported database panel was about 10 MB higher than this SQL measurement; the difference in metric definition, timing, and project cannot be reconciled. The SQL database size is not Supabase total disk usage, WAL, logs, transient space, or reclaimable bytes.

### Exact row counts and relation sizes

Sizes are bytes, shown as `main fork / indexes / TOAST / total`. `main fork` is the value of `pg_relation_size`; `total` is `pg_total_relation_size` and can also include auxiliary relation forks. The row counts and sizes were captured together by read-only SQL at the observation time above.

| Table | Exact rows | Heap / indexes / TOAST / total bytes |
|---|---:|---:|
| `AI_Crypto_Bot_AI_Decisions` | 125,358 | 240,173,056 / 25,288,704 / 8,192 / 265,560,064 |
| `AI_Crypto_Bot_Candles` | 482,914 | 71,303,168 / 52,682,752 / 8,192 / 124,043,264 |
| `AI_Crypto_Bot_Portfolio_Snapshots` | 1,111 | 114,688 / 155,648 / 0 / 294,912 |
| `AI_Crypto_Bot_Market_Data` | 102 | 24,576 / 49,152 / 8,192 / 114,688 |
| `AI_Crypto_Bot_Shadow_Exit_Events` | 35 | 16,384 / 65,536 / 8,192 / 114,688 |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios` | 35 | 32,768 / 40,960 / 8,192 / 106,496 |
| `AI_Crypto_Bot_Trades` | 7 | 8,192 / 81,920 / 8,192 / 98,304 |
| `AI_Crypto_Bot_Positions` | 6 | 8,192 / 32,768 / 8,192 / 81,920 |
| `AI_Crypto_Bot_Status` | 1 | 8,192 / 32,768 / 8,192 / 81,920 |
| `AI_Crypto_Bot_Portfolios` | 1 | 8,192 / 32,768 / 0 / 73,728 |
| `AI_Crypto_Bot_Scanner_Events` | 46 | 8,192 / 49,152 / 8,192 / 65,536 |
| `AI_Crypto_Bot_Watched_Markets` | 102 | 8,192 / 49,152 / 8,192 / 65,536 |
| `AI_Crypto_Bot_Emergency_State` | 1 | 8,192 / 32,768 / 8,192 / 49,152 |
| `AI_Crypto_Bot_Profiles` | 1 | 8,192 / 32,768 / 8,192 / 49,152 |
| `AI_Crypto_Bot_Strategy_Changes` | 0 | 0 / 24,576 / 8,192 / 32,768 |
| `AI_Crypto_Bot_Backtests` | 0 | 0 / 16,384 / 8,192 / 24,576 |
| `AI_Crypto_Bot_Strategies` | 0 | 0 / 16,384 / 8,192 / 24,576 |
| `AI_Crypto_Bot_Strategy_Performance` | 0 | 0 / 16,384 / 0 / 16,384 |

The candle indexes are a substantial part of that relation, but the composite uniqueness key `(symbol, interval, timestamp)` supports idempotent upserts and bounded latest-candle reads. The decision table's indexes support its chronological and per-market readers. No index was identified as safe to drop without workload/query-plan evidence.

### Growth and age evidence

- The prior report measured 399,953,043 database bytes, 123,828 decisions, and 479,908 candles at approximately 11:17 UTC. This observation is about 74 minutes later and shows +4,030,464 database bytes, +1,530 decisions, and +3,006 candles. This is a conditional point-to-point delta, **not** a stable growth rate or forecast; the project mapping is not verified.
- At **2026-11-05 12:33:29 UTC**, the decision table had 125,358 rows. The trailing 24 hours contained 29,070 rows and 51,443,216 summed tuple bytes. This is row payload size, not actual relation growth or billed storage.
- At the same observation, 37,740 decisions were older than three days, with 60,886,256 summed tuple bytes; one was referenced by a paper trade. There were zero decisions older than 30 days. The three-day cohort is a quantifiable archive candidate only if a policy is approved; it is not safe to delete based on current evidence.
- Candle timestamps represent candle/bar time, not insertion time. A read-only count by bar timestamp found:

  | Interval | Older than 30 days | Tuple bytes older than 30 days | Older than 90 days | Tuple bytes older than 90 days | Older than 365 days |
  |---|---:|---:|---:|---:|---:|
  | `1m` | 0 | 0 | 0 | 0 | 0 |
  | `5m` | 0 | 0 | 0 | 0 | 0 |
  | `15m` | 188 | 18,560 | 0 | 0 | 0 |
  | `1h` | 0 | 0 | 0 | 0 | 0 |
  | `4h` | 35,106 | 3,542,392 | 294 | 29,208 | 0 |
  | `1d` | 44,339 | 4,495,184 | 38,252 | 3,877,648 | 11,952 |

  These counts quantify possible cutoffs, not permissible retention. A uniform 30-day cutoff would cover 79,633 candle rows with about 8.06 MB of tuple bytes, but it would remove historical inputs needed for future backtesting and may remove data needed for analyses not currently exercised.
- PostgreSQL's `pg_stat_user_tables` reports an estimated 45,049 dead candle tuples and no `last_autovacuum` timestamp for that table. The estimate does not identify dead-tuple bytes, relation bloat, or reclaimable storage. `pgstattuple` was not installed. The statistics-reset time for `pg_stat_database` was `NULL`, so table-operation counters cannot be assigned a reliable observation window.
- `pg_stat_wal` reported 1,350,100,122 WAL bytes since its reset at `2026-11-03 20:54:19 UTC`. WAL volume is separate from relation size and is not billed database size or a deletion-recovery estimate.

### Egress is a separate, unverified metric

No Supabase Network Traffic/billing breakdown by service, route, time, or response bytes was available. No matching Vercel request/response-byte export was available. The prior AI candle-read request-count observations and row-serialization estimates are not egress measurements. Deleting history cannot be claimed to reduce billed egress, and an archive retrieval path could add Storage or network egress.

## Table-by-table recommendation

Paths refer to the current implementation and local migration design. Current readers/writers are described in [DATABASE.md](../DATABASE.md), [ARCHITECTURE.md](../ARCHITECTURE.md), and the listed code/migration files.

| Table | Current paths, purpose, and dependencies | Recommendation |
|---|---|---|
| `AI_Crypto_Bot_Profiles` | Auth/profile synchronization and ownership root; profiles provision portfolios. Defined in `20261031190000_create_agent_tables.sql`. | Retain. Profile deletion cascades into portfolio history and should not be used as a cleanup mechanism. |
| `AI_Crypto_Bot_Portfolios` | Paper-trading balance/value parent for positions, trades, snapshots, and shadow records; `AI_Crypto_Bot_Run_Paper_Trading()` updates it. | Retain. Deleting a portfolio cascades through financial and simulation history. |
| `AI_Crypto_Bot_Watched_Markets` | Runtime market-universe source of truth; market refresh and AI/paper/market readers use it. Many history tables reference symbols with `ON DELETE RESTRICT`. | Retain. Do not remove markets to clean history; disable them through the supported market control instead. |
| `AI_Crypto_Bot_Positions` | Open/closed paper positions; the paper-trading RPC updates them and the shadow evaluator reads them. Shadow scenarios and events reference positions with cascades. | Retain for paper-trade and shadow comparison audits. Parent deletion would erase shadow history. |
| `AI_Crypto_Bot_Trades` | Actual simulated BUY/SELL audit rows written by the paper-trading RPC; read by trade history, analytics, and exports. The decision FK is `ON DELETE RESTRICT`; deleting a trade sets a shadow scenario's `actual_trade_id` to null. | Retain. Do not delete trades or their source decisions under an unapproved archival policy. |
| `AI_Crypto_Bot_Market_Data` | One current ticker snapshot per symbol, upserted by `lib/market-data.mjs`; consumed by AI, paper trading, dashboard, and shadow evaluation. | No retention cleanup needed; the table is bounded by the 102 tracked symbols and updated in place. |
| `AI_Crypto_Bot_Candles` | Incrementally upserted by `lib/market-data.mjs`; consumed by AI (`lib/ai-engine.mjs`), scanner, and market views; future backtesting/optimization requires historical OHLCV. Unique on symbol/interval/timestamp and references watched markets with `ON DELETE RESTRICT`. | Retain all intervals until the product owner approves an interval-specific policy and archive/retrieval path. Do not trim raw history based only on age. |
| `AI_Crypto_Bot_Strategies` | Versioned strategy catalog for future strategy phases; currently empty. | No current rows to clean. Preserve for the planned strategy capability. |
| `AI_Crypto_Bot_Strategy_Changes` | Append-only, idempotent strategy-change audit; currently empty. Strategy FK is `ON DELETE RESTRICT`. | No current rows to clean. Preserve change history if/when optimization is implemented. |
| `AI_Crypto_Bot_Strategy_Performance` | Historical strategy metrics/ranking inputs; currently empty. | No current rows to clean. Preserve the history required by strategy comparisons. |
| `AI_Crypto_Bot_Backtests` | Results separate from paper-trading records; currently empty. | No current rows to clean. Backtest reproducibility requirements preclude an unapproved retention cutoff. |
| `AI_Crypto_Bot_AI_Decisions` | Appended by `lib/ai-engine.mjs`; read by paper trading, dashboard, analytics, recommendations, exports, and future strategy/backtest paths. A paper trade references a decision with `ON DELETE RESTRICT`. | Largest growth candidate, but retain until an archive and transparent query path preserve full history. The 3-day candidate includes 37,740 rows (one trade-referenced); 30 days currently includes none. |
| `AI_Crypto_Bot_Status` | Singleton current state updated by AI analysis; read by dashboard/status flows. | No periodic cleanup; it is bounded current state, not history. |
| `AI_Crypto_Bot_Portfolio_Snapshots` | Appended by paper-trading refreshes and read by dashboard charts, analytics, and exports. | Retain for performance history. A future aggregation/sampling policy would change historical fidelity and requires product approval. |
| `AI_Crypto_Bot_Scanner_Events` | Provider/data-quality error records written by `lib/market-data.mjs`; read for operational diagnosis. Only 46 exact rows; size is 65,536 bytes. | Preserve until an operational log-retention period is selected. Cleanup now offers negligible database reduction and could remove failure evidence. |
| `AI_Crypto_Bot_Emergency_State` | Emergency control event history; the newest row represents current state. | Retain as an operational/safety audit. If a separate current-state snapshot is later introduced, historical retention still requires approval. |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios` | Per-position/rule state used by `lib/shadow-exits.mjs` and dashboard; stores hypothetical outcomes and actual-close comparison. Position/portfolio deletion cascades. | Retain for prospective scenario analysis and actual-vs-hypothetical comparison; no retention period is established. |
| `AI_Crypto_Bot_Shadow_Exit_Events` | Append-only tracking, trigger, data-quality, failure, and actual-close events; unique dedupe key; cascades from scenario/position. | Retain for traceability. The 35-row table is small; deletion would reduce auditability more than storage risk. |

## Foreign keys, index behavior, and cleanup hazards

Read-only production catalog inspection confirmed:

- `AI_Crypto_Bot_Trades.ai_decision_id` references decisions with `ON DELETE RESTRICT`; one decision older than three days is already trade-referenced.
- Candle identity/upsert depends on unique `(symbol, interval, timestamp)`; candles and decisions reference watched markets with `ON DELETE RESTRICT`.
- Portfolio deletion cascades to positions, trades, and snapshots. Shadow scenarios cascade from positions/portfolios, and shadow events cascade from scenarios/positions. Actual-trade deletion nulls the scenario's trade reference.
- Strategy changes, performance, and backtests reference strategies with restrictive deletes.
- Dropping the candle uniqueness index would break duplicate-safe upserts and the bounded lookup path. No index-removal proposal is justified by size alone.

An ordinary PostgreSQL `DELETE` does not guarantee that the Supabase database-size metric immediately decreases. `VACUUM` normally makes dead space reusable; it does not promise to shrink the relation file. `VACUUM FULL` rewrites and locks tables and is not a safe default cleanup step. No production deletion, vacuum, table rewrite, or index change was attempted.

## Archive and periodic-cleanup options

The [retention section in ROADMAP.md](../../ROADMAP.md) is explicitly backlog. Its 30/90/365-day decision options and interval-specific candle options are questions for review, not approved retention periods. The prior [egress/size report](./SUPABASE_EGRESS_AND_DATABASE_SIZE_OPTIMIZATION_REPORT.md) likewise labels its three-day decision window as an unapproved proposal.

Two policy paths remain:

1. **Keep all current history in PostgreSQL.** Safest against current audit, analytics, reproducibility, and backtesting requirements; does not reduce future database growth.
2. **Approve a per-table/per-interval hot window and archive older records first.** Before deletion, choose an archive service and measure storage/egress costs; preserve all required fields with schema version, date range, row count, and integrity manifest; verify a complete restore; and make analytics, exports, decision audit, and future backtests transparently query the archive. Stage the path and compare historical results before considering deletion. Current candidate tuple sizes above are not guaranteed PostgreSQL space savings.

No archive store, manifest, restore process, or archive/live union query exists in the repository. No retention duration can be derived from current product behavior alone.

Periodic cleanup is **not configured today**:

- `pg_cron` is not installed; `pg_stat_statements` is installed; `pgstattuple` is not installed.
- `vercel.json` has no Vercel Cron configuration. [SCHEDULING.md](../SCHEDULING.md) documents externally scheduled existing endpoints, but the external scheduler's saved jobs were not available to inspect.
- There is no cleanup endpoint or current cleanup RPC. Future periodic execution may reuse the existing external scheduler and an existing server-side invocation, with a bounded service-role operation and separate error reporting; it must not add an `/api` function or make a cleanup failure block paper trading. The exact existing invocation/trigger path remains an implementation decision after policy approval.

## Decisions required before implementation

1. Confirm the intended Supabase project and match it to the read-only connection; confirm whether the reported dashboard values refer to that same project and environment.
2. Choose **retain all** or specify approved hot-retention windows separately for AI decisions, each candle interval, portfolio snapshots, scanner/error events, emergency events, and shadow-exit history.
3. If any history is to leave PostgreSQL, choose the archive backend, acceptable storage/egress cost, required retrieval latency, and whether every existing analytics/export/history path must transparently include archived rows.
4. Approve an integrity, restore, and staging-equivalence procedure, plus a separate deletion approval after a fresh dry-run count/byte report.
5. If periodic cleanup is approved, choose its existing scheduler trigger, bounded batch size/cadence, lock/retry policy, observability, and failure isolation from trading.

**Until these decisions are made, retain the current rows and do not implement cleanup or archival.**

## Read-only production checks performed

All commands below were read-only. No migration, data mutation, setting change, deployment, or delete was executed.

- Exact `count(*)` for each of the 18 project-prefixed tables; joined to `pg_catalog.pg_class`/`pg_catalog.pg_namespace` for `pg_relation_size`, `pg_indexes_size`, `pg_total_relation_size`, and `pg_database_size`.
- Decision age query at `2026-11-05 12:33:29 UTC`: exact total, last-24-hour and older-than-three-day counts, `sum(pg_column_size(...))` for those cohorts, older-than-30-day count, and the number of older-than-three-day decisions referenced by `AI_Crypto_Bot_Trades`.
- Candle age query grouped by interval using the `timestamp` column and `count(*)`/`sum(pg_column_size(...))` for 30-, 90-, and 365-day cutoffs.
- `pg_catalog.pg_constraint`/`pg_get_constraintdef` inspection for primary, unique, and foreign-key definitions on major history and parent tables; `pg_catalog.pg_indexes` inspection for decision, candle, trade, snapshot, scanner, and shadow indexes.
- `pg_catalog.pg_stat_user_tables` inspection of estimated live/dead tuples, insert/update/delete counters, and autovacuum/analyze timestamps; `pg_catalog.pg_stat_database` check of `stats_reset`; `pg_stat_wal` check of WAL bytes and reset time.
- `pg_catalog.pg_extension` query for `pg_cron`, `pg_stat_statements`, and `pgstattuple`; `pg_cron` and `pgstattuple` were not installed.
- Supabase table listing showed 18 project tables with RLS enabled. Supabase migration listing returned `[]`; the migration-history relation was absent.

The row counts, relation sizes, and cohort counts are observations of the configured connection at the times listed, not continuous monitoring or a verified billing-cycle report.

## Changes and validation

- Added only this assessment report. No application code, schema, migration, API route, scheduler, or configuration changed.
- No tests or build were run because no executable code or migration was changed. `git diff --check` exited 0; because the new report is untracked, a separate PowerShell trailing-whitespace scan also completed with no matches.
- No production data was deleted or archived. No production migration was applied. No deployment or production setting was changed.
