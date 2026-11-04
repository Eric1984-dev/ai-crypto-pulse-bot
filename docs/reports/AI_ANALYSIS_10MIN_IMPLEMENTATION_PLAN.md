# AI Analysis 10-Minute Cadence — Implementation Plan

**Date:** 2026-11-04
**Status:** Plan only. No code, scheduler, or configuration changes have been made.
**Approved change:** AI Analysis cadence 5 → 10 minutes; Paper Trading cadence 5 → 10 minutes.
**Basis:** [AI_ANALYSIS_CADENCE_AUDIT.md](./AI_ANALYSIS_CADENCE_AUDIT.md) — no material trading-behaviour difference, no missed executed trades, ~50% fewer invocations and candle reads, freshness-gate safety margin preserved.

## Executive summary

This is a **scheduler-only change**. No application code, database schema, or migration is required. The 5-minute cadence is not encoded anywhere in the codebase — it exists only in the external cron-job.org job definitions and in documentation. The change consists of editing **2 cron-job.org jobs** (AI Analysis, Paper Trading) from `*/5 * * * *` to `*/10 * * * *`, updating documentation, and monitoring for 24–48 hours.

**No new Vercel function is created** (Hobby 12-function limit unaffected). **No new `/api` file** is created.

## 1. Documentation updates

| File | Current text | Required change |
|---|---|---|
| [docs/SCHEDULING.md](../SCHEDULING.md) § Phase 07 | "Scheduler cadence is an operator choice; monitor HTTP responses and `AI_Crypto_Bot_Status` after configuring it." | Add the chosen cadence: "AI Analysis runs every 10 minutes." |
| [docs/SCHEDULING.md](../SCHEDULING.md) § Phase 08 | "Use the same cadence as AI analysis (five minutes is a suitable example when analysis runs every five minutes)." | Change the example to 10 minutes and state the selected cadence explicitly. |
| [docs/DEPLOYMENT.md](../DEPLOYMENT.md) § Phase 07 (line ~63) | "No scheduler cadence is imposed by the application." | Optionally note the configured 10-minute cadence. |
| [docs/DEPLOYMENT.md](../DEPLOYMENT.md) § Phase 08 (line ~69) | "Use the same cadence as analysis and do not run the jobs concurrently." | No text change required (already cadence-agnostic); verify it stays consistent. |
| [docs/CHANGELOG.md](../CHANGELOG.md) | — | Add entry: "AI Analysis and Paper Trading cadence changed from 5 to 10 minutes (scheduler-only; no code change)." |
| [docs/OPERATIONS_LOG.md](../OPERATIONS_LOG.md) | — | Add entry with date, event type "Scheduler Change", description, and result. |

No changes needed in `docs/API.md`, `docs/ARCHITECTURE.md`, or `docs/RISK_MANAGEMENT.md` — they describe gates and limits (15-minute freshness, cooldowns), not the 5-minute cadence.

## 2. Scheduler configurations affected

| Scheduler | Job | Current | New | Notes |
|---|---|---|---|---|
| cron-job.org | **AI Analysis** (`POST /api/ai-analysis`) | `*/5 * * * *` | `*/10 * * * *` | Keep `Authorization` header, URL, method, and timeout unchanged. |
| cron-job.org | **Paper Trading** (`POST /api/paper-trading`) | `*/5 * * * *` | `*/10 * * * *` | Keep sequencing: must run **after** AI Analysis completes, never concurrently. |

**Not affected** (leave unchanged):
- **Market Refresh** (`GET /api/market-refresh`) — independent 5-minute snapshot cadence; not part of this change.
- **Candle Refresh** (`GET /api/candle-refresh?interval=…&batch=…`) — 126 jobs; cadence per interval is driven by candle-freshness requirements, not by the analysis cadence. The audit's input-lag replay already showed decisions are insensitive to the current candle cadence.
- **Vercel Cron** — not configured; `vercel.json` declares no cron jobs. Nothing to change.
- **Dashboard / front-end polling** — 30-second visible-tab refresh in `js/dashboard.js`, `js/portfolio.js`, `js/history.js`, `js/scanner.js`, `js/realtime.js`; unrelated to the analysis cadence.

## 3. cron-job.org tasks affected

Exactly **2 tasks**:

1. The AI Analysis task → change schedule to every 10 minutes.
2. The Paper Trading task → change schedule to every 10 minutes.

Both tasks keep their existing protected `Authorization` header, target URL, HTTP method (POST), and timeout. No tasks are created or deleted. The 126 candle-refresh tasks and the market-refresh task are **not** modified.

**Sequencing note:** cron-job.org jobs are independent and not chained. With both jobs on the same 10-minute phase there is a small chance paper trading starts before analysis finishes. Mitigations already in place: the database serializes overlapping paper jobs (`pg_try_advisory_xact_lock`), skips when status is `ANALYZING`, and processes only the newest stored decision per market — so an occasional early run is idempotent and safe. If tighter ordering is desired, offset the Paper Trading job by 1–2 minutes (e.g. analysis at `*/10`, paper trading at `2-59/10` or `3-59/10`).

