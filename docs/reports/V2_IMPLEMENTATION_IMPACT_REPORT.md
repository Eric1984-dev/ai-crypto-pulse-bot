# V2 Implementation Impact Report

**Status:** Planning only; no implementation, migration, configuration, or deployment changes  
**Date:** 2026-11-09  
**Scope:** Smallest safe implementation to run the proposed V2 engine through the existing paper-trading framework

## Executive assessment

V2 can use the existing architecture and storage. The minimum complete change
does **not** require a new API route, Vercel Function, database table, decision
column, strategy table row, dependency, or change to the Risk Manager. Existing
decision rows already store `strategy_name` and `strategy_version`; each
executed trade already stores its source `ai_decision_id`.

The minimum safe implementation does require coordinated changes in both
analysis paths and in decision selection at execution:

1. Implement the proposed V2 score/confidence branch while preserving V1
   behavior and explicitly tagging every decision.
2. Read and validate `AI_ENGINE_VERSION` in the existing analysis and
   paper-trading endpoints.
3. Pass the selected version into the existing paper-trading service/RPC and
   make the database executor reject decisions from every other version.
4. Add a migration for the database-side analysis and paper-execution
   functions, with service-role-only grants and no version fallback.
5. Test JavaScript/database parity, version isolation, rollback behavior, and
   unchanged risk controls.

The database-analysis path is included in the recommended minimum because the
repository records that it has been used successfully in production. A
JavaScript-only V2 is a smaller code change, but it requires explicitly
switching and pinning `AI_ANALYSIS_MODE=javascript` for the whole comparison
and failing closed on a V2/database-mode combination. It is not the recommended
scope unless that operating-mode change is separately approved and validated.

The existing `api/` directory contains 12 functions. This plan adds none, so
the Vercel Hobby function limit remains unchanged.

## Current implementation relevant to V2

- [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs) implements the deterministic
  V1 algorithm, currently tagged `Deterministic Technical Analysis` /
  `1.0.0`. It already calculates per-timeframe EMA, RSI, volume, and other
  indicators. It currently has no `AI_ENGINE_VERSION` dispatch.
- [`api/ai-analysis.mjs`](../../api/ai-analysis.mjs) passes
  `AI_ANALYSIS_MODE` to the AI service, but no engine version.
- The database mode calls
  `AI_Crypto_Bot_Run_Database_AI_Analysis(p_analysis_time)`, whose current SQL
  implementation stores the V1 strategy identity. It must not be allowed to
  generate V1 decisions while the executor is configured for V2.
- [`api/paper-trading.mjs`](../../api/paper-trading.mjs) and
  [`lib/paper-trading.mjs`](../../lib/paper-trading.mjs) call the current
  no-argument paper-trading RPC.
- `AI_Crypto_Bot_Run_Paper_Trading()` selects the newest stored decision per
  symbol without an engine-version filter. Versioning analysis alone would
  therefore be unsafe: paper trading could execute a decision from the other
  engine.
- `AI_Crypto_Bot_Apply_Paper_Decision()` is the transactional execution and
  risk-enforcement layer. It should remain authoritative and its position,
  confidence, cooldown, funds, drawdown, emergency-stop, freshness, fee,
  slippage, and idempotency behavior must not be changed by V2.
- [`AI_Crypto_Bot_AI_Decisions`](../../supabase/migrations/20261031190000_create_agent_tables.sql)
  already has the paired nullable `strategy_name` / `strategy_version`
  snapshot. `AI_Crypto_Bot_Trades` already links to the source AI decision.
- [`V2_PAPER_TRADING_EXPERIMENT_PLAN.md`](./V2_PAPER_TRADING_EXPERIMENT_PLAN.md)
  defines V1 as the default, version-isolated execution, and the 25-/50-trade
  checkpoints. The V2 formula itself is in
  [`AI_ENGINE_V2_PROPOSAL.md`](./AI_ENGINE_V2_PROPOSAL.md).

The database-mode prototype report records a successful user-reported
production run. It does not establish the current environment value or
continued production health, and the post-batching runtime still requires
verification. See
[`AI_ANALYSIS_DATABASE_MODE_PROTOTYPE_REPORT.md`](./AI_ANALYSIS_DATABASE_MODE_PROTOTYPE_REPORT.md)
and the current database-mode notes in
[`ROADMAP.md`](../../ROADMAP.md).

## Smallest complete change set

### Runtime files

