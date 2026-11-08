# AI Decision Archive POC Readiness

**Assessment date:** 2026-11-07
**Mode:** Static repository/schema review and validation-plan generation. No SQL was executed, no database was queried or changed, and no decision rows were copied.

**Subsequent operational update (2026-11-09):** The user reports that the first manual `npm run sync:ai-decisions` run succeeded and copied data to PostgreSQL on the Pi. Exact counts and copy completeness were not provided or independently verified. The verdict and blockers below describe the earlier assessment state.

**Implementation update:** A manual Pi pull CLI is now generated at `archive-server/src/archive-ai-decisions.mjs`, with separate installation and validation guides. It has not been run. The readiness findings below still apply: live identity, privileges, schemas, archive anchors, and current counts are unverified.

## Verdict

**Structurally ready; operational copy readiness is not yet verified.**

The source migration and archive DDL define compatible decision tables. The only direct parent dependency for inserting an AI decision is its watched-market symbol. The user reports that `AI_Crypto_Bot_Watched_Markets` has now been copied successfully, so the parent table is present by report. Before copying decisions, a read-only symbol-set precheck must still confirm that every source decision symbol has an archive market anchor. The previously generated [`archive_market_anchor_precheck.sql`](../../archive_market_anchor_precheck.sql) performs that cross-database comparison.

Actual production source/target schemas, row counts, source access to all decision rows, target write access, current archive decision contents, and symbol coverage were not independently checked. The archive health monitor is not evidence of any of these. Do not start a copy until the validation gates below pass.

## Findings

### Foreign-key dependencies

The local source migration and archive schema agree on the following direct relationships:

| Direction | Relationship | Consequence |
|---|---|---|
| Outgoing from AI decisions | `AI_Crypto_Bot_AI_Decisions.symbol` → `AI_Crypto_Bot_Watched_Markets.symbol`, `ON DELETE RESTRICT` | The matching market row must exist in the archive before each decision row is inserted. |
| Incoming to AI decisions | `AI_Crypto_Bot_Trades.ai_decision_id` → `AI_Crypto_Bot_AI_Decisions.id`, nullable, `ON DELETE RESTRICT` | Trades do not need to be copied first. If trades are archived later, decisions must be copied before their referencing trades. Do not delete decisions referenced by archived trades. |

No other direct AI-decision foreign keys appear in the repository schema. `strategy_name` and `strategy_version` are nullable text snapshots with a paired-null check; they do **not** reference `AI_Crypto_Bot_Strategies`. Profiles, portfolios, positions, candles, market data, and strategy rows are not parent prerequisites for inserting decisions.

The expected dependency closure is therefore only `AI_Crypto_Bot_Watched_Markets` for this table. The user-reported watched-market copy likely satisfies it if all source rows were copied with their symbols intact; the required precheck proves coverage for the actual decision history.

### Decision-table compatibility

The source migration and archive DDL both define the same nine fields and core constraints:

| Column | Type | Nullability / constraint |
|---|---|---|
| `id` | `uuid` | `NOT NULL`, primary key |
| `symbol` | `text` | `NOT NULL`, FK to watched-market `symbol` |
| `decision` | `text` | `NOT NULL`, one of `BUY`, `SELL`, `HOLD`, `WAIT` |
| `confidence` | `numeric(5,2)` | `NOT NULL`, range 0–100 |
| `indicators` | `jsonb` | `NOT NULL`, JSON object |
| `reason` | `text` | `NOT NULL`, non-empty |
| `strategy_name` | `text` | Nullable |
| `strategy_version` | `text` | Nullable; nullness must match `strategy_name` |
| `created_at` | `timestamp with time zone` | `NOT NULL` |

Both tables use the original decision ID as their primary key. The archive DDL has no decision-specific trigger or `updated_at` field. Preserve every column explicitly; do not regenerate IDs, round confidence, parse JSON numbers through JavaScript floating-point `Number`, or replace source timestamps with import time.

## Parent-row readiness

| Item | Status |
|---|---|
| Archive watched-market table exists in the deployed schema | User reports the archive schema is deployed. This assessment did not inspect the live database. |
| Watched-market rows copied | **Reported successful by the user.** Row count and field parity were not independently rechecked here. |
| Every source decision symbol has an archive market row | **Not yet independently verified.** Run the read-only anchor precheck immediately before the decision copy. |
| Strategy rows required | **No.** Strategy name/version are text snapshots, not foreign keys. |
| Trade rows required before decisions | **No.** The FK points from trades to decisions, not the reverse. |

