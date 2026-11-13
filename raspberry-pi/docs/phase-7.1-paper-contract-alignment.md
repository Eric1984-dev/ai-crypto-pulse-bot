# Phase 7.1 — Paper Trading Contract Validation Alignment

## Outcome

Corrected column metadata inspection for the shared PostgreSQL contract validator. Paper-trading startup no longer depends on the paper role having data privileges merely to discover a table's schema. Table identity, role, read/write privilege, and safety checks remain unchanged.

No live Raspberry Pi database was queried or modified. No trading cycle, exchange request, deployment, or Phase 8 work was performed.

## Root cause

The shared contract inspector read columns from `information_schema.columns`. PostgreSQL filters that view according to the current role's effective access to each table or column. At the time of this Phase 7.1 fix, the paper writer was not granted `SELECT` on candles because paper trading did not read candle data, but the shared schema contract still checked the candle columns. As a result, valid columns can be reported missing when the paper role cannot see them through `information_schema`.

A local PGlite reproduction confirmed the visibility difference: under a role with schema usage but no table privileges, the `information_schema.columns` query returned no rows while a `pg_catalog.pg_attribute` query returned the table's column names and types. The node-postgres type parser was not the cause: `information_schema` returns the relevant name and data-type values as strings. The Phase 6.3 `name[]` constraint parsing defect was separate and its cast remains in place.

The historical statement below that the paper writer has no candle `SELECT` grant describes the Phase 7.1 behavior only. The current position-exit policy reads candles; the Phase 8.14 migration now grants the restricted paper role `SELECT` on `AI_Crypto_Bot_Candles` while rejecting table ownership and candle write privileges.

## Affected validators

API, ingestion, AI, and paper-trading preflight all use `inspectDatabaseContract()` from the shared contract repository. The visibility-filtered query could therefore produce false missing-column errors for any of those roles. Paper trading exposed the issue because its least-privilege grants do not include candle reads.

## Fix applied

Column metadata now comes from `pg_catalog.pg_attribute`, joined to the relation and schema catalogs. The query:

- explicitly converts relation and column names to text;
- uses `pg_catalog.format_type` with no typmod to match the existing type contracts;
- excludes system and dropped columns; and
- limits inspection to the required ordinary and partitioned tables.

The separate table-privilege checks are unchanged. Roles must still satisfy their existing exact SELECT/INSERT/UPDATE requirements and all existing identity, ownership, elevation, destructive-privilege, and sequence checks.

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests (`npm.cmd --prefix raspberry-pi test`) | Passed: 133 tests, 0 failures. |
| Repository tests (`npm.cmd test`) | Passed: 495 tests, 0 failures. |
| Syntax validation (`node --check` across Raspberry Pi source and tests) | Passed: 74 modules checked. |
| `git diff --check` | Passed. |
| Restricted-role catalog reproduction | Passed locally with PGlite; catalog columns remained visible without table `SELECT`. |
| Live Raspberry Pi validation | Not run. The actual production role grants and startup result remain to be verified on the Pi. |

## Files changed

- `src/repositories/contract-repository.mjs`
- `tests/contract-validation.test.mjs`
- `docs/phase-7.1-paper-contract-alignment.md`

Phase 7.1 stops here. No Phase 8 work was started.
