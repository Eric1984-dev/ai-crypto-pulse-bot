# Archive Retention Plan

**Assessment date:** 2026-11-07  
**Mode:** Read-only repository and prior-evidence review. No SQL was executed; no database, code, configuration, migration, or deployment was changed.

## Executive decision

The archive database is reported by the owner as deployed, but this assessment did not connect to either database or execute the health endpoint. Its schema, contents, backup, free space, and restore path are therefore not independently verified.

**Do not delete production rows yet.** The current repository contains an archive schema and an archive-health monitor, but no data-copy job, integrity manifest, archive reader, or restore automation. The monitor confirms connectivity and database size only; it does not verify that archive tables exist or contain validated history.

Subject to a fresh production preflight and a verified archive copy/restore, old candle rows outside the current runtime windows are the only substantial cohort that appears removable without changing today's bot, scanner, market-detail, or Analytics behavior. Such removal would reduce access to history in Supabase and would make future backtesting/manual research depend on a restore; the archive is not queried by the application.

AI decisions, trades, positions, portfolio snapshots, market configuration, and current operational state should remain online. In particular, the dashboard's AI Decisions KPI counts Supabase decision rows, exports default to all-time, and paper trades have restrictive references to their source decisions. The documented retention backlog is not an approved policy.

## Scope and evidence limits

- The owner reports the Raspberry Pi archive PostgreSQL database was deployed. No live Pi, Supabase, Vercel, or tunnel check was made for this report.
- Per the read-only/no-SQL constraint, no fresh production counts, sizes, timestamp ranges, enabled-market list, or foreign-key checks were collected. Production figures below are historical measurements from the reports cited below, captured on 2026-11-06. They must not be used as current deletion counts.
- The prior archive feasibility report confirmed project `jgnuhgsceilhxugffauj`; this report does not independently reconfirm that mapping.
- Current behavior was checked against local code and migrations. Hosted configuration may differ: the README/Roadmap document an unresolved production verification item for the AI candle RPC.
- No archive import, deletion, vacuum, migration, deployment, or test run was performed. This is a retention recommendation, not authorization to change production data.

## Live consumers and minimum online records

| Dataset | Current consumers and dependencies | Minimum online set / recommendation |
|---|---|---|
| `AI_Crypto_Bot_Candles` | AI analysis reads up to 150 newest candles per market and interval. A timeframe needs at least 26 valid candles; at least two fresh timeframes are required. Market detail can request up to 500. Scanner reads daily candles over 32 days and hourly candles over 10 hours. Scheduled refresh uses the latest stored timestamp as its checkpoint. | Keep the union of the latest 500 candles for each enabled market/interval, scanner windows, and any rows needed for fresh AI coverage. If a pair has fewer than 500 rows, retain all of its rows. Recalculate this set from a fresh snapshot before any deletion. Older rows are only conditional archive/deletion candidates. |
| `AI_Crypto_Bot_AI_Decisions` | Paper trading consumes current stored decisions; scanner reads recent decisions (up to 5,000, within its 30-day query window); the dashboard shows five recent items but reports the exact Supabase-visible decision count; Analytics supports 30/90/365 days; decision exports default to all-time. Trades reference decisions with `ON DELETE RESTRICT`. | For runtime alone, keep each enabled market's latest usable decision, the scanner's required recent set, and every trade-referenced decision. To preserve all current product behavior, keep all rows: any deletion changes the dashboard count or all-time export, and can truncate Analytics. At the 2026-11-06 snapshot, every observed decision was within the 365-day Analytics window. |
| `AI_Crypto_Bot_Trades` | Paper-trade audit/history, Dashboard and paginated Trade History, trade statistics, Analytics and exports. Each trade references a portfolio and market; its decision reference is restrictive. Shadow-exit scenarios can reference the actual trade and would lose that reference if a trade were deleted (`ON DELETE SET NULL`). | Retain all trades and their source decisions. Removing a trade can also damage realized-P&L/history and actual-versus-hypothetical exit comparisons. |
| `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Portfolios` | Open positions and balances drive paper trading, risk checks, Dashboard, Portfolio and Analytics. Position/scenario history has cascading relationships to portfolios and positions. | Retain all portfolios and positions, especially all open positions. Do not use parent deletion as a cleanup mechanism. |
| `AI_Crypto_Bot_Portfolio_Snapshots` | Dashboard history chart, Analytics time series and portfolio exports read stored snapshots. Snapshots are written during paper-trading refreshes. | Retain all snapshots unless a separate sampling/retention policy is approved and every history/export use is addressed. |
| `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Market_Data` | Watched markets define the runtime universe and are foreign-key parents for candles, decisions, trades, positions and other history. Market data is the latest operational ticker snapshot used by analysis/trading/dashboard paths. | Retain all watched-market identity rows (disable rather than delete) and the latest market snapshot for each active market. |
| `AI_Crypto_Bot_Status`, `AI_Crypto_Bot_Emergency_State` | Current agent status and emergency controls are read by the dashboard and influence operation. Emergency-state rows also provide an audit trail. | Keep the current status/emergency state and retain event history until an explicit audit-retention policy is set. |
| `AI_Crypto_Bot_Scanner_Events`, `AI_Crypto_Bot_Shadow_Exit_Scenarios`, `AI_Crypto_Bot_Shadow_Exit_Events` | Operational failure diagnosis, current shadow-exit tracking, and actual-versus-hypothetical comparisons. These have market, position, scenario, portfolio, or trade dependencies. | Copy for preservation; do not prune without a separate retention decision. Prior snapshots show these are small compared with candles and decisions. |
| `AI_Crypto_Bot_Strategies`, `AI_Crypto_Bot_Strategy_Changes`, `AI_Crypto_Bot_Strategy_Performance`, `AI_Crypto_Bot_Backtests`, `AI_Crypto_Bot_Profiles` | Strategy history and future simulation/backtesting; profiles and strategies are parent records for dependent tables. | Preserve schema and all rows. Several were empty in the historical snapshot, but future or newly created rows must not be assumed disposable. |

