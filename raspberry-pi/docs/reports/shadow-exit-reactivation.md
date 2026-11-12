# Shadow Exit Reactivation Report

## Status

The Raspberry Pi runtime integration and dashboard support are implemented and locally tested. The operator-reported SQLSTATE `42883` establishes that the evaluator function is missing from the active database, so production activation requires the new Pi-only evaluator migration and a supervised runtime restart. No live database change, deployment, push, or commit was performed.

## Root cause

The Raspberry Pi schema contract listed the shadow-exit scenario and event tables, but the Pi paper-trading runtime never called `AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios()`. Table presence alone therefore did not generate scenario or event rows.

The operator's runtime log reports SQLSTATE `42883` (`undefined_function`) from the zero-argument evaluator call. This indicates the function is absent or not visible under that signature. The operator confirmed applying Phase 8.10, but that migration only grants dashboard `SELECT` and does not install the evaluator.

## Changes

- Added a repository method that calls the existing zero-argument JSONB evaluator in its own transaction and validates the bounded result.
- Wired evaluation before paper-trade processing, then after a cycle that executes trades. The second pass can observe actual position closures and begin evaluating newly opened positions.
- Isolated evaluator errors from paper-trading transactions. Failures are logged and surfaced without rolling back or blocking paper trades.
- Exposed the latest evaluator outcome as `lastCycle.stages.shadowExits` in operational monitoring.
- Added `phase-8.9-shadow-exit-runtime-permissions.sql`. It validates the configured non-privileged `PAPER_DATABASE_USER`, checks the existing function's signature and security settings, revokes broad/public and legacy Supabase-role execution, and grants only schema usage and function execution to the configured paper role. It does not grant direct access to the shadow tables or change function ownership.
- Added `phase-8.11-shadow-exit-evaluator-installation.sql`. It installs only the existing evaluator function body in the Pi database, after validating required tables and the migration owner's table/RLS privileges, and grants execution only to the configured restricted paper role. It deliberately does not replay the retired Supabase table, policy, or role setup.
- Documented the operator-controlled migration and restart steps in the Raspberry Pi README.

Shadow evaluation remains simulation-only. It does not execute SELL decisions, mutate actual positions, trades, balances, or snapshots, and does not influence paper-trading risk controls.

## Validation

- Targeted Pi tests: **38 passed, 0 failed**.
- Full Raspberry Pi suite: **185 passed, 0 failed**.
- Repository suite: **352 passed, 0 failed**.
- JavaScript syntax checks for all changed source and test files: **passed**.
- `git diff --check`: **passed**.
- Migration test used local PGlite to verify that only the configured paper role receives function execution.

Production database, Raspberry Pi service restart, and live monitoring response were not validated from this workspace.

## Activation and limitations

For the reported missing-function case, before restarting the Pi runtime:

1. Keep the already-applied Phase 8.10 dashboard-read migration; it is separate and does not need to be rerun.
2. Apply `raspberry-pi/migrations/phase-8.11-shadow-exit-evaluator-installation.sql` as the PostgreSQL schema owner, setting `cryptopulse.paper_database_user` to the exact role in the Pi's `PAPER_DATABASE_USER`.
3. Restart the runtime through the operator's normal systemd procedure.
4. Check the latest `/api/v1/monitoring` cycle for `stages.shadowExits` and inspect runtime logs for evaluator failures.

The migration was tested locally with PGlite for function installation, restricted function execution, and creation of seven scenarios and their events for a fresh open position. The live Pi database and runtime were not accessible from this workspace; production activation remains operator-verified.

The migration intentionally fails if the function is absent or does not meet the expected security contract. Do not apply the legacy Supabase migration wholesale to the Pi. If the function is absent, its database installation must be resolved separately before the runtime integration can activate.

No historical hypothetical price path can be reconstructed by this change. Scenarios begin from evaluations performed after activation; no rows are expected until eligible positions and fresh market data are available. Live activation and data generation remain operator-verified acceptance checks.

## Dashboard visibility follow-up

The initial runtime integration did not wire the shadow tables into the Pi dashboard repository/API response, so the existing dashboard component received no scenario records even when the database had them. The component also expected the legacy display state `TRIGGERED_HYPOTHETICALLY`, while the evaluator stores `TRIGGERED`; this made a real trigger render as ordinary tracking.

The follow-up adds a bounded dashboard read for open positions and tracked positions closed in the last 30 days, includes up to ten recent events per scenario, and maps the canonical evaluator states correctly. Shadow-query failures are logged and surfaced as `shadowExitScenarios.status: "UNAVAILABLE"` without turning the whole dashboard request into an error. The new Phase 8.10 migration grants the configured read-only `DATABASE_USER` `SELECT` on the two shadow tables only.

Follow-up validation: 28 targeted Raspberry Pi API/repository/auth/migration tests passed, 28 dashboard rendering tests passed, and `git diff --check` passed. No full-suite, live-database, Pi runtime, or Vercel deployment validation was performed for this follow-up.

Production still requires applying both the Phase 8.9 paper-role function permission migration and the Phase 8.10 dashboard-read migration, then restarting the Pi runtime. No production database query, migration, or restart was available from this workspace. The evaluator does not use historical candles or intrabar highs/lows, so it cannot backfill a +6% peak that happened before tracking was active or between observed marks.