| File | Minimum change |
|---|---|
| [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs) | Accept a validated engine version; preserve V1 output exactly; implement the V2 formula from the proposal in the JavaScript path; tag decisions with a distinct version; pass the selected version to database analysis. Keep current data validation, stale-candle protection, signal floor, and error behavior. |
| [`api/ai-analysis.mjs`](../../api/ai-analysis.mjs) | Validate server-only `AI_ENGINE_VERSION` (`V1` when unset; reject invalid values) and pass it to the service. Invalid configuration must fail closed before creating decisions. |
| [`api/paper-trading.mjs`](../../api/paper-trading.mjs) | Validate and pass the same engine selection to the existing paper-trading service. |
| [`lib/paper-trading.mjs`](../../lib/paper-trading.mjs) | Send the selected version to the existing version-aware RPC, validate the response, and preserve the current sequential execution and shadow-exit isolation. |
| [`supabase/migrations/`](../../supabase/migrations) | Add one timestamped migration for version-aware database analysis and paper execution. Do not edit already-applied migrations. Details are in the next section. |
| [`tests/ai-engine.test.mjs`](../../tests/ai-engine.test.mjs) | Add V2 formula/input tests, exact V1 regression checks, invalid/missing-input fail-closed cases, and JS/database payload parity. |
| [`tests/paper-trading.test.mjs`](../../tests/paper-trading.test.mjs) | Assert the RPC receives the selected version, rejects mismatches, and never falls back to another engine. |
| [`tests/database-migrations.test.js`](../../tests/database-migrations.test.js) | Exercise the new SQL entrypoints, version filtering, service-role-only grants, no-argument compatibility behavior, and unchanged risk/idempotency regressions in PGlite. |
| [`.env.example`](../../.env.example) | Document `AI_ENGINE_VERSION=V1` as the safe default. Do not add a client-visible setting. |

### Documentation changed for an actual implementation

Update the existing README, roadmap, changelog, API, architecture, database,
risk, testing, scheduling, and deployment documentation. Record the V2
identity, environment-variable behavior, migration, rollout and rollback
procedure, required parity checks, and that paper trading remains simulated.
Update the experiment plan if the implemented cutover or database-mode scope
differs from its current assumptions.

No separate analytics endpoint is required for basic version comparison:
decision strategy/version metadata and decision-linked trades provide the
existing attribution inputs. A dedicated experiment dashboard or durable
rejection-reason audit would be optional scope, not a prerequisite for the
smallest safe V2 run.

## Database objects and migration requirements

### Objects that can be reused unchanged

| Existing object | V2 use |
|---|---|
| `AI_Crypto_Bot_AI_Decisions.strategy_name` / `strategy_version` | Store an immutable V1 or V2 identity on every BUY, SELL, HOLD, and WAIT decision. |
| `AI_Crypto_Bot_Trades.ai_decision_id` | Attribute each execution to the decision that produced it. |
| Existing candle, market-data, portfolio, position, trade, snapshot, and risk objects | Reuse as-is. No additional input or portfolio storage is needed. |
| `AI_Crypto_Bot_Apply_Paper_Decision(uuid, uuid)` | Continue to apply the existing transactional risk checks after version selection. |

### Objects requiring a version-aware implementation

1. **`AI_Crypto_Bot_Run_Database_AI_Analysis`**  
   The current function calculates and stores V1 decisions. Add or replace a
   version-aware SQL path so database mode implements the same V2 formulas,
   missing-input behavior, signal gates, indicators, reasons, and strategy
   identity as JavaScript. Keep the current V1 behavior available. Preserve
   the function's service-role-only execution and internal-schema protections.

2. **`AI_Crypto_Bot_Run_Paper_Trading`**  
   Add an expected engine identity to the execution contract and select only
   the newest valid decision for that identity. Reject invalid identities;
   never fall back to another version or an untagged decision. Make any
   retained legacy no-argument call fail closed or constrain it so it cannot
   execute unfiltered decisions during a V2 run. Keep execution and internal
   helper grants restricted to `service_role`.

No new tables, columns, indexes, policies, or strategy catalog rows are
required. The SQL must validate the mapping from the configured engine to the
stored decision identity; it must not trust an arbitrary caller-provided
strategy name/version pair.

### Migration shape

Use one additive migration that introduces the version-aware function
contracts and preserves a safe V1 path. Prefer overloads or explicit wrappers
over destructive drops so the application can be rolled back without removing
database objects. The migration must:

- Keep all application object names prefixed `AI_Crypto_Bot_`.
- Preserve `SECURITY DEFINER` / `SECURITY INVOKER`, empty `search_path`,
  transaction locking, and exact grants appropriate to each function.
- Keep the new database analysis path behaviorally equivalent to the V2
  JavaScript path.
- Prevent legacy paper-trading calls from selecting the latest decision
  irrespective of version.
- Be tested by the existing PGlite migration suite before any remote
  application.

This is a required schema-history change even though it adds no table or
column. Review the target Supabase project and migration state before
application; do not edit prior migrations or claim remote application without
verification.

## V2-specific correctness constraints

- Use the proposed V2 weights and confidence formula from the V2 proposal as a
  frozen candidate. Do not tune them as part of this implementation.
- Keep the existing directional score boundary, AI signal confidence floor,
  and paper executor BUY confidence gate unchanged. In particular, keep the
  current low-data confidence cap and four-interval directional-quality
  protection so V2 does not turn two valid intervals into a trade signal.
- Require the candidate's fresh, valid daily EMA and hourly volume inputs. If
  required inputs are absent, stale, or invalid, return a safe non-entry result
  with an explicit data-quality reason; do not substitute a neutral value and
  continue to BUY.
- Keep all six-interval validation and candle freshness checks. V2 changes
  scoring, not data eligibility or the active watched-market universe.