### Candle-specific cautions

The 500-row rule is a conservative current-use floor, not a guarantee of complete history. AI freshness limits are 30 minutes (`1m`), 2 hours (`5m`), 6 hours (`15m`), 12 hours (`1h`), 24 hours (`4h`) and 72 hours (`1d`). A stale interval is excluded, and the engine returns `WAIT` with `STALE_CANDLE_DATA` if fewer than two sufficiently populated fresh intervals remain.

The candle-ingestion audit found an historical BEAM-EUR `1m` discrepancy: 997 provider-returned timestamps were absent from Supabase in the examined episode. Other missing minute slots in that audit matched the provider's no-trade behavior. The refresh path checkpoints from the latest stored candle and does not search older holes, so a future archive must faithfully record existing gaps and must not describe timestamp coverage alone as a complete replay dataset.

## Historical production measurements

The latest available destination assessment measured Supabase at approximately **2026-11-06 19:17 UTC**. Relation size is PostgreSQL storage (table/TOAST/index footprint); row payload is a `pg_column_size` aggregate. Neither is an archive-file size or a guaranteed amount of space recoverable after deletion.

| Dataset | Rows | Timestamp range | Total relation size | Summed row payload |
|---|---:|---|---:|---:|
| `AI_Crypto_Bot_AI_Decisions` | 162,078 | 2026-11-01 05:57:38 – 2026-11-06 19:16:09 UTC | 350,445,568 bytes | 278,349,360 bytes |
| `AI_Crypto_Bot_Candles` | 551,380 | 2025-06-13 – 2026-11-06 19:15 UTC | 131,555,328 bytes | 55,012,602 bytes |
| **Combined** | **713,458** | — | **482,000,896 bytes** | **333,361,962 bytes** |

Measured whole-database size was **497,175,699 bytes**. The table relations together are larger than row payload because they include indexes, TOAST, and relation overhead.

### Retention-cohort estimates from that snapshot

These are historical candidates to investigate, not current eligibility:

| Dataset | Historical online/runtime set | Outside-set candidate | Candidate row payload | Deletion interpretation |
|---|---:|---:|---:|---|
| Decisions | 5,000 newest plus five trade-referenced decisions in the observed result | 157,073 rows | 269,491,432 bytes | **Not safe to delete under current behavior.** The cohort was within Analytics' 365-day window; all-time exports and the dashboard's exact decision count also depend on Supabase. |
| Candles | 298,552 rows: latest 500 per market/interval, scanner windows and coverage requirements | 252,828 rows | 24,303,588 bytes | Potentially removable only after a complete archive copy/restore and a fresh keep-set calculation. Deletion would remove Supabase access to that older history. |

At the same snapshot, 102 markets were enabled. The measured candidate candle payload is not a forecast of the archive PostgreSQL footprint or of Supabase quota recovery. A permissive sum of both outside-set payload cohorts is about **293.8 MB**, but the decision component is not a permissible deletion cohort today.

### Short growth observation