The source decision table's FK should already prevent source decisions from referencing a deleted/missing source market when the constraint is valid. That does not alone prove that the copied archive market set is complete or that the deployed source constraint matches the repository. The cross-database precheck remains required.

## Remaining blockers

1. **Cross-database market-anchor verification:** run [`archive_market_anchor_precheck.sql`](../../archive_market_anchor_precheck.sql) and require `missing_in_archive_count = 0`. Its source symbol set is derived from all source decision rows, including disabled markets.
2. **Live schema and constraint verification:** compare the source and archive decision columns, primary key, check constraints, the decision-to-market FK, and the archive trade-to-decision FK against the expected contract below.
3. **Source read authorization:** verify an already-authorized source connection can read the complete `AI_Crypto_Bot_AI_Decisions` table. Prior market-copy access does not prove decision-table access or complete visibility.
4. **Archive write authorization:** verify an already-authorized archive connection has the required decision-table access. The health-check profile is documented as read-only and must not be used for writes unless its existing effective permission is independently verified.
5. **Current decision-table counts:** the current source count and archive pre-copy count are unknown. Do not assume the archive decision table is empty.
6. **Credential and operational authorization:** the Pi pull implementation is now available, but its source and archive roles must already meet the least-privilege contract and pass the live preflight. The CLI does not create roles, change RLS, or provision credentials. If either connection lacks the required access, stop rather than silently widening privileges. Execution remains separate and has not been authorized or performed by generating the code.

No new role, RLS policy, credential, API endpoint, or database object is proposed by this readiness report.

## Validation queries

The following queries are generated for a future, separately authorized validation. Run source queries only against the verified Supabase project and archive queries only against `ai_crypto_bot_archive`. They were **not** run for this report.

### 1. Enumerate direct foreign keys

Run on both databases to verify all outgoing and incoming foreign keys involving the decision table:

```sql
SELECT
  fk.conname,
  source_ns.nspname AS source_schema,
  source_table.relname AS source_table,
  source_column.attname AS source_column,
  target_ns.nspname AS target_schema,
  target_table.relname AS target_table,
  target_column.attname AS target_column,
  pg_catalog.pg_get_constraintdef(fk.oid) AS definition,
  fk.convalidated
FROM pg_catalog.pg_constraint AS fk
JOIN pg_catalog.pg_class AS source_table
  ON source_table.oid = fk.conrelid
JOIN pg_catalog.pg_namespace AS source_ns
  ON source_ns.oid = source_table.relnamespace
JOIN pg_catalog.pg_class AS target_table
  ON target_table.oid = fk.confrelid
JOIN pg_catalog.pg_namespace AS target_ns
  ON target_ns.oid = target_table.relnamespace
JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS source_key(attnum, position)
  ON true
JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS target_key(attnum, position)
  ON target_key.position = source_key.position
JOIN pg_catalog.pg_attribute AS source_column
  ON source_column.attrelid = source_table.oid
 AND source_column.attnum = source_key.attnum
JOIN pg_catalog.pg_attribute AS target_column
  ON target_column.attrelid = target_table.oid
 AND target_column.attnum = target_key.attnum
WHERE fk.contype = 'f'
  AND (
    fk.conrelid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
    OR fk.confrelid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
  )
ORDER BY source_schema, source_table, fk.conname, source_key.position;
```

Expected repository contract on each database:

- Outgoing: `AI_Crypto_Bot_AI_Decisions.symbol` references `AI_Crypto_Bot_Watched_Markets.symbol`, validated, `ON DELETE RESTRICT`.
- Incoming: `AI_Crypto_Bot_Trades.ai_decision_id` references `AI_Crypto_Bot_AI_Decisions.id`, validated, nullable source column, `ON DELETE RESTRICT`.

Any additional or missing relationship is a schema-drift blocker to resolve before copying.

### 2. Compare column contracts

Run on source and archive and compare the results:

```sql
SELECT
  column_name,
  ordinal_position,
  data_type,
  udt_name,
  is_nullable,
  numeric_precision,
  numeric_scale,
  datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AI_Crypto_Bot_AI_Decisions'
ORDER BY ordinal_position;
```