- Keep the V1 algorithm executable and prove explicit V1 and default V1
  produce the existing outputs.
- Require database mode and JavaScript mode to produce matching decision,
  confidence, reason, indicator, and version payloads for the same fixed
  inputs.
- Ensure paper execution's selected decision is both the configured version
  and the newest relevant decision. A fresh decision from another version
  must not be used as a fallback.

## Smaller but restricted alternative

The code footprint can be reduced by supporting V2 only in JavaScript mode and
returning an explicit error for `AI_ENGINE_VERSION=V2` together with
`AI_ANALYSIS_MODE=database`. That avoids changing the database analysis
calculation, but it is a **scope restriction**, not full version support. It
would require pinning JavaScript mode for the V1 comparison and V2 experiment,
verifying that the deployed scheduler uses the same setting, and updating the
experiment plan. Because database mode has been used in production, the
recommended implementation is to support both modes rather than silently
switching the production analysis engine.

## Rollback complexity

**Expected complexity: low for application behavior, moderate for coordinated
rollout.**

- Keep V1 in the deployed code and default `AI_ENGINE_VERSION` to V1.
- Roll back by setting the server-side version to V1, then verify successful
  V1 analysis before the next paper-trading invocation.
- Keep the additive migration and versioned history in place. Do not drop
  database functions or delete V2 decisions/trades as part of a routine
  rollback.
- Maintain a safe behavior for old no-argument paper-execution callers;
  otherwise an older deployment can bypass the version filter. During cutover,
  pause or verify scheduler traffic so old and new callers cannot execute
  concurrently.
- Existing V2-origin open positions remain managed by normal fresh SELL
  decisions after rollback. Do not force-close them. Record the exit decision
  version separately from the V2 entry version.
- If a defect exists in the V2 SQL implementation, leave V1 available and
  use a reviewed forward migration to correct or retire the V2 SQL path. Do
  not rewrite an applied migration.

The data is additive and auditable, but the system-wide environment setting is
not an instantaneous kill switch unless the deployed runtime has loaded the
new value. Vercel configuration/deployment and scheduler timing must be
included in the rollback procedure.

## Operational risks

| Risk | Required mitigation |
|---|---|
| Paper executor consumes a fresh decision from the wrong engine | Pass the selected version into the database RPC and filter before execution; no cross-version or untagged fallback. |
| Analysis and trading endpoints disagree about the active version | Validate the same server-side setting in both; deploy and schedule them as one coordinated release. |
| SQL and JavaScript V2 formulas drift | Fixed-input PGlite parity tests over all output fields; do not activate database-mode V2 without parity. |
| Legacy RPC/deployment bypasses new filtering | Make legacy behavior safe/fail-closed and pause or verify old scheduler targets during rollout. |
| V2 has too few fresh inputs to generate decisions | Require the specified 1d/1h inputs and retain existing candle freshness, history, low-data, and confidence protections. |
| V2 confidence distribution changes trade frequency | Keep the 65 signal floor and 67 executor gate unchanged; monitor generated decisions and executed trades separately. |
| Existing positions remain open at switch or rollback | Follow the flat-start requirement in the experiment plan; never force-close; allow ordinary risk-managed SELLs. |
| Migration or deployment fails partway through | Remain on V1; fail closed on missing RPC/version configuration; verify applied migration and live endpoints before resuming the scheduler. |
| Historical V1 sample is too small or market regime differs | Treat 25 as an interim checkpoint and 50 as the planned final checkpoint; report sample sizes and time-window limitations. |
| Function-limit or dependency creep | Reuse current API endpoints and modules. Add no `/api` file or library. |

The existing executor does not persist detailed per-decision rejection reasons.
That limits attribution of skipped opportunities but is not a blocker for a
basic paper-trade cohort comparison. Building a durable execution audit is
separate optional work already listed in the roadmap backlog.

## Required implementation validation

Before enabling V2:

1. Pass existing V1 unit, API, PGlite, full test, and build checks.
2. Verify V1 output parity in both analysis modes.
3. Verify V2 JavaScript/database parity for every decision field and required
   data failure case.
4. Verify wrong-version, untagged, stale, and missing decisions cannot reach
   execution; verify retries remain idempotent.
5. Re-run paper-trading tests for the five-position cap, 10% position limit,
   67 confidence gate, 15-minute cooldown, drawdown limits, emergency stop,
   fees, slippage, and SELL behavior.
6. Confirm the new migration's service-role grants and function security in
   PGlite, then review and apply it to the intended Supabase project under the
   project's migration procedure.
7. Deploy with V1 active, verify sequential AI-analysis then paper-trading
   execution, confirm the 12-function count, and only then separately approve
   V2 activation.

No tests, migration application, or deployment were performed for this
planning report.

## Conclusion

The smallest **complete and safe for this repository** implementation is
version dispatch in the existing engine and endpoints, version-filtered
database execution, version-aware database analysis, one additive SQL
migration, and targeted regression coverage. It reuses existing records and
routes and leaves the Risk Manager untouched. The most important implementation
requirement is to enforce engine identity at the database execution boundary;
an environment flag or a V2 scoring branch alone is insufficient.
