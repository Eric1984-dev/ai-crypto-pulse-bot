# V2 Implementation Checklist

**Status:** Assessment only; no implementation, migration, configuration, or deployment changes  
**Date:** 2026-11-09  
**Basis:** Current repository implementation, V2 proposal, and paper-trading experiment plan

## Assessment summary

**Estimated complexity:** High  
**Estimated engineering effort:** **34–50 hours** (approximately 5–7 working days)  
**New database migrations:** **1**  
**New tables/columns/indexes:** **0**  
**New API/Vercel Functions:** **0**  
**New dependencies:** **0**

The estimate includes both JavaScript and database analysis modes, the existing
scheduler and Admin Actions entrypoints, database-enforced decision-version
selection, PGlite/API regression tests, and directly related documentation. It
excludes production migration approval/application, deployment approval,
hosted smoke testing, and the elapsed time to collect 25 or 50 closed trades.

The complexity is high because the decision formulas exist independently in
JavaScript and PostgreSQL, while paper execution currently selects the newest
decision without an engine-version filter. A configuration flag or scoring
branch alone is not sufficient.

## 1. Exact file checklist

### Runtime and configuration

- [ ] **Create** [`lib/ai-engine-version.mjs`](../../lib/ai-engine-version.mjs)  
  Centralize strict server-side parsing of `AI_ENGINE_VERSION` and its mapping
  to the immutable stored identity. Unset means V1; only `V1` and `V2` are
  accepted. Reject invalid values instead of falling back.
- [ ] **Update** [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs)  
  Preserve V1 output; implement the frozen V2 score/confidence branch; tag all
  decisions; select the corresponding JavaScript or database analysis call.
- [ ] **Update** [`lib/paper-trading.mjs`](../../lib/paper-trading.mjs)  
  Send the selected version to the version-aware database RPC and validate the
  returned run result.
- [ ] **Update** [`api/ai-analysis.mjs`](../../api/ai-analysis.mjs)  
  Resolve the shared server-side version and pass it to the AI service.
- [ ] **Update** [`api/paper-trading.mjs`](../../api/paper-trading.mjs)  
  Resolve the same version and pass it to the paper-trading service.
- [ ] **Update** [`api/admin-actions.mjs`](../../api/admin-actions.mjs)  
  Admin-triggered AI analysis and paper trading call the same selected
  version as the scheduled endpoints. This is a separate existing execution
  path and must not silently default to V1 during a V2 run.
- [ ] **Update** [`.env.example`](../../.env.example)  
  Add `AI_ENGINE_VERSION=V1`; keep it server-only and retain
  `ENABLE_LIVE_TRADING=false`.
- [ ] **Update** [`scripts/validate-project.js`](../../scripts/validate-project.js)  
  Validate that the environment template declares the V1 default.
- [ ] **Update** [`scripts/validate-database.js`](../../scripts/validate-database.js)  
  Validate the required version-aware RPC signatures/grants as well as the
  existing prefixed schema requirements.

### Tests

- [ ] **Update** [`tests/ai-engine.test.mjs`](../../tests/ai-engine.test.mjs)  
  Cover V1 default/parity, V2 formula and required input behavior, invalid
  version failure, and JavaScript/database output parity.
- [ ] **Update** [`tests/paper-trading.test.mjs`](../../tests/paper-trading.test.mjs)  
  Assert that the selected version reaches the RPC and malformed or
  mismatched-version results fail safely.
- [ ] **Update** [`tests/admin-actions.test.mjs`](../../tests/admin-actions.test.mjs)  
  Verify both admin actions pass the configured engine version and invalid
  configuration executes neither service.
- [ ] **Update** [`tests/database-migrations.test.js`](../../tests/database-migrations.test.js)  
  Apply the new migration in PGlite; test the new signatures, grants,
  active-version filtering, fail-closed legacy behavior, and unchanged risk and
  idempotency checks.
- [ ] **Update** [`tests/project-setup.test.js`](../../tests/project-setup.test.js)  
  Check the safe V1 value in `.env.example`.

### Directly related documentation

