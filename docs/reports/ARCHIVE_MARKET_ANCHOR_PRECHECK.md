# Archive Market Anchor Precheck

**Assessment date:** 2026-11-07  
**Mode:** Read-only precheck design. The SQL script was not executed. No database or code was changed.

## Purpose

The archive decision table has a foreign key from `AI_Crypto_Bot_AI_Decisions.symbol` to `AI_Crypto_Bot_Watched_Markets.symbol`. Before a decision copy can begin, the archive must have a market row for every distinct symbol in the selected decision cohort.

The generated [precheck script](../../archive_market_anchor_precheck.sql) is a `psql` client script. It connects to the source and archive separately using local libpq service aliases, exports symbol sets, compares them, and exports source market rows for missing archive anchors. It does not create temporary tables, install extensions, seed rows, or perform any database writes.

## What the script checks and exports

Using read-only transactions, the script:

1. Connects through the `cryptopulse_source` libpq service and reports the source database/role.
2. Selects every distinct symbol in `AI_Crypto_Bot_AI_Decisions`.
3. Exports those values to `source_decision_symbols.csv`.
4. Connects through `cryptopulse_archive` and stops unless `current_database()` is exactly `ai_crypto_bot_archive`.
5. Selects and exports distinct `AI_Crypto_Bot_Watched_Markets.symbol` values to `archive_watched_market_symbols.csv`.
6. Prints counts of required source symbols, archive symbols, missing anchors, and archive-only symbols.
7. Prints each set difference as `MISSING_IN_ARCHIVE` or `EXTRA_IN_ARCHIVE`.
8. Reconnects to the source and exports the full source watched-market rows for missing symbols—`id`, `symbol`, `enabled`, `priority`, `created_at`, and `updated_at`—to `missing_market_anchor_rows.csv`. This is seed input for review only; the script never inserts it.

The source and target symbols are compared exactly as stored. Distinct source decision symbols are the required parent set; archive-only symbols are informational and do not by themselves prevent copying.

## Current findings

**Live missing-symbol results are NOT VERIFIABLE.** No database connection or SQL query was made, as required. The archive DDL creates the watched-market table but contains no seed rows. The separate five-market Supabase seed migration does not seed the Pi archive. Therefore, this report cannot assert whether any specific symbols are missing.

The generated DDL and migrations establish the dependency:

- `AI_Crypto_Bot_AI_Decisions.symbol` references `AI_Crypto_Bot_Watched_Markets.symbol`.
- `AI_Crypto_Bot_Watched_Markets.symbol` is unique.
- Decision strategy name/version values are snapshots, not foreign keys; no strategy rows are required for decision insertion.
- No other table is a direct parent prerequisite for decision rows.

## Running the precheck later

This task authorizes file generation only. Do not execute the script until the operator separately authorizes a read-only preflight and has verified both service configurations.

Prerequisites for a later run:

- `psql` installed.
- A `pg_service.conf`/`PGSERVICEFILE` entry named `cryptopulse_source` pointing to the intended Supabase project, using a credential with read access to decisions and watched markets.
- A `cryptopulse_archive` service entry pointing to `ai_crypto_bot_archive`, using a read-only account that can inspect watched markets.
- Verified TLS and no secrets embedded in the script or checked into the repository.
- An empty, access-controlled client working directory. The script writes three local CSV files there and may overwrite files with those names; this does not write to either database.

From that working directory, the operator can later run:

```powershell
psql -X -v ON_ERROR_STOP=1 -f D:\GIT\Bots\AI-Crypto-Pulse-Bot\archive_market_anchor_precheck.sql
```

The source service host/project identity must be verified from its protected configuration; the script reports database and role but does not independently establish a Supabase project ID. The archive connection is checked against the expected database name. Neither database contents nor credentials were inspected for this report.

## Recommendation for seeding missing anchors

If the precheck reports missing symbols:

1. Review `missing_market_anchor_rows.csv`; confirm every missing symbol exists in the source watched-market table and is required by the decision set.
2. Check both the unique `symbol` and primary-key `id` against the archive. Stop on any conflicting UUID or inconsistent existing row; do not overwrite existing archive market configuration automatically.
3. After separate approval, seed only the missing parent rows with their source IDs and exact source fields, before importing decisions. This is a scope expansion from the original “decisions only” POC, but it preserves the archive foreign key without disabling or weakening it.
4. Rerun the precheck. Start the decision copy only when `missing_in_archive_count` is zero.
5. Keep all source rows unchanged. Do not delete archive rows or propagate source deletions.

The generated SQL deliberately contains no seed `INSERT`, `UPDATE`, `DELETE`, DDL, or transaction that modifies data. Seeding must be a separate reviewed and authorized action.

## Safety limitations

- The script requires the source role to read both the decision and watched-market tables. This is wider than a decisions-only SELECT role and must be included in the credential review.
- Read-only transactions protect database state; the local CSV exports are intentional filesystem outputs.
- Source and archive are separate databases, so the script cannot obtain one cross-database atomic snapshot. It retains the required source symbol set in a client-side `psql` variable during the run. Rerun the precheck immediately before seeding/copying if either database may have changed.
- A matching symbol proves only that the FK parent exists. The script does not validate archive schema parity, permissions for the later writer, decision row content, or successful restore.
- This script uses `psql` meta-commands (`\\connect`, `\\gset`, `\\o`, `\\if`) and is not portable to generic SQL clients.

## Files generated

- [Precheck script](../../archive_market_anchor_precheck.sql)
- [Archive agent POC plan](./ARCHIVE_AGENT_POC.md)
- [Deployment readiness assessment](./ARCHIVE_AGENT_DEPLOYMENT_READINESS.md)
- [POC simplification assessment](./ARCHIVE_POC_SIMPLIFICATION_REPORT.md)
- [Archive schema DDL](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
