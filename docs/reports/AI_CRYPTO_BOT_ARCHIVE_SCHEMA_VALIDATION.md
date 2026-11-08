# AI Crypto Bot Archive Schema Validation

**Review date:** 2026-11-07  
**Scope:** Static, read-only review of the generated archive DDL against local Supabase migrations and schema/operations documentation. No SQL was executed; neither the Raspberry Pi database nor Supabase was queried or changed.

## Executive decision

**Conditional approval for an empty, standalone PostgreSQL 17 archive database only. Do not execute against an uninspected database yet.**

The generated DDL includes the 18 project tables and the production table-level keys and indexes found in the local migrations. The table dependency order and secondary-index placement are valid. No unsupported PostgreSQL 17 table or index feature was identified by static review.

Before deployment, confirm that the target is a clean standalone database, check for an existing `auth` schema or `auth.users` relation, confirm the DDL executor's privileges and intended object owner, and establish separate least-privilege archive writer/reader roles. The DDL is not a Supabase or live-bot replacement: it deliberately omits RLS, Supabase roles and policies, triggers, RPCs, realtime publication membership, and seed rows.

This conclusion is about the SQL's static compatibility with PostgreSQL 17. Runtime execution, actual Pi PostgreSQL version, target object collisions, ownership, permissions, and restore/import behavior remain unverified because execution and database access were prohibited.

## Validation results

| # | Check | Result | Evidence / qualification |
|---:|---|---|---|
| 1 | All `AI_Crypto_Bot_` tables included | **PASS** | The 16 tables in the base migration plus the two Shadow Exit tables are all present in the generated DDL: 18 total. The README and `DATABASE.md` inventory also describe 18. |
| 2 | Primary keys preserved | **PASS** | All 18 project tables have their source UUID `id` primary key. The extra `auth.users.id` key is a compatibility anchor, not a production project table. |
| 3 | Foreign keys preserved | **PASS** | All 20 inter-project foreign keys and the `Profiles.id → auth.users.id` foreign key are present, including their `ON DELETE` behavior. |
| 4 | Indexes preserved | **PASS** | All 20 explicitly created production indexes are present. The 18 primary-key and 10 unique constraints also create their 28 backing indexes. No extra project index was introduced. |
| 5 | Unique constraints preserved | **PASS** | All 10 non-primary unique keys are represented, including candle identity, trade idempotency, strategy version, and shadow-event deduplication. |
| 6 | Supabase-specific objects identified | **CONCERN — intentionally omitted** | The script models `auth.users` only as a minimal UUID key anchor. It does not reproduce Supabase Auth, `auth.uid()` policies, Supabase roles/grants, Auth triggers, RPC functions, or `supabase_realtime`. See below. |
| 7 | Unsupported PostgreSQL features | **PASS — none identified statically** | UUID, `jsonb`, `numeric`, `timestamptz`, check/unique/foreign-key constraints, partial indexes, regular-expression checks, and `gen_random_uuid()` are supported by PostgreSQL 17. This is not an execution test. |
| 8 | Dependency order | **PASS** | Referenced tables exist before their dependent tables are created. |
| 9 | Table creation order | **PASS** | The DDL order matches the valid dependency graph, including decisions before trades and trades before shadow scenarios. |
| 10 | Index creation order | **PASS** | Table constraints are declared with their tables; all 20 explicit indexes are created after all tables. No index references a missing table or column. |

## Object coverage

### Tables