## 4. Code assumptions tied to the 5-minute cadence

**None found.** A full search of `lib/`, `api/`, `js/`, `config/`, `scripts/`, `supabase/`, and `tests/` for `5 min`, `300`, `300000`, `*/5`, and related patterns returned no cadence-dependent code:

- [lib/ai-engine.mjs](../../lib/ai-engine.mjs) — no run-frequency constant. Freshness limits are per-candle-interval (`CANDLE_MAX_AGE_MS`: 30 min for `1m` up to 72h for `1d`) and are independent of how often analysis runs. `MARKET_DATA_MAX_AGE_MS` = 15 min (input snapshot freshness), unchanged.
- [api/ai-analysis.mjs](../../api/ai-analysis.mjs) and [api/paper-trading.mjs](../../api/paper-trading.mjs) — no cadence constant; both are triggered purely by the external scheduler.
- [lib/market-data.mjs](../../lib/market-data.mjs) — candle/market refresh logic has no 5-minute assumption.
- Database functions in [20261101154600_phase08_paper_trading.sql](../../supabase/migrations/20261101154600_phase08_paper_trading.sql) — all time gates are 15 minutes (see §5); none reference 5 minutes.
- Tests — no test asserts a 5-minute scheduler cadence; `30000`-ms values in front-end tests are the 30-second UI polling interval, unrelated.

**Conclusion:** no code change, no migration, and no test update is required for this cadence change.

## 5. Paper-trading freshness verification

The executor's time gates (all in `AI_Crypto_Bot_Run_Paper_Trading` / `AI_Crypto_Bot_Apply_Paper_Decision`):

| Gate | Limit | At 10-min cadence |
|---|---|---|
| Decision freshness (`v_decision.created_at`) | **15 minutes** | ✅ A fresh decision is at most ~10 min old; one skipped/failed analysis run still leaves a ≤10-min-old (fresh) decision. Two consecutive failures would suspend trading until recovery — acceptable and safe (fails closed). |
| Market-snapshot freshness (`v_market.captured_at`) | 15 minutes | ✅ Unchanged; Market Refresh stays at 5 min, so snapshots remain well within the gate. |
| Position revaluation snapshot freshness | 15 minutes | ✅ Unchanged (same market-data gate). |
| Per-market entry cooldown | 15 minutes after any paper trade | ✅ Unchanged; cooldown is trade-driven, not cadence-driven. |
| Duplicate / `STALE_DECISION` / `ANALYZING` guards | — | ✅ Unchanged; idempotency and overlap protection are cadence-independent. |

**Freshness remains valid at 10 minutes.** The 15-minute decision gate retains a 5-minute safety margin, which is exactly the slack the audit identified as the reason to prefer 10m over 15m.

## 6. Implementation plan (step-by-step)

**Pre-implementation (no changes):**
1. Confirm this plan is approved.
2. Record current cron-job.org job IDs/URLs for AI Analysis and Paper Trading (for rollback reference).

**Implementation (scheduler + docs only):**
3. cron-job.org: edit the **AI Analysis** job schedule `*/5 * * * *` → `*/10 * * * *`. Save.
4. cron-job.org: edit the **Paper Trading** job schedule `*/5 * * * *` → `*/10 * * * *` (optionally offset by 1–2 min; see §3). Save.
5. Verify both jobs show the new schedule and a sane next-execution time in the cron-job.org list.
6. Update documentation per §1 (SCHEDULING.md, DEPLOYMENT.md note, CHANGELOG.md, OPERATIONS_LOG.md).

**Validation (first 24–48 hours):**
7. After the first 10-minute tick, confirm a new decision batch of 102 rows in `AI_Crypto_Bot_AI_Decisions` and `AI_Crypto_Bot_Status.last_run` advancing every ~10 minutes.
8. Confirm `AI_Crypto_Bot_Portfolio_Snapshots` continues to be written every ~10 minutes (no >15-minute gaps).
9. Confirm no `STALE_DECISION` / `MARKET_DATA_STALE` rejections appear that did not occur before, and that any BUY/SELL signal still reaches execution.
10. Monitor Vercel Active CPU usage over the following days to confirm the expected ~50% reduction in analysis/paper-trading invocations.

**Rollback:**
- Set both cron-job.org jobs back to `*/5 * * * *` and revert the documentation edits. No code or database rollback is needed because none was changed.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Paper trading runs before analysis completes (same 10-min phase) | Low | None — DB lock + `ANALYZING` skip make it idempotent | Optional 1–2 min offset on the paper-trading job |
| Two consecutive analysis failures → trading pauses until recovery | Low | Trading halts safely (fails closed); no bad trades | Monitor `AI_Crypto_Bot_Status`; alert on `ERROR`/`STOPPED` |
| Slightly later execution of fast signals (≤10 min) | Low | Marginal; audit found no signal that appeared and vanished within one step | Accepted per audit; revisit if strategy latency requirements tighten |

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