- [ ] [`README.md`](../../README.md)
- [ ] [`ROADMAP.md`](../../ROADMAP.md)
- [ ] [`docs/CHANGELOG.md`](../CHANGELOG.md)
- [ ] [`docs/API.md`](../API.md)
- [ ] [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
- [ ] [`docs/DATABASE.md`](../DATABASE.md)
- [ ] [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md)
- [ ] [`docs/RISK_MANAGEMENT.md`](../RISK_MANAGEMENT.md)
- [ ] [`docs/SCHEDULING.md`](../SCHEDULING.md)
- [ ] [`docs/TESTING.MD`](../TESTING.MD)
- [ ] [`V2_PAPER_TRADING_EXPERIMENT_PLAN.md`](./V2_PAPER_TRADING_EXPERIMENT_PLAN.md)  
  Align rollout details with the final SQL contract and deployment sequence.

Record production activation/rollback in `docs/OPERATIONS_LOG.md` only when
that operational event occurs; it is not an implementation prerequisite.

### Not in scope

- No new `api/` file, route, or Vercel Function.
- No new dependency, frontend control, or dashboard page.
- No changes to the Risk Manager, position execution function, confidence
  threshold, scheduler cadence, market universe, or live-trading mode.
- No new database table, column, index, policy, or strategy catalog row.
- No durable per-decision rejection audit; that remains separate roadmap
  backlog work.

## 2. Exact database function checklist

Use the existing timestamped migration process. Do not edit any applied
migration.

### Required new migration

- [ ] **Create one additive migration**, proposed filename:
  `supabase/migrations/20261109130000_ai_engine_v2_version_routing.sql`
  (select the next unused timestamp after rechecking the migration directory
  when implementation begins).
- [ ] Preserve the existing one-argument
  `public."AI_Crypto_Bot_Run_Database_AI_Analysis"(timestamptz)` as the V1
  path.
- [ ] Add a V2 database-analysis overload:
  `public."AI_Crypto_Bot_Run_Database_AI_Analysis"(timestamptz, text)`.
  The second argument is the validated engine selector; the V2 path must
  implement the same formula, confidence, decision, reason, and stored
  identity as JavaScript. Reject unsupported values.
- [ ] Add the version-aware paper executor:
  `public."AI_Crypto_Bot_Run_Paper_Trading"(text)`.
  Validate the selector in SQL and choose the newest decision **across all
  versions** for each symbol before verifying that its engine identity matches
  the requested version. A newer decision from another or unknown version
  means skip; never select an older matching decision as fallback.
- [ ] Replace the behavior of the legacy no-argument
  `public."AI_Crypto_Bot_Run_Paper_Trading"()` with a fail-closed
  `ENGINE_VERSION_REQUIRED` skipped result. It must not retain an unfiltered
  execution path after the version-aware RPC is introduced.
- [ ] Revoke execution from `PUBLIC`, `anon`, and `authenticated`; grant the
  applicable version-aware execution functions to `service_role` only.
- [ ] Preserve transaction/advisory locks, `SECURITY` mode, empty
  `search_path`, service-role restrictions, and the existing result contract
  where applicable.

### Existing functions that should not change

- `public."AI_Crypto_Bot_Apply_Paper_Decision"(uuid, uuid)` remains the final
  transactional executor and retains all current risk checks.
- `"AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(double precision[], double precision[], double precision[], double precision[])`
  already returns the trend EMA values/direction/spread, RSI, and volume ratio
  needed by the proposed V2 calculation. Reuse it unless parity tests expose a
  concrete missing output.
- Do not alter the already applied
  `20261109120000_ai_analysis_interval_batching.sql` migration or the existing
  V1 analysis function.

The decision table already stores `strategy_name` and `strategy_version` as
an immutable snapshot, and trades already store `ai_decision_id`. Those fields
are sufficient for the minimum V2 attribution; no table migration is needed.
Before implementation, freeze the exact V1/V2 identity mapping. V1 must retain
its current `Deterministic Technical Analysis` / `1.0.0` identity.

## 3. Implementation sequence

### A. Freeze the contract

- [ ] Freeze the mapping from `V1`/`V2` to stored strategy name/version.
- [ ] Freeze the proposal's scoring and confidence formulas; do not retune
  thresholds in this task.
- [ ] Confirm V2 remains compatible with existing low-data, freshness,
  confidence, and risk gates.
- [ ] Confirm database-mode support is required for the planned run; the
  repository records prior production use of database mode.

### B. Implement version dispatch

- [ ] Add the shared strict version resolver; default unset to V1 and reject
  invalid values before decision or trade writes.
- [ ] Wire scheduled and Admin Actions analysis through the same engine
  selection.
- [ ] Wire scheduled and Admin Actions paper execution through the same
  selection.
- [ ] Preserve exact V1 behavior in JavaScript and in the current one-argument
  database function.
- [ ] Add V2 logic in JavaScript and the new database overload. If daily EMA or
  hourly volume input is unavailable, stale, or invalid, fail safely without
  generating an actionable V2 decision.
- [ ] Keep the existing 65 AI directional confidence floor, four-valid-
  interval quality protection, 67 paper BUY gate, all freshness controls,
  fees, slippage, cooldown, position limits, drawdown controls, and emergency
  stop unchanged.

### C. Enforce version at database execution

- [ ] Update the paper-trading service to call the versioned RPC.
- [ ] Ensure the database selects the newest decision globally per symbol and
  then checks the exact requested version; never fall back to another version
  or an older matching decision.
- [ ] Make the old no-argument executor fail closed so a stale deployment
  cannot bypass version isolation.
- [ ] Keep BUY/SELL execution, `AI_Crypto_Bot_Apply_Paper_Decision`, and
  decision-linked idempotency unchanged.

### D. Verify and release

- [ ] Run focused unit/API/PGlite tests, then `npm.cmd test` and
  `npm.cmd run build`.
- [ ] Verify database privileges and function signatures in the local PGlite
  suite.
- [ ] Review the target Supabase project and migration state before remote
  application; verify the migration after applying it.
- [ ] Deploy with V1 active. Verify both scheduled and Admin Actions paths
  execute the selected V1 engine.
- [ ] Confirm analysis completes before paper trading and that no legacy
  no-argument scheduler call remains.
- [ ] Confirm the Vercel function count remains 12.
- [ ] Obtain separate approval before setting `AI_ENGINE_VERSION=V2`.
- [ ] Keep `ENABLE_LIVE_TRADING=false`; do not force-close existing positions
  during cutover or rollback.

## 4. Estimated implementation hours

| Work item | Estimate |
|---|---:|
| Freeze version contract, identity mapping, and V2 edge-case behavior | 2–3 h |
| Shared version resolver, environment checks, scheduled/Admin API wiring | 3–5 h |
| JavaScript V2 algorithm with V1 behavior preserved | 4–6 h |
| Database V2 analysis path and JavaScript/SQL parity | 8–12 h |
| Version-aware paper-trading RPC and legacy fail-closed path | 4–6 h |
| Unit, API, PGlite, admin-surface, and regression tests | 8–11 h |
| Direct documentation and build-validator updates | 4–5 h |
| Code review and local release/cutover rehearsal | 3–5 h |
| **Total** | **34–50 h** |

This is an estimate, not a delivery commitment. The SQL analysis/parity work
is the largest uncertainty. Production migration review, hosted validation,
and experiment runtime are excluded.

### Reduced JavaScript-only option

Restricting V2 to `AI_ANALYSIS_MODE=javascript` could remove the V2 database
analysis implementation and save an estimated **8–12 engineering hours**.
That option must explicitly reject V2 when database mode is selected, pin
JavaScript mode for both the V1 comparison and V2 run, and amend the experiment
plan. It is not the recommended checklist because database mode has been used
in production and changing analysis modes would add an experimental variable.

## 5. Migration and rollback impacts

- **Migration count:** one additive migration, with no table/column changes.
- **Forward-apply order:** pause/verify scheduler targets, apply and verify the
  migration, deploy the version-aware code with V1 selected, smoke-test V1,
  then resume the scheduler. The legacy no-argument RPC must fail closed after
  migration.
- **Routine rollback:** select V1 in the deployed version-aware code; run
  successful V1 analysis before paper execution; leave additive database
  objects and V2 history in place.
- **Open positions:** remain visible and close only through normal fresh SELL
  decisions and unchanged risk checks. Do not force-close them.
- **Schema rollback:** do not drop objects or edit applied migration files.
  Correct defects with a reviewed forward migration. A code-only rollback to a
  pre-version-aware deployment will not be compatible with the fail-closed
  legacy RPC and must not be used as the operational rollback plan.

## 6. Main operational risks

1. **Version mismatch:** the two endpoints, Admin Actions, and SQL executor
   must all resolve the same engine; any invalid or unknown state fails closed.
2. **SQL/JavaScript drift:** V2 formulas must be identical across both
   supported analysis modes before V2 is enabled.
3. **Legacy executor invocation:** the no-argument RPC must not execute
   unfiltered decisions; scheduler URLs and Admin Actions must use the updated
   deployment.
4. **Stale cross-version decisions:** the runner must select the newest
   decision overall and skip it if its version does not match; filtering first
   could otherwise expose an older decision as a fallback.
5. **Reduced signal availability:** V2 depends on fresh 1d EMA and 1h volume
   while retaining existing candle-history and low-data protections; missing
   inputs must not be replaced with fabricated neutral values.
6. **Exposure during cutover:** the experiment plan requires a flat start;
   rollback must not bypass pause/drawdown state or force-close positions.
7. **Production uncertainty:** repository documents prior database-mode
   production use, but current hosted configuration and post-migration health
   must be verified before rollout.
8. **Sample limitations:** prior replay evidence is sparse; reaching the
   25-/50-closed-lifecycle checkpoints is operational elapsed time, not part
   of the engineering estimate.

## Readiness conclusion

The work is feasible without changing the existing architecture, schema
shape, Vercel function count, dependencies, or Risk Manager. The minimum
complete scope is still a coordinated change across analysis, scheduled and
Admin Actions execution, version-aware database functions, tests, and
documentation. **No checklist item has been implemented or executed as part
of this assessment.**