A prior point approximately 10:02 UTC recorded 469,331,091 bytes for the database, 150,960 decisions and 530,614 candles. By approximately 19:17 UTC, measurements were 497,175,699 bytes, 162,078 decisions and 551,380 candles. Over about 9.25 hours this is a point-to-point increase of approximately:

- **27.8 MB** whole-database size (about 3.0 MB/hour);
- **11,118 decisions** (about 1,202/hour);
- **20,766 candles** (about 2,245/hour).

This short interval is historical and workload-dependent; it is not a growth forecast. Linear annualization would be misleading. Storage returned by `pg_database_size` also does not tell how much a proposed deletion would release.

## Foreign keys and archive import order

The generated [archive schema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql) contains the 18 project tables and the core keys/constraints. The schema analysis documents 21 foreign-key relationships, including the minimal `auth.users(id)` compatibility anchor. For an import, load parent/reference rows before children:

1. `auth.users` UUID anchors, then `AI_Crypto_Bot_Profiles` if profile rows are included.
2. `AI_Crypto_Bot_Watched_Markets` and `AI_Crypto_Bot_Strategies`.
3. `AI_Crypto_Bot_Portfolios`.
4. `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Candles`, and `AI_Crypto_Bot_AI_Decisions`.
5. `AI_Crypto_Bot_Trades` after portfolios, markets and referenced decisions.
6. Strategy changes, strategy performance and backtests after strategies; portfolio snapshots after portfolios; scanner events after markets.
7. Status and emergency-state rows.
8. Shadow-exit scenarios after positions/portfolios/markets/trades; shadow-exit events after scenarios/positions.

For a candle-only archive, include the required watched-market identity rows before candles. Preserve original IDs, timestamps, numeric values and JSONB values using explicit column lists; do not regenerate IDs or rely on defaults for historical rows. Retain the source-side watched-market rows; deleting them is not part of candle retention.

The generated schema is a relational store, not a behavioral clone of Supabase. It omits Supabase Auth behavior, RLS/policies, application roles/grants, triggers, RPCs and realtime. Its `auth.users` table is only a key anchor. The schema validation report found some documentation summaries still saying 16 tables, while the detailed inventory and generated schema contain 18; reconcile this discrepancy before future schema changes.

## Archive readiness and validation gaps

The archive monitor's database check runs `current_database()` and `pg_database_size(current_database())` and compares the returned database name with the configured name. It does **not** check archive table/column/constraint coverage, imported rows, backup health, or restoreability. A green health card is therefore not evidence that an archive is ready.

The repository currently has no archive copy/export job, manifest/checksum process, archive-aware Analytics/export reader, or tested restore procedure. Existing dashboard Analytics, trade/portfolio exports and decision exports query Supabase only. If old history is absent there, Analytics may be incomplete, all-time exports will omit it, and the dashboard decision count will change. Manual access to archived history would require connecting to or restoring the archive; no current Dashboard or API path does so.

Before calling the Pi ready, independently verify (under a later authorized read-only check) the target database identity, PostgreSQL version, deployed schema, constraints/indexes, row-level archive roles and grants, available disk, backup destination/frequency, and a successful restore from backup. The previous schema validation was static and explicitly did not inspect the Pi target.

## Recommended staged plan

### Stage 0 - Set policy and verify prerequisites

- Decide whether the goal is a cold copy, lower Supabase storage, or archived data visible in Analytics/exports; these require different implementations.
- Choose per-table and per-candle-interval retention windows. The Roadmap's 30/90/365-day decision options and interval-specific candle options are backlog questions, not policy.
- Confirm Pi schema and capacity, access controls, encrypted network path, backup location, restore owner, and retention of independent backups. Do not rely on the same Pi disk as the only archive copy.

### Stage 1 - Copy without deletion

- Start with a bounded candle cohort and include the watched-market lookup rows it references. Capture a consistent source snapshot/cutoff and leave every Supabase row unchanged.
- Record schema/version and source project reference, cutoff timestamp, per-table counts and timestamp ranges, per-market/interval counts, duplicate/constraint checks, and deterministic chunk checksums in a manifest.
- Preserve provider gaps and note them in the manifest; do not fabricate missing candles or infer completeness from min/max timestamps.

### Stage 2 - Restore and integrity rehearsal

- Restore the archived copy into an isolated PostgreSQL-compatible target from the stored backup, not merely from the live source.
- Compare exact IDs, per-table and per-market/interval counts, timestamp boundaries, and chunk checksums. Check PK/unique/FK violations, invalid decision fields, candle OHLC constraints, and trade-to-decision references.
- Run representative historical queries and compare their outputs with the same frozen source snapshot. Document restore duration, required software/roles, and the operational restore steps.
- Keep Supabase untouched until this stage passes and the owner accepts the consequences of any missing history in Supabase-only interfaces.