Expected: exactly the nine columns listed above, in the same order and with matching types/nullability. Also compare primary key and check constraints:

```sql
SELECT
  conname,
  contype,
  convalidated,
  pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
ORDER BY contype, conname;
```

Expected: primary key on `id`; checks for the four allowed decisions, confidence range, JSON object type, and paired strategy snapshot nullability; and the watched-market symbol FK.

### 3. Check source-side symbol integrity

This verifies the source decision symbols have source market parents; it does not compare the two databases:

```sql
SELECT
  decision.symbol,
  count(*) AS decision_rows
FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
LEFT JOIN public."AI_Crypto_Bot_Watched_Markets" AS market
  ON market.symbol = decision.symbol
WHERE market.symbol IS NULL
GROUP BY decision.symbol
ORDER BY decision.symbol;
```

Expected: zero rows. For the required **source-to-archive** check, use [`archive_market_anchor_precheck.sql`](../../archive_market_anchor_precheck.sql); it compares distinct source decision symbols with archive watched-market symbols and reports missing anchors. Expected `missing_in_archive_count = 0`.

### 4. Capture source and target counts

Run this query separately on source before copy and archive before and after copy:

```sql
SELECT
  current_database() AS database_name,
  count(*) AS decision_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  count(*) FILTER (WHERE decision = 'BUY') AS buy_rows,
  count(*) FILTER (WHERE decision = 'SELL') AS sell_rows,
  count(*) FILTER (WHERE decision = 'HOLD') AS hold_rows,
  count(*) FILTER (WHERE decision = 'WAIT') AS wait_rows,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at
FROM public."AI_Crypto_Bot_AI_Decisions";
```

Run the action breakdown as a second check:

```sql
SELECT decision, count(*) AS decision_rows
FROM public."AI_Crypto_Bot_AI_Decisions"
GROUP BY decision
ORDER BY decision;
```

Expected: all four action counts sum to `decision_rows`; `decision_rows = distinct_ids`; the archive action counts and time bounds match the copied source cohort. `distinct_symbols` is not expected to equal row count because multiple decisions per market are normal.

### 5. Check archive referential integrity after copy

```sql
SELECT
  decision.symbol,
  count(*) AS decision_rows
FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
LEFT JOIN public."AI_Crypto_Bot_Watched_Markets" AS market
  ON market.symbol = decision.symbol
WHERE market.symbol IS NULL
GROUP BY decision.symbol
ORDER BY decision.symbol;
```

Expected: zero rows. The FK should enforce this automatically; the query remains useful for detecting a missing, disabled, or unvalidated deployed constraint.

### 6. Compare copied values

Export both source and archive using the same fixed cutoff, explicit field order, UTC timestamp formatting, and deterministic ordering by `(created_at, id)`. Include all nine fields:

```sql
SELECT
  id::text AS id,
  symbol,
  decision,
  confidence::text AS confidence,
  indicators::text AS indicators,
  reason,
  strategy_name,
  strategy_version,
  created_at::text AS created_at
FROM public."AI_Crypto_Bot_AI_Decisions"
WHERE created_at <= :'copy_cutoff'::timestamptz
ORDER BY created_at, id;
```

Set the connection time zone to UTC before exporting. Compare the source and archive files row-by-row or by deterministic chunk hashes. Compare `indicators` as JSONB values rather than requiring identical whitespace or key order; compare timestamp instants at full PostgreSQL precision. Counts and timestamp bounds alone do not prove field parity.

## Expected copy counts

The latest historical source measurement found in prior repository evidence is **162,078 decisions** through approximately **2026-11-06 19:16 UTC**. This figure is a historical reference from [`ARCHIVE_RETENTION_PLAN.md`](./ARCHIVE_RETENTION_PLAN.md), **not** the current expected count or an archive measurement.

Let `N` be the fresh source count returned by the pre-copy query for the approved fixed snapshot. The authoritative expectations are:

| Metric | First full copy when archive decision table is empty | Idempotent unchanged rerun |
|---|---:|---:|
| Source rows selected | `N` | `N` |
| Rows inserted | `N` | `0` |
| Rows updated | `0` | `0` |
| Rows unchanged/skipped | `0` | `N` |
| Rows deleted | `0` | `0` |
| Archive rows after copy | `N` | unchanged at `N` |
| Missing archive market anchors | `0` | `0` |

