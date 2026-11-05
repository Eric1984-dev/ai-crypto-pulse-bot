# Database-Side AI Analysis Prototype Report

Date: 2026-11-06

## Status and scope

**Readiness: READY FOR MANUAL MIGRATION REVIEW; NOT approved for production rollout.**

This is a local, opt-in prototype. The JavaScript AI engine remains the default (`AI_ANALYSIS_MODE=javascript` when unset). Database mode is selected only by explicitly setting `AI_ANALYSIS_MODE=database` on the existing `/api/ai-analysis` route. The mode is not approved or enabled in production.

No Supabase migration was applied, no production data or settings were changed, no scheduler configuration was changed, and no deployment occurred. Validation used repository tests with local PGlite fixtures; no production Supabase query or write was run. Paper trading, the Risk Manager, the market universe, the six analysis intervals, and `ENABLE_LIVE_TRADING=false` were not changed. No API route or dependency was added.

## Changes

1. JavaScript AI-decision inserts now send `Prefer: return=minimal`. A successful HTTP status confirms the insert; the caller does not parse a response body. Status updates still request `return=representation` and validate exactly one returned row.
2. An additive migration, `20261106120000_ai_analysis_database_mode.sql`, defines `AI_Crypto_Bot_Run_Database_AI_Analysis(p_analysis_time)`. It reads enabled rows from `AI_Crypto_Bot_Watched_Markets`, market snapshots, and candles; calculates decisions in PostgreSQL; inserts them into the existing AI decisions table; and returns only aggregate analyzed/stored and BUY/SELL/HOLD/WAIT counts.
3. The SQL caps enabled markets at 2,000 and reads no more than the latest 150 candle rows for each of the six intervals and each market. It does not send candle rows or full decisions/indicators back through PostgREST. The `AI_Crypto_Bot_Internal` helper schema and functions are not exposed to `PUBLIC`, `anon`, or `authenticated`; execution is granted to `service_role`. Functions use `SECURITY INVOKER`, an empty `search_path`, and qualified references.
4. The existing API route selects database mode only by explicit opt-in. RPC errors are surfaced as analysis failure, status transitions to `ERROR` through the existing lifecycle, and the route does not silently fall back to JavaScript.
5. This review replaced two qualified wildcard projections in the migration with explicit column lists. The database migration test now guards against adding `SELECT *` projections.

No API route was added. The repository has 12 API handler files, so the existing 12-function limit is unchanged.

## Parity evidence

The PGlite migration test compares the stored SQL decision payload against the JavaScript engine for identical database-shaped fixtures and a fixed analysis timestamp. It checks all stored fields, including indicators, confidence, decision, reason, and strategy snapshot. The final focused run passed after the fixture was expanded to 160 rows per interval, so the SQL latest-150 bound is exercised against older rows.

| Case | Local validation |
|---|---|
| Full histories for all six intervals | Exact stored-payload equality with JavaScript |
| BUY, SELL, HOLD, and WAIT | Covered |
| Missing snapshots and missing/stale/future candle data | Covered |
| Stale and future snapshots | Covered |
| Invalid candles and insufficient history | Covered; invalid-row counts are checked |
| Duplicate candle timestamps | Existing unique constraint rejects duplicates; duplicates cannot enter the analysis query under the current table contract |
| Floating-point rounding boundaries | Compared with JavaScript rounding behavior |
| SQL row bound | 160 inserted rows per interval; only the newest 150 are used |
| Privileges and invalid analysis time | Unauthorized role and invalid argument are rejected |
| Database RPC failure / no fallback | Covered in API/service tests |

Database-shaped fixture values are important: the comparison passes normalized values as PostgREST/database JSON exposes them, rather than a hand-constructed JavaScript representation. This avoids treating timestamp formatting differences in test setup as engine differences.

Parity is established for the tested fixtures in local PGlite. This is not a production Supabase equivalence test: it does not establish production data behavior, hosted query plans, function latency under the complete market universe, or production role configuration. It also does not test behavior against rows violating current database constraints, which cannot be stored through the existing schema.

## Migration and paper-trading review

- **Bounded reads:** the SQL uses the same 2,000-market cap as the JavaScript engine, loops over the fixed six intervals, and queries at most 150 latest candles for each symbol/interval. Snapshot reads are symbol-keyed. For the measured 102-market workload, the candle ceiling is 91,800 rows.
- **Permissions:** the local migration test verifies the public function and helpers are `SECURITY INVOKER` with an empty `search_path`, executable by `service_role`, and not executable by `PUBLIC`, `anon`, or `authenticated`.
- **Status and errors:** the existing API sets status to `ANALYZING` before the RPC, then `ACTIVE` or `IDLE` on success. Database/RPC/summary failures are not retried through JavaScript; the existing error path attempts to persist `ERROR`, logs a status-write failure explicitly, and the API returns its unavailable response.
- **Paper-trading compatibility:** the function inserts into the existing decisions table with the same decision payload fields. The existing paper-trading job consumes the latest decision for each enabled market, still enforces the 15-minute decision freshness check and existing risk controls, and skips while status is `ANALYZING`. No paper-trading code or behavior changed.
- The migration test also runs a bounded latest-150 candle query with `EXPLAIN (ANALYZE, FORMAT JSON)`. This is a local PGlite check, not a hosted Supabase query plan.