### Stage 3 - Separate deletion preflight (requires explicit approval)

- Run fresh, read-only production counts and compute exact candidate IDs against current enabled markets, latest decisions, trade references, Analytics windows, all-time exports, scanner query limits, candle freshness/coverage, market-detail limits and scheduler checkpoints.
- Exclude all protected rows and compare the candidate IDs and checksums to the validated archive manifest. Obtain a current recoverable Supabase backup and confirm a tested restore.
- Present exact row counts, relation sizes, payload estimates, expected user-visible effects, and rollback steps for review. **No deletion is authorized by this report.**
- If any Analytics/export/history surface must include archived rows, implement and validate an archive-aware server-side read path before approving deletion. Reuse existing API routes and preserve authorization, pagination, ordering and exact counts.

### Rollback

For a copy-only stage, stop using the archive and leave Supabase unchanged. After any separately approved deletion, restore the exact original rows and IDs from the validated archive or a recoverable Supabase point-in-time backup, in dependency order. Compare conflicts before reinsertion, verify foreign keys and counts, then re-run representative Analytics/export/history checks. Do not treat an untested archive copy as rollback protection.

## Risks and decisions required

1. **Pi deployment and recovery remain unverified.** The user reports successful deployment, but no target inspection, backup check, or restore test was allowed here.
2. **No archive data pipeline exists.** The health service is monitoring only; every copy and validation step needs a separately approved implementation.
3. **Historical research can be lost from normal workflows.** Current Analytics and exports are Supabase-only; Phase 16 simulation/backtesting is planned and has no archive reader.
4. **Candle completeness is uncertain.** Existing provider/data gaps mean that archival preserves the data that exists, not necessarily every market event.
5. **Storage savings are uncertain.** Row-payload sums are not physical relation bytes. `DELETE` normally makes space reusable; it does not guarantee an immediate reduction in relation-file or Supabase-reported storage. Rewrites such as `VACUUM FULL` have locking and temporary-space risks and are not part of this plan.
6. **Current retention policy is undecided.** The Roadmap says no deletion without a documented policy and requires preserving Analytics, Recommendations, Strategy Simulation and Backtesting.
7. **Schema documentation has a 16-versus-18 table summary inconsistency.** The archive SQL, detailed inventory and current README describe 18 project tables.

## Readiness conclusion

| Area | Assessment |
|---|---|
| Current runtime keep set | Identified from local code/migrations; recheck against live state before any retention change |
| Historical size/growth | Measured in prior reports only; not current |
| Candle archive candidate | Historically quantified; conditional on fresh hot-window calculation and validated restore |
| Decision deletion candidate | None demonstrated under all current dashboard, Analytics, trade-reference and export behavior |
| Raspberry Pi schema/data/backup readiness | Not independently verified |
| Archive-aware Dashboard/Analytics/exports | Not implemented |
| Production deletion | Not authorized |

**Recommendation:** proceed only with a copy-only proof of concept after verifying the Pi schema and independent backup/restore prerequisites. Preserve all Supabase data during that proof of concept. Treat any later deletion as a separate, explicitly approved operation with fresh evidence.

## References

- [Supabase historical-data archive destination assessment](./SUPABASE_HISTORICAL_DATA_ARCHIVE_DESTINATION_ASSESSMENT.md)
- [Supabase decision/candle archive feasibility report](./SUPABASE_AI_CANDLE_HISTORY_ARCHIVE_FEASIBILITY_REPORT.md)
- [Supabase retention and cleanup assessment](./SUPABASE_DATA_RETENTION_AND_CLEANUP_ASSESSMENT.md)
- [Archive schema analysis](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md)
- [Archive schema validation](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_VALIDATION.md)
- [Archive Server connectivity report](./ARCHIVE_SERVER_CONNECTIVITY.md)
- [Archive Server monitoring report](./ARCHIVE_SERVER_MONITORING.md)
- [AI Engine](../../lib/ai-engine.mjs), [market data](../../lib/market-data.mjs), [market scanner](../../lib/market-scanner.mjs), [Analytics](../../lib/analytics.mjs), [exports](../../lib/exports.mjs), [dashboard API](../../api/dashboard-data.mjs)
- [Base database migration](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql), [paper-trading migration](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql), [database AI-analysis migration](../../PostgreSQL/migrations/20261106120000_ai_analysis_database_mode.sql)