If the archive decision table is not empty, stop and reconcile IDs/values before copying. For an approved bounded smoke batch of size `B` (the earlier POC plan proposed a default batch size of 250), expected source rows read and accounted-for rows are `min(B, N)`. If the archive decision table is empty and the selected IDs are absent, expected inserts are also `min(B, N)`. Do not treat the smoke-batch count as proof that the full history was archived.

Successful full-copy accounting must satisfy:

```text
inserted + updated + unchanged/skipped = source rows selected
archive row count after = archive row count before + inserted
deleted = 0
```

The actual source/target counts and insert/update/skip totals remain **NOT RUN / NOT VERIFIABLE** in this assessment.

## Decision-copy implementation plan

1. **Confirm scope and identities.** Verify source and archive connection identities against the intended Supabase project and `ai_crypto_bot_archive`. The agent performs strict privilege, schema, RLS-policy, TLS, and market-anchor preflights, but these have not been run against live databases.
2. **Review the execution boundary.** The CLI is manual and targets only `AI_Crypto_Bot_AI_Decisions`; it creates no API route or scheduler. It has no dry-run or row-limit option, so its first invocation processes the full eligible cohort rather than a bounded smoke batch.
3. **Confirm stable-copy assumptions.** The implementation captures a fixed source cutoff and uses `(created_at, id)` keyset order, a configurable overlap, and a local resumable checkpoint. It assumes decisions are append-oriented; edits or backdated inserts outside the overlap are not detected automatically.
4. **Validate before invocation.** Follow the installation and validation guides. Confirm the exact source/archive credentials, required role/RLS scopes, TLS, deployed table definitions, and zero missing watched-market anchors. Record independent source and target baselines.
5. **Run manually and reconcile.** The agent transfers IDs and all nine columns, preserving confidence as numeric text, indicators as JSONB text, and UTC timestamps as text. It commits archive batches before advancing the local checkpoint and uses ID-based upserts for replay safety. Review its source, inserted, updated, skipped, and target-count results against independent validation queries.
6. **Keep the operational scope narrow.** Do not schedule the agent, delete source rows, change application read paths, or treat local tests/builds as proof of production readiness. A backup/restore plan and live credential/schema/permission verification remain operational gates.

The full source table has a substantial historical footprint (prior report measured roughly 350 MB of PostgreSQL relation size), so use bounded transfers and monitor client/Pi disk space. This is a historical measurement, not a current CSV-size estimate.

## Final status

| Area | Assessment |
|---|---|
| Local source/archive schema compatibility | **Pass, static review** |
| Foreign-key parent requirements | **Known: watched-market symbol rows only** |
| Watched-market table copy | **Reported successful by the user** |
| Every source decision symbol present in archive | **Pending read-only precheck** |
| Live source and target decision schema/counts | **Not verified** |
| Existing source/target permissions for decision table | **Not verified** |
| Decision rows copied | **No copy performed; implementation is generated but unrun** |
| Overall decision-copy readiness | **Conditional; do not begin the copy until the listed read-only preflight passes** |

## References

- [Agent installation guide](./AI_DECISION_ARCHIVE_AGENT_INSTALLATION.md)
- [Agent validation guide](./AI_DECISION_ARCHIVE_AGENT_VALIDATION.md)
- [Archive agent POC plan](./ARCHIVE_AGENT_POC.md)
- [Archive deployment readiness](./ARCHIVE_AGENT_DEPLOYMENT_READINESS.md)
- [Archive schema analysis](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md)
- [Archive schema validation](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_VALIDATION.md)
- [Archive market-seed implementation](./ARCHIVE_MARKET_SEED_IMPLEMENTATION.md)
- [Manual market CSV POC](./MARKET_EXPORT_IMPORT_POC.md)
- [Archive market-anchor precheck](../../archive_market_anchor_precheck.sql)
- [Archive schema DDL](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
- [Source schema migration](../../supabase/migrations/20261031190000_create_agent_tables.sql)
- [Paper-trading migration adding the trade-to-decision FK](../../supabase/migrations/20261101154600_phase08_paper_trading.sql)
- [Database documentation](../DATABASE.md)
- [AI decision writer and current append-oriented behavior](../../lib/ai-engine.mjs)
