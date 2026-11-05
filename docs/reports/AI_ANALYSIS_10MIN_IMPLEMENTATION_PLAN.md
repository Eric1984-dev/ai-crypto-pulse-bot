# AI Analysis 10-Minute Cadence — Implementation Plan

**Date:** 2026-11-04
**Status:** Deferred plan only. No code, scheduler, or configuration changes have been made. This proposal is **not approved or deployed**.
**Proposed scope (requires separate approval):** AI Analysis and Paper Trading would use a common 10-minute cadence.
**Current status:** Latest stored production decisions show approximately five-minute effective spacing. The external cron expressions were not re-verified; keep current scheduler settings unchanged.
**Historical basis:** The [24-hour audit](./AI_ANALYSIS_CADENCE_AUDIT.md) recommended 10 minutes based on its observation window. The subsequent [5.5-hour validation](./AI_ANALYSIS_10MIN_CADENCE_VALIDATION.md) returned Verdict B and identified a possible 95-minute alternate-phase delay to an observed BUY. See the [current cadence clarification](./AI_ANALYSIS_CADENCE_STATUS_CLARIFICATION_2026-11-05.md).

## Executive summary

If separately approved after representative validation, this would be a **scheduler-only change**. No application code, database schema, or migration is expected to be required. The latest external cron expressions and job definitions have not been verified, so this plan does not assume that either job currently uses `*/5 * * * *` and is not an instruction to change settings now. Any future rollout must first verify the scheduler and guarantee that Paper Trading runs only after successful AI Analysis completion.

**No new Vercel function is created** (Hobby 12-function limit unaffected). **No new `/api` file** is created.

## 1. Documentation updates

| File | Current text | Required change |
|---|---|---|
| [docs/SCHEDULING.md](../SCHEDULING.md) § Phase 07 | Operator-controlled cadence; monitor endpoint responses and agent status. | Keep current settings unchanged; describe a different cadence only after separate approval and verification. |
| [docs/SCHEDULING.md](../SCHEDULING.md) § Phase 08 | Paper Trading follows AI Analysis and shares its cadence. | Preserve sequential execution and matching cadence; do not record 10 minutes as current. |
| [docs/DEPLOYMENT.md](../DEPLOYMENT.md) | Cadence is not imposed by application code. | No change unless a cadence change is separately approved and verified. |
| [docs/CHANGELOG.md](../CHANGELOG.md), [docs/OPERATIONS_LOG.md](../OPERATIONS_LOG.md) | Historical records of actual changes. | Update only after an approved scheduler change has actually been made and verified. |

No changes needed in `docs/API.md`, `docs/ARCHITECTURE.md`, or `docs/RISK_MANAGEMENT.md` — they describe gates and limits (15-minute freshness, cooldowns), not the 5-minute cadence.

## 2. Scheduler configurations affected

| Scheduler | Job | Current evidence | Proposed only if separately approved |
|---|---|---|---|
| External scheduler (not re-verified) | **AI Analysis** (`POST /api/ai-analysis`) | Stored production decisions show approximately five-minute spacing; exact cron expression unknown. | A common 10-minute recurrence, after verifying the current job and scheduler controls. |
| External scheduler (not re-verified) | **Paper Trading** (`POST /api/paper-trading`) | Exact cron expression and job configuration unknown. | The same recurrence as AI Analysis, while running only after successful analysis completion. |

**Not affected** (leave unchanged):
- **Market Refresh** (`GET /api/market-refresh`) — separate from this decision.
- **Candle Refresh** (`GET /api/candle-refresh?interval=…&batch=…`) — separate from this decision; no candle-refresh schedule change is proposed.
- **Vercel Cron** — not configured; `vercel.json` declares no cron jobs. Nothing to change.
- **Dashboard / front-end polling** — 30-second visible-tab refresh in `js/dashboard.js`, `js/portfolio.js`, `js/history.js`, `js/scanner.js`, `js/realtime.js`; unrelated to the analysis cadence.

## 3. cron-job.org tasks affected

If separately approved and confirmed in the external scheduler, the proposed scope is limited to the two existing tasks:

1. The AI Analysis task (`POST /api/ai-analysis`).
2. The Paper Trading task (`POST /api/paper-trading`).

The current job IDs, expressions, and scheduler behavior must be verified before any change. Both endpoints must use the same recurrence, and each Paper Trading invocation must occur only after that cycle's AI Analysis request succeeds. Merely assigning two independent jobs the same cron expression does not guarantee this ordering; if the scheduler cannot guarantee completion-aware sequencing, do not roll out using this plan. No candle-refresh or market-refresh schedule change is proposed.

## 4. Code assumptions tied to the 5-minute cadence

**None found.** A full search of `lib/`, `api/`, `js/`, `config/`, `scripts/`, `supabase/`, and `tests/` for `5 min`, `300`, `300000`, `*/5`, and related patterns returned no cadence-dependent code:

- [lib/ai-engine.mjs](../../lib/ai-engine.mjs) — no run-frequency constant. Freshness limits are per-candle-interval (`CANDLE_MAX_AGE_MS`: 30 min for `1m` up to 72h for `1d`) and are independent of how often analysis runs. `MARKET_DATA_MAX_AGE_MS` = 15 min (input snapshot freshness), unchanged.
- [api/ai-analysis.mjs](../../api/ai-analysis.mjs) and [api/paper-trading.mjs](../../api/paper-trading.mjs) — no cadence constant; both are triggered purely by the external scheduler.
- [lib/market-data.mjs](../../lib/market-data.mjs) — candle/market refresh logic has no 5-minute assumption.
- Database functions in [20261101154600_phase08_paper_trading.sql](../../supabase/migrations/20261101154600_phase08_paper_trading.sql) — all time gates are 15 minutes (see §5); none reference 5 minutes.
- Tests — no test asserts a 5-minute scheduler cadence; `30000`-ms values in front-end tests are the 30-second UI polling interval, unrelated.

