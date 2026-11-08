# Archive Market Seed Implementation

**Assessment date:** 2026-11-07  
**Status:** Implementation plan only. No SQL was executed, no rows were copied, and neither database was modified.

## Summary

Copy every row from Supabase `public."AI_Crypto_Bot_Watched_Markets"` into the deployed archive table of the same name before archiving AI decisions. Preserve the six source fields exactly:

`id`, `symbol`, `enabled`, `priority`, `created_at`, `updated_at`.

The source migration defines `id` as UUID primary key, `symbol` as unique text, `enabled` as boolean, `priority` as integer, and both timestamps as `timestamptz`. The archive DDL uses the same columns and types. Decision and other historical tables reference the market's `symbol`, so the market rows must exist before dependent records are copied.

The requested copy cannot be performed under this task's restrictions: it requires source reads and archive writes, while SQL execution and database changes are expressly prohibited. Consequently, all live counts and copy results remain **NOT RUN / NOT VERIFIABLE** below. This report is not evidence that the archive has been seeded.

## Readiness and blockers

- The archive schema DDL defines the market table but contains no seed rows. The source seed migration does not seed the Pi archive.
- Earlier archive readiness reports found no locally confirmed table-scoped Supabase reader or separate archive writer. Remote secret stores were not checked. Do not use the service-role key or the read-only health-check account for this copy.
- The source service must allow read-only access to `AI_Crypto_Bot_Watched_Markets`; the target writer needs only the target-table access required for `SELECT`, `INSERT`, and `UPDATE`.
- Before copying, verify the source project identity, target database name, target schema/constraints, credentials, TLS, and target backup/restore readiness.
- The existing [market-anchor precheck](../../archive_market_anchor_precheck.sql) compares decision symbols with archive market symbols. It does **not** prove that every source watched-market row and all six field values match the archive, nor does it detect conflicting IDs. A full table seed needs the additional preflight and validation below.

Until the credential and identity checks pass, and the target conflict preflight is clean, do not start a copy.

## Proposed implementation plan

1. **Confirm both connections.** Use a manually invoked Pi-side pull process, not Vercel or the health endpoint. Verify the source project reference from protected connection configuration and require the target database to be `ai_crypto_bot_archive`. Keep source and target credentials separate; never print them or place them in this repository.
2. **Capture a read-only source snapshot.** In a read-only source transaction, fetch the complete table using the explicit six-column list, ordered deterministically by `id`. Record a fixed extraction time, exact source row count, distinct-ID/symbol counts, and timestamp bounds.
3. **Inspect the archive before writing.** Read all archive market rows and classify source rows by primary key and unique symbol. Stop if a source ID already belongs to a different symbol, a source symbol has a different archive ID, or any target constraint/schema mismatch is found. Do not overwrite or delete archive-only rows.
4. **Back up the target.** Take and verify a restorable pre-copy backup or snapshot. Record the archive database identity and backup identifier in the run manifest; do not treat the health endpoint as backup verification.
5. **Upsert in a bounded, single-writer run.** Transfer only the six named columns. Use the original UUID as the primary-key conflict key. Insert missing rows; update existing rows only when the symbol matches and one or more source values differ; leave byte/value-identical rows untouched. A symbol or ID conflict is a fatal preflight error, not a row to “fix” automatically.
6. **Preserve values.** Do not regenerate IDs or rely on defaults. Preserve booleans and integers as typed values and timestamps as `timestamptz` instants at full database precision. Set `updated_at` to the source value. The generated archive DDL has no `updated_at` trigger; verify the deployed table has no trigger that would replace the copied timestamp.
7. **Record and reconcile the outcome.** Log source count, target count before and after, inserted, updated, unchanged/skipped, and fatal conflict counts. Advance no checkpoint or report success until every source row is accounted for and the post-copy comparisons pass.
8. **Rerun safely.** Repeat the same operation. With no source changes, inserted and updated should both be zero and every source row should be classified as unchanged/skipped. Source rows are always `SELECT`-only. Do not delete source or archive rows.

Use the approved Pi pull architecture. Keep the operation manual for this first seed; do not add scheduling, Vercel routes, or trading/AI dependencies.

### Upsert and count semantics

Use `ON CONFLICT (id) DO UPDATE` with an explicit target column list and a change predicate comparing all non-key fields using `IS DISTINCT FROM`. The update branch must not silently change a conflicting symbol. Preflight ID/symbol mismatches and stop before the upsert if any exist. The target's unique `symbol` constraint remains enabled.

Define the run counters as follows:

- **Source row count:** all rows selected from Supabase at the fixed snapshot.
- **Inserted:** source IDs not present in the archive before the run.
- **Updated:** source IDs already present with the same symbol but at least one differing copied value.
- **Skipped:** source IDs already present with the same symbol and all copied values identical; these rows are idempotent no-ops.
- **Archive row count before/after:** total target rows, including any archive-only rows that are retained.

For a complete successful run, `inserted + updated + skipped` must equal the source row count. The target after-count should equal target before-count plus inserted rows; updates and skips do not change row count. Because the requirement forbids deletion, archive-only rows are not removed and may make the total archive count larger than the source count.

