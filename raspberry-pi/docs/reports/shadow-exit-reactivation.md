# Shadow Exit Reactivation Report

## Status

The Raspberry Pi runtime integration and permission migration are implemented and locally tested. Production activation is pending verification of the existing database function, application of the permission migration, and a supervised runtime restart. No live database change, deployment, push, or commit was performed.

## Root cause

The Raspberry Pi schema contract listed the shadow-exit scenario and event tables, but the Pi paper-trading runtime never called `AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios()`. Table presence alone therefore did not generate scenario or event rows.

The live database was not queried during this task. Whether the evaluator function and tables are installed in production remains unverified.

## Changes

- Added a repository method that calls the existing zero-argument JSONB evaluator in its own transaction and validates the bounded result.
- Wired evaluation before paper-trade processing, then after a cycle that executes trades. The second pass can observe actual position closures and begin evaluating newly opened positions.
- Isolated evaluator errors from paper-trading transactions. Failures are logged and surfaced without rolling back or blocking paper trades.
- Exposed the latest evaluator outcome as `lastCycle.stages.shadowExits` in operational monitoring.
- Added `phase-8.9-shadow-exit-runtime-permissions.sql`. It validates the configured non-privileged `PAPER_DATABASE_USER`, checks the existing function's signature and security settings, revokes broad/public and legacy Supabase-role execution, and grants only schema usage and function execution to the configured paper role. It does not grant direct access to the shadow tables or change function ownership.
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

Before restarting the Pi runtime:

1. Verify the two shadow-exit tables and `public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()` exist in the Pi PostgreSQL database.
2. Apply `raspberry-pi/migrations/phase-8.9-shadow-exit-runtime-permissions.sql` as the schema owner, setting `cryptopulse.paper_database_user` to the exact role in the Pi's `PAPER_DATABASE_USER`.
3. Restart the runtime through the operator's normal systemd procedure.
4. Check the latest `/api/v1/monitoring` cycle for `stages.shadowExits` and inspect runtime logs for evaluator failures.

The migration intentionally fails if the function is absent or does not meet the expected security contract. Do not apply the legacy Supabase migration wholesale to the Pi. If the function is absent, its database installation must be resolved separately before the runtime integration can activate.

No historical hypothetical price path can be reconstructed by this change. Scenarios begin from evaluations performed after activation; no rows are expected until eligible positions and fresh market data are available. Live activation and data generation remain operator-verified acceptance checks.