## Local runtime and query plan

- A local PGlite benchmark used 102 enabled markets (the five seeded markets plus 97 synthetic markets), 102 current snapshots, all six intervals, and exactly 150 candles per market/interval: **91,800 candles total**. Candle timestamps were spaced according to each interval. This is the full 102-market cap workload, 126 rows above the supplied 91,674-candle production measurement.
- The fixture load took **4,190.742 ms**, excluded from the RPC timings. After one unreported warm-up, three analysis RPC runs took **2,986.663 ms**, **2,966.753 ms**, and **3,068.252 ms** (median **2,986.663 ms**). Each run analyzed and stored 102 decisions. The generated rising-candle fixture produced 102 BUY decisions; this is fixture behavior only, not strategy-performance evidence.
- The measured operation was the SQL RPC only, executed as `service_role` in Node **v24.20.0**, `win32-x64`. It did not include Vercel, PostgREST/network overhead, or the API status requests. An earlier one-market result of 103.566 ms is not used to extrapolate this workload.

These are local fixture measurements, not Supabase production timings. They do not establish hosted query plans, Vercel timeout headroom, production database load, concurrency behavior, egress, or cost savings.

## Response-size opportunity

The supplied baseline is for one successful analysis run and is explicitly an uncompressed JSON estimate, not wire-size or billed-usage measurement:

| Baseline item | Uncompressed JSON byte estimate |
|---|---:|
| Compact candle RPC responses | 6,981,065 |
| AI decisions insert response | 382,087 |
| **Two large responses subtotal** | **7,363,152** |
| Market_Data response | 17,227 |
| Watched_Markets response | 5,149 |
| Status GET response | 21 |
| Status PATCH response | 456 |
| **Total** | **7,386,005** |

The four remaining responses sum to **22,853 bytes** (17,227 + 5,149 + 21 + 456). Together with the two large responses, the components reconcile exactly to **7,386,005 bytes**. Every value above is an uncompressed JSON estimate, not measured or billed egress.

The database mode is intended to avoid returning candle rows to Vercel, replacing that response with a small aggregate summary. The AI-decision insert response was separately addressed in code with `return=minimal`; whether that change is active in production is unverified. These figures are optimization baselines only: no production response-size comparison, compressed wire-byte measurement, or billing reduction was made.

## Manual migration and rollout prerequisites

Do not set `AI_ANALYSIS_MODE=database` until all of these are completed separately:

1. Confirm the intended Supabase project identity and review the exact additive migration at `supabase/migrations/20261106120000_ai_analysis_database_mode.sql`.
2. Apply it manually through the approved migration workflow. This task did not apply it.
3. Verify in the target database that the migration is recorded, the RPC signature is present, and the helper/public functions have the expected `SECURITY INVOKER`, empty `search_path`, schema usage, and execution grants. Confirm `PUBLIC`, `anon`, and `authenticated` cannot invoke the analysis function or helpers and that `service_role` can.
4. Re-run the migration validation and parity tests against the release candidate. Validate representative runtime and execution plans on the intended database with bounded, read-only analysis queries before enabling writes.
5. Obtain explicit rollout approval, then set the server-side Vercel environment variable to `AI_ANALYSIS_MODE=database` and deploy through the normal release process. Monitor the API result, status transitions, analyzed/stored counts, decision distribution, runtime, and errors. Keep the existing scheduler unchanged.

The migration adds no tables, does not alter existing rows or trading safeguards, and adds no Vercel Function. It is additive, so rollback does not require deleting data or reversing schema changes.

## Files changed

- `.env.example`
- `README.md`
- `ROADMAP.md`
- `api/ai-analysis.mjs`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/CHANGELOG.md`
- `docs/DATABASE.md`
- `docs/DEPLOYMENT.md`
- `docs/SCHEDULING.md`
- `docs/TESTING.MD`
- `docs/reports/AI_ANALYSIS_DATABASE_MODE_PROTOTYPE_REPORT.md`
- `lib/ai-engine.mjs`
- `scripts/validate-database.js`
- `supabase/migrations/20261106120000_ai_analysis_database_mode.sql`
- `tests/ai-engine.test.mjs`
- `tests/database-migrations.test.js`

## Rollback

Set `AI_ANALYSIS_MODE=javascript` (or remove the variable, which defaults to JavaScript) in the server environment and redeploy using the normal release process. The existing JavaScript path then handles subsequent analysis runs. Leave the additive migration in place; do not drop its functions as part of an operational rollback. Decisions already written remain in the existing decision history.

## Validation performed

| Command | Result |
|---|---|
| `node --test --test-name-pattern="database AI analysis exactly" tests/database-migrations.test.js` | Passed after the explicit-column review: 1 test, 0 failures; 8.086 s test process duration |
| `npm.cmd test` | Passed: 298 tests, 0 failures; 71.096 s |
| `npm.cmd run build` | Passed: static project validation and database migration validation; 18 prefixed tables, RLS coverage, and initial seed consistency |
| `git diff --check` | Passed with no output |

No production SQL query, migration, write, configuration change, scheduler change, or deployment was performed.