## Counts and copy results

No live source or archive query was run. Prior reported market counts are historical observations, not current values, and are not substituted here.

| Metric | Result |
|---|---|
| Source watched-market row count | **NOT RUN** |
| Archive watched-market row count before copy | **NOT RUN** |
| Inserted rows | **NOT RUN** |
| Updated rows | **NOT RUN** |
| Skipped unchanged rows | **NOT RUN** |
| Archive watched-market row count after copy | **NOT RUN** |
| Source immutability verification | **NOT RUN** |
| Decision-symbol FK anchor coverage after copy | **NOT RUN** |

These are not zero counts. They are unavailable because SQL and database access were not authorized for execution in this task.

## Validation queries

The following queries are generated for a future, separately authorized validation. Do not run them as part of this task. Execute the source query only against the verified Supabase connection and the target query only against `ai_crypto_bot_archive`.

### Source aggregate

```sql
SELECT
  count(*) AS source_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at,
  min(updated_at) AS earliest_updated_at,
  max(updated_at) AS latest_updated_at
FROM public."AI_Crypto_Bot_Watched_Markets";
```

### Archive aggregate

```sql
SELECT
  current_database() AS database_name,
  count(*) AS archive_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at,
  min(updated_at) AS earliest_updated_at,
  max(updated_at) AS latest_updated_at
FROM public."AI_Crypto_Bot_Watched_Markets";
```

The target query must report `database_name = 'ai_crypto_bot_archive'`. Since primary-key and unique constraints should prevent duplicate IDs and symbols, equal row/distinct counts are a useful check but do not by themselves prove values match the source.

### Full source and target value comparison

Run this explicit-column export query independently on both databases, order both result sets by `id`, and compare the typed values row-by-row in the Pi-side client. Normalize timestamps to UTC without reducing precision. Do not compare only counts or timestamp bounds.

```sql
SELECT
  id,
  symbol,
  enabled,
  priority,
  created_at AT TIME ZONE 'UTC' AS created_at_utc,
  updated_at AT TIME ZONE 'UTC' AS updated_at_utc
FROM public."AI_Crypto_Bot_Watched_Markets"
ORDER BY id;
```

The comparison must identify:

- Source rows missing by `id` in the archive.
- Source `id` present with a different `symbol`.
- Source `symbol` present with a different `id`.
- Any `enabled`, `priority`, `created_at`, or `updated_at` value that differs.
- Archive-only rows, which are reported but retained.

### Decision foreign-key coverage on the archive

```sql
SELECT
  count(DISTINCT decision.symbol) FILTER (WHERE market.symbol IS NULL)
    AS decision_symbols_missing_market_anchor
FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
LEFT JOIN public."AI_Crypto_Bot_Watched_Markets" AS market
  ON market.symbol = decision.symbol;
```

The expected result is zero. This query validates archive-side FK coverage for decisions already present there; it does not compare the full source market table with the archive. The existing symbol precheck can also be rerun after seeding, but full ID and field parity requires the explicit-column comparison above.

## Validation acceptance criteria

Do not declare the seed complete unless all of the following hold:

1. Source and target database identities are recorded and verified; the target is exactly `ai_crypto_bot_archive`.
2. The archive table has the six expected columns and compatible PostgreSQL types, a primary key on `id`, and a unique constraint on `symbol`.
3. No source ID/symbol mismatch exists in the target before upsert.
4. `inserted + updated + skipped = source row count`.
5. Source row count, distinct ID count, and distinct symbol count reconcile; full-column comparison reports no missing or differing source rows.
6. Target-only rows are reported and remain untouched.
7. The archive decision-symbol coverage query returns zero missing anchors.
8. A second identical run yields zero inserts, zero updates, and all source rows skipped as unchanged.
9. Logs and manifest contain counts and safe error categories only—no credentials, connection strings, or row payloads.

## Rollback plan

This is an additive copy. The safest rollback is to stop the manual process and leave Supabase and the archive rows unchanged; an incorrect seed does not affect live bot operation because the bot continues to use Supabase.

- If validation fails before commit, roll back the current archive transaction and do not report success.
- If an upsert transaction committed but validation fails, stop further syncs, retain the source unchanged, preserve the pre-copy archive backup, and diagnose the exact mismatching rows.
- Correct source-derived values by rerunning the approved idempotent upsert after resolving the conflict; do not delete rows or weaken constraints.
- If restoring the pre-copy archive backup is necessary, obtain separate approval first, verify that no dependent archive rows would be lost, and follow the archive restore runbook. No archive deletion or restore is authorized by this report.
- After any correction or restore, repeat all acceptance queries and the idempotent rerun check before proceeding to AI decision copying.

## Scope and limitations

- No SQL, database query, copy, update, backup, or restore was executed.
- No live source/archive row counts or inserted/updated/skipped figures are available.
- The deployment status, source credential, target writer, archive table contents, target trigger state, and backup readiness remain unverified.
- This report does not authorize credential provisioning, schema changes, row seeding, decision archival, or production deletion.