**Conclusion:** no code change, no migration, and no test update is required for this cadence change.

## 5. Paper-trading freshness considerations

The executor's time gates (all in `AI_Crypto_Bot_Run_Paper_Trading` / `AI_Crypto_Bot_Apply_Paper_Decision`) are unchanged by this plan. The table is a conditional threshold comparison, not evidence that a 10-minute schedule is behaviorally safe. The later alternate-phase replay reported a possible 95-minute delay before an observed BUY reached the entry threshold.

| Gate | Limit | Conditional note for a 10-minute cadence |
|---|---|---|
| Decision freshness (`v_decision.created_at`) | **15 minutes** | Nominally leaves five minutes beyond a 10-minute interval, but missed runs and execution delays can consume that margin. |
| Market-snapshot freshness (`v_market.captured_at`) | 15 minutes | Unchanged; external market-refresh settings were not re-verified here. |
| Position revaluation snapshot freshness | 15 minutes | Unchanged (same market-data gate). |
| Per-market entry cooldown | 15 minutes after any paper trade | Unchanged; cooldown is trade-driven, not cadence-driven. |
| Duplicate / `STALE_DECISION` / `ANALYZING` guards | — | Unchanged; these controls do not establish cadence equivalence or guarantee job ordering. |

The 15-minute freshness gate alone does not justify a cadence change. Preserve current scheduling unless a separate decision approves a validated alternative.

## 6. Implementation plan (step-by-step)

**Pre-implementation (only after a separate approval; no changes are authorized by this plan):**
1. Confirm this plan is approved.
2. Verify and record the current external scheduler, job IDs, URLs, expressions, and rollback settings.
3. Confirm the scheduler can run Paper Trading only after successful completion of AI Analysis while preserving the same recurrence.

**Conditional implementation (scheduler + docs only):**
4. If approved and sequencing is guaranteed, configure both existing jobs to the same 10-minute recurrence without changing their protected headers, URLs, methods, or timeouts.
5. Verify both settings and confirm successful AI Analysis completion precedes each Paper Trading invocation.
6. Update operational documentation only after the setting is changed and verified.

**Validation (first 24–48 hours):**
7. After the first 10-minute tick, confirm a new decision batch of 102 rows in `AI_Crypto_Bot_AI_Decisions` and `AI_Crypto_Bot_Status.last_run` advancing every ~10 minutes.
8. Confirm `AI_Crypto_Bot_Portfolio_Snapshots` continues to be written every ~10 minutes (no >15-minute gaps).
9. Confirm no `STALE_DECISION` / `MARKET_DATA_STALE` rejections appear that did not occur before, and that any BUY/SELL signal still reaches execution.
10. Monitor Vercel Active CPU usage over the following days to confirm the expected ~50% reduction in analysis/paper-trading invocations.

**Rollback:**
- Restore the previously verified scheduler settings and revert only documentation that records a completed change. Do not assume the previous expressions were `*/5 * * * *`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Paper trading runs before analysis completes | Must be prevented | Paper Trading may consume an older decision; a database lock does not guarantee current-cycle sequencing. | Require completion-aware sequential execution; do not roll out if the scheduler cannot ensure it. |
| Two consecutive analysis failures → trading pauses until recovery | Low | Trading halts safely (fails closed); no bad trades | Monitor `AI_Crypto_Bot_Status`; alert on `ERROR`/`STOPPED` |
| Alternate cadence phase delays a threshold-crossing signal | Unquantified | The 5.5-hour replay found an alternate phase could delay an observed BUY by about 95 minutes. | Resolve with representative validation before any separate approval. |

## Out of scope

- Candle-refresh cadence, market-refresh cadence, and the 126 candle-refresh cron jobs.
- Any code, database, migration, or front-end change.
- Vercel Cron configuration (not used).
- The separate, still-open question of overall invocation volume vs. the Hobby Active CPU budget (see [VERCEL_CPU_ATTRIBUTION_REPORT.md](./VERCEL_CPU_ATTRIBUTION_REPORT.md) and [SCHEDULER_SIMPLIFICATION_REPORT.md](./SCHEDULER_SIMPLIFICATION_REPORT.md)).

## Sources

- [AI_ANALYSIS_CADENCE_AUDIT.md](./AI_ANALYSIS_CADENCE_AUDIT.md) — decision simulation, executed-trade analysis, resource estimates.
- [docs/SCHEDULING.md](../SCHEDULING.md), [docs/DEPLOYMENT.md](../DEPLOYMENT.md) — current scheduler guidance.
- [lib/ai-engine.mjs](../../lib/ai-engine.mjs), [api/ai-analysis.mjs](../../api/ai-analysis.mjs), [api/paper-trading.mjs](../../api/paper-trading.mjs), [lib/market-data.mjs](../../lib/market-data.mjs) — code search confirming no 5-minute cadence assumption.
- [supabase/migrations/20261101154600_phase08_paper_trading.sql](../../supabase/migrations/20261101154600_phase08_paper_trading.sql) — 15-minute freshness/cooldown gates.
- No tests were run; this is a plan-only document with no code changes.