The source migrations create 16 prefixed tables in [`20261031190000_create_agent_tables.sql`](../../supabase/migrations/20261031190000_create_agent_tables.sql#L3) and two more in [`20261105104400_shadow_exit_scenarios.sql`](../../supabase/migrations/20261105104400_shadow_exit_scenarios.sql#L3). All 18 are present in [`AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql`](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql#L10). The later `Trades.ai_decision_id` addition is included at the end of the trade columns, with its restrictive foreign key and index, as added by [`20261101154600_phase08_paper_trading.sql`](../../supabase/migrations/20261101154600_phase08_paper_trading.sql#L3).

No project table, column, primary key, foreign key, unique constraint, or explicit index required by those table migrations was found missing in the generated archive DDL.

### Keys and indexes

The generated DDL contains 21 foreign-key relationships: 20 between project tables and one from `Profiles` to the compatibility `auth.users` table. The constraint-backed index count is 28 (18 primary keys and 10 additional unique keys); adding the 20 explicit indexes gives 48 project-table indexes. The compatibility anchor adds one additional primary-key index outside the project-table count.

The explicit index set matches the base migration's 14 indexes, the Phase 08 migration's three trade/decision indexes, and the Shadow Exit migration's three indexes. All are placed after table creation. Primary-key and unique indexes are created when PostgreSQL creates the corresponding table constraints.

### Dependency and creation order

The generated table order is valid:

1. Minimal `auth.users` key anchor
2. `Profiles`
3. `Watched_Markets` and `Strategies`
4. `Portfolios`
5. `Positions`, market data, candles, and AI decisions
6. `Trades`
7. Strategy changes, strategy performance, and backtests
8. Status, portfolio snapshots, scanner events, and emergency state
9. Shadow exit scenarios
10. Shadow exit events

Independent tables can be ordered differently without changing correctness. For data import, use the same parent-before-child sequence; in particular, import market rows before symbol-referencing history, AI decisions before trades, and trades before shadow scenarios. Profile UUIDs must first be inserted into `auth.users`.

The explicit index definitions appear only after all table definitions. Their relative order is not a correctness dependency; the generated order follows the migration sequence.

## Supabase-specific and intentionally omitted objects

The local migrations include objects beyond the archive table/index schema:

- **Supabase Auth:** the production profile FK references managed `auth.users`; the base migration also installs profile synchronization triggers on that relation. The archive DDL creates only `auth.users(id uuid PRIMARY KEY)`. It cannot authenticate users, synchronize emails, or satisfy any other Supabase Auth behavior.
- **RLS and policies:** production migrations enable RLS and define authenticated read policies for all project tables, including the two Shadow Exit tables. The archive DDL does not enable RLS or copy those policies; policies depend on Supabase roles and `auth.uid()`. Table access therefore depends on PostgreSQL role ownership and grants configured separately.
- **Functions and triggers:** portfolio provisioning, `updated_at` maintenance, paper-trading functions, Analytics functions, candle RPCs, shadow-exit evaluation, and optional database-mode AI-analysis functions are not copied. The archive schema cannot run the bot, dashboard RPCs, or their triggers. In particular, archive updates will not automatically maintain `updated_at`.
- **Supabase Realtime:** the publication migration adds selected existing tables to `supabase_realtime`; the archive DDL does not create a publication or realtime behavior.
- **Seed rows:** the initial watched markets, singleton `IDLE` status, and initial `NORMAL` emergency state are inserted by a separate seed migration, not by the schema DDL. An empty archive database will have no rows until restored or loaded. Foreign keys require referenced watched-market and profile identity rows to be loaded first.
- **Supabase roles and grants:** the SQL does not create `anon`, `authenticated`, or `service_role`, nor does it grant archive-user privileges. It must not be used as evidence that the archive has least-privilege access controls.
- **Optional internal schema:** the database-mode AI analysis migration creates `AI_Crypto_Bot_Internal` and helper functions. It is not required for archival storage and is not included.

These omissions are appropriate for a standalone history store only if it is not exposed as a live application database. Keep network access restricted and configure a dedicated archive owner/writer and a separate read-only health-check account. The connectivity runbook specifies that the health-check user should be read-only; the schema script does not implement that role or its grants.

## Potential deployment issues and risks

1. **Existing-object collision — preflight blocker.** The script deliberately has no `IF NOT EXISTS` clauses and creates `auth` and `auth.users`. It is one-time DDL for an empty target. If `auth` or any project table/index already exists, execution will fail rather than reconcile it. Confirm the target database and inspect its catalog before any later approved execution.
2. **Auth compatibility anchor is not portable to a Supabase database.** The stub will collide with Supabase's real `auth` schema if this file is run there. It is solely for standalone PostgreSQL. If another existing object is used as the identity anchor, preserve the FK intentionally and document the alternative rather than dropping the FK silently.
3. **Ownership and grants are unspecified.** The executing role needs permission to create the schema, tables, constraints, and indexes. Objects will be owned according to the executing role; a superuser-run script may leave the archive service account without access. Select the intended owner and grant only the needed permissions separately before loading data.
4. **No row-level security.** Unlike production, there is no RLS barrier. Misconfigured PostgreSQL grants, network exposure, or reuse of a broad application credential could expose profile emails, trades, decisions, or portfolio history. The minimal `auth.users` table does not provide authorization.
5. **No seed data or migration/version ledger.** Empty tables do not establish the active market universe or operational state. Import data with explicit columns and parent-before-child ordering; record the source schema version and verify counts, IDs, constraints, and indexes after restore. The archive SQL is not a repeatable migration framework.
6. **Possible source/target drift.** This review compares the generated file with local migration files and documentation. Prior repository reports state that the hosted Supabase migration history was not fully reconciled. The target Raspberry Pi schema and actual PostgreSQL version were not inspected, so do not assume the script matches a remote live catalog or that the Pi database is empty.
7. **Not a drop-in bot database.** Functions, RLS, triggers, realtime, and application grants are absent by design. Pointing application or scheduler configuration at this archive would change security and runtime behavior and is not supported.
8. **Operational capacity and recovery are unverified.** This review did not inspect Pi disk capacity, backups, restore procedures, or archive data volume. Validate free disk space and a recoverable backup before a separately approved deployment/import.

The top-level `BEGIN`/`COMMIT` makes the DDL transactional on PostgreSQL. A collision or permission error should abort the transaction, but this behavior was not runtime-tested here.

## Documentation consistency

The generated DDL and the `DATABASE.md` table inventory agree on 18 project tables. Some older/current-summary passages still say 16: [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#L18) describes migrations for 16 application tables, and [`docs/DATABASE.md`](../DATABASE.md#L101) says RLS is enabled on 16 tables. The base migration did define 16; the two Shadow Exit tables were added later and also have RLS enabled. The README's current summary and the detailed database inventory describe 18. Treat the “16” statements as stale summary counts, not as evidence that the two Shadow Exit tables should be omitted.

## Deployment recommendation

Use the generated file only for a **fresh standalone PostgreSQL 17 archive database**, after the database owner confirms:

1. The target database, server version, and empty-object preflight.
2. The `auth.users` compatibility anchor is acceptable and will contain only UUID identity keys needed for imported profiles.
3. The executing owner and separate least-privilege archive writer/read-only health roles.
4. Network restrictions, TLS, backups, disk headroom, and a tested restore plan.
5. Data will be imported in dependency order and validated after restore.

Until these checks are complete, the deployment status is **not verified**. No database changes, data imports, SQL execution, or deployments were performed for this review.

## Evidence

- [`AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql`](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
- [`AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md`](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md)
- [`20261031190000_create_agent_tables.sql`](../../supabase/migrations/20261031190000_create_agent_tables.sql)
- [`20261031190100_seed_initial_data.sql`](../../supabase/migrations/20261031190100_seed_initial_data.sql)
- [`20261101154600_phase08_paper_trading.sql`](../../supabase/migrations/20261101154600_phase08_paper_trading.sql)
- [`20261102130000_phase11_realtime_publication.sql`](../../supabase/migrations/20261102130000_phase11_realtime_publication.sql)
- [`20261105104400_shadow_exit_scenarios.sql`](../../supabase/migrations/20261105104400_shadow_exit_scenarios.sql)
- [`20261106120000_ai_analysis_database_mode.sql`](../../supabase/migrations/20261106120000_ai_analysis_database_mode.sql)
- [`DATABASE.md`](../DATABASE.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`ARCHIVE_SERVER_CONNECTIVITY.md`](./ARCHIVE_SERVER_CONNECTIVITY.md)
- Prior archive/retention assessments: [`SUPABASE_AI_CANDLE_HISTORY_ARCHIVE_FEASIBILITY_REPORT.md`](./SUPABASE_AI_CANDLE_HISTORY_ARCHIVE_FEASIBILITY_REPORT.md), [`SUPABASE_HISTORICAL_DATA_ARCHIVE_DESTINATION_ASSESSMENT.md`](./SUPABASE_HISTORICAL_DATA_ARCHIVE_DESTINATION_ASSESSMENT.md), and [`SUPABASE_DATA_RETENTION_AND_CLEANUP_ASSESSMENT.md`](./SUPABASE_DATA_RETENTION_AND_CLEANUP_ASSESSMENT.md)
