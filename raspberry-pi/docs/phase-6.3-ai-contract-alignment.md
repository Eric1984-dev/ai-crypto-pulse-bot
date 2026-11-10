# Phase 6.3 — AI Contract Validation Alignment

## Outcome

Corrected PostgreSQL constraint detection used by AI preflight. Existing primary-key and unique-constraint requirements, database identity checks, and privilege checks are unchanged.

## Root cause

`CONSTRAINTS_SQL` aggregated `pg_attribute.attname` directly. PostgreSQL types `attname` as `name`, so `ARRAY_AGG(attname)` returns `name[]`. The default node-postgres type parser does not decode `name[]` into a JavaScript array and returns its raw string representation instead.

The shared `hasConstraint()` validator requires `columns` to be an array. Consequently, every returned primary-key or unique constraint failed to match, producing the four reported `MISSING_*_CONSTRAINT` errors even when the constraints were present. Existing contract tests returned JavaScript arrays directly and did not model node-postgres type parsing.

The catalog query's table/schema filters, constraint types, and column ordering were correct. A local PostgreSQL-compatible catalog fixture returned the expected constraint rows; a node-postgres type-parser check reproduced the `name[]` string versus `text[]` array behavior.

## Validator review

- AI preflight calls `evaluateAIAnalysisDatabaseContract()`, which reuses `evaluateDatabaseContract()` for the common schema, identity, read-only, and constraint checks, then applies AI-specific privilege rules.
- The AI validator is not using a separate or deprecated catalog query. Reusing the common contract evaluator is intentional; the failure was at the database-driver result-type boundary.
- The generic constraint requirements and the AI decision primary-key requirement remain unchanged. AI identity checks, owner rejection, read/write privilege restrictions, and decision insert requirements remain in place.

## Fix applied

Cast `pg_attribute.attname` to `text` inside `ARRAY_AGG`. PostgreSQL now returns `text[]`, which node-postgres parses as a JavaScript array, preserving the ordered column names expected by the existing validator.

Updated the contract-validation test pool to use node-postgres's actual type parsers for `name[]` and `text[]`. The AI preflight regression test now verifies that the catalog query requests the cast and recognizes the existing constraints.

## Files changed

- `src/repositories/contract-repository.mjs`
- `tests/contract-validation.test.mjs`
- `docs/phase-6.3-ai-contract-alignment.md`

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests (`npm.cmd --prefix raspberry-pi test`) | Passed: 96 tests, 0 failures. |
| Repository tests (`npm.cmd test`) | Passed: 458 tests, 0 failures. |
| Syntax validation (`node --check` across Raspberry Pi source and tests) | Passed: 62 modules checked. |
| `git diff --check` | Passed. |
| Live Raspberry Pi database / AI execution | Not run. No production connection, database write, or AI execution was performed. |

## Remaining verification

Run the existing AI preflight or `npm run ai:analyze` on the Raspberry Pi to confirm the corrected result against its PostgreSQL instance and configured AI role. This report does not claim live validation. No Phase 7 work was started.
