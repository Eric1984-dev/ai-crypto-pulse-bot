# AI Analysis and Paper Trading Cadence Assessment

**Assessment date:** 2026-11-05
**Production query observation:** 2026-11-05 13:14:38 UTC
**Scope:** Read-only comparison of five-, seven-, and ten-minute AI Analysis and Paper Trading cadences. No code, scheduler settings, production data, migrations, or deployments were changed.

## Verdicts

| Cadence | Verdict | Assessment |
|---|---|---|
| 5 minutes | **RECOMMENDED** | Retain the current observed cadence. It is the only cadence with production execution evidence across the measured window, and it leaves the most margin under the 15-minute decision-freshness gate. The external scheduler settings themselves were not re-verified. |
| 7 minutes | **INSUFFICIENT EVIDENCE** | A seven-minute cron step is not a uniform seven-minute interval. All simulated phases missed some short signal episodes, and the sparse trade sample cannot establish safety across phases or failures. Do not change schedules on this evidence. |
| 10 minutes | **INSUFFICIENT EVIDENCE** | The prior 24-hour recommendation is historical, not approval. The later validation returned “B. Additional validation required”; the all-phase replay again found phase-dependent entry delays approaching 97 minutes. Do not change schedules on this evidence. |

These are assessment verdicts, not permission to change a scheduler. Keep AI Analysis and Paper Trading at their existing settings during any market-universe pilot. If a cadence change is separately considered later, the two jobs must use the same recurrence and Paper Trading must follow a successful, completed AI Analysis request.

## Identity, status, and evidence window

- The shared Supabase dashboard showed one project, **CRYPTO PULSE BOT**, project reference `jgnuhgsceilhxugffauj`, region `eu-west-1`. The configured read-only SQL connection reported database `postgres`, role `supabase_read_only_user`, PostgreSQL 17.6 at **2026-11-05 13:14:38 UTC**. The SQL result did not itself expose the project reference, so the connection-to-dashboard reference was not independently cross-mapped.
- The database status row was `ACTIVE`, not analyzing, with `last_run = 2026-11-05 13:01:13.380 UTC` and no error message.
- The fixed complete-decision window was **2026-11-01 05:57:38.832659 through 2026-11-05 13:01:12.691971 UTC** (about 4 days, 7 hours). It contained **1,235** exact run timestamps; every timestamp had exactly **102 rows for 102 distinct symbols** (125,970 decisions). No incomplete batch was found in that window.
- The trailing 24 hours contained **285 complete batches**, or 29,070 decision rows. The last-seven-days query covered only the same approximately 4.3 days of retained observations; it is not a seven-day sample.
- The run-gap query found a median gap of **4.99998 minutes**, mean **5.0110 minutes**, p95 **5.12072 minutes**, and maximum **10.08864 minutes**. There were eight gaps over 5.5 minutes, six over 10 minutes, and none over 15 minutes. This supports an approximately five-minute *effective decision cadence*, not the current external cron expression or phase.
- The shared dashboard did not include the cron-job.org account. The latest scheduler inventory report is dated 2026-11-03 and inspected candle-refresh jobs, not the current AI Analysis and Paper Trading jobs. Their current job IDs, expressions, timezone, phase, chaining, and failure history remain unverified.
- `ENABLE_LIVE_TRADING=false` remains the required project default. The production Vercel environment value was not inspected; no setting was changed.

## Paper-trading evidence and freshness

The read-only production query found **7 trades** in the observed period: six BUY entries and one SELL exit. One position had closed. Five positions were still open at the observation: `WIN-EUR`, `POL-EUR`, `MEGA-EUR`, `ARX-EUR`, and `SXT-EUR`. The portfolio was at the five-open-position limit. This is too little closed-trade evidence to claim performance or exit equivalence.

All seven linked trades used decisions between **1.599 and 1.930 minutes old** at execution; the median was **1.771 minutes**, and none exceeded the 15-minute freshness limit. This is the observed decision-to-trade age, not a measured scheduler completion guarantee.

There were **1,118** portfolio snapshots for one portfolio from 2026-11-01 16:17:16.791 UTC through 2026-11-05 13:03:11.322 UTC. Snapshot gaps had a median of 4.997 minutes, p95 5.059 minutes, maximum 14.162 minutes, and none exceeded 15 minutes. Snapshots are only a proxy for Paper Trading invocations; there is no durable per-invocation or per-decision rejection history to prove every paper job ran.

Risk rules in [RISK_MANAGEMENT.md](../RISK_MANAGEMENT.md) and the Phase 08 database functions enforce a **15-minute** decision-age limit. The current BUY-entry threshold is **67**; valid SELL decisions can close an existing position without that entry threshold. The 15-minute gate is fail-closed and cannot be relaxed as a cadence workaround.

### Delays and failures

| Scenario | 5-minute baseline | 7-minute proposal | 10-minute proposal |
|---|---:|---:|---:|
| Normal linked-trade decision age observed | 1.599–1.930 min | Not deployed; a completion-aware cycle should remain similarly fresh, but is unmeasured | Not deployed; a completion-aware cycle should remain similarly fresh, but is unmeasured |
| One schedule interval plus the observed maximum 1.930-minute decision-to-trade age | About 6.93 min | About 8.93 min for a true 7-minute timer; the cron phases with an 11-minute hour-boundary gap could reach about 12.93 min | About 11.93 min |
| Two nominal intervals plus that age, if an old decision is still executed | About 11.93 min | About 15.93 min for a true 7-minute timer | About 21.93 min |

The delay rows are arithmetic scenarios, not observed failure tests. For `*/7`, offset cron phases can have an 11-minute boundary gap; those phases have less than two minutes of freshness margin after one such gap plus the observed decision-to-trade age.

With strict sequencing, a failed AI Analysis request must prevent that cycle's Paper Trading request; this avoids executing a stale decision but means no new decision is acted on until analysis succeeds again. A delayed Paper Trading request may use only the newest stored decision, and the database rejects it once it is more than 15 minutes old; missed decisions are not replayed. A delay beyond 15 minutes after decision creation therefore fails closed at every cadence.

The documentation requires `POST /api/ai-analysis` to complete successfully before `POST /api/paper-trading` is invoked. The current external configuration was not checked, and the prior implementation plan described the jobs as independent rather than chained. Two independent jobs with matching cron expressions do **not** prove sequential execution. A future cadence change is not safe to roll out unless the external scheduler is shown to enforce success-dependent ordering and prevent overlap.

## Seven-minute cron semantics and rates

The [cron-job.org REST API documentation](https://docs.cron-job.org/rest-api.html) represents a schedule as a timezone and explicit `minutes` values (its example uses `[0, 15, 30, 45]`). Translating the proposed standard minute-field expression `*/7 * * * *` gives minute values `[0, 7, 14, 21, 28, 35, 42, 49, 56]` **within each hour**. The list restarts at minute 0 in the next hour; the interval from `:56` to the next `:00` is four minutes. Thus this expression is not a strict seven-minute timer:

- `*/7 * * * *`: 9 executions/hour, **216/day**, average interval **6 minutes 40 seconds**, with a four-minute hour-boundary gap.
- All seven possible offsets modulo seven were simulated. Offsets 0–3 produce nine executions/hour (216/day); offsets 4–6 produce eight/hour (192/day) and an 11-minute hour-boundary gap.
- `*/10 * * * *`: minute values 0, 10, 20, 30, 40, and 50; **144/day**. All ten offsets modulo ten produce six executions/hour and a ten-minute interval.

The rate calculation follows the minute-list/hour reset semantics, not an external account preview. The current project job editor and its next-execution preview were not available, so confirm how the exact job UI translates an expression and which timezone/offset it uses before any future change.

## All-phase stored-decision replay

The replay used the 1,235 complete 102-symbol batches above. For each minute-of-hour phase, it generated the proposed cron ticks and mapped each tick to the nearest stored complete five-minute batch within three minutes. The resulting latest stored states were sampled for:

- BUY with confidence `>= 67`, matching the current paper-entry gate.
- Any SELL decision, because a SELL can close an open position without the BUY-entry confidence threshold.
- A signal episode was a contiguous sequence of complete five-minute batches for the same symbol and side. “Short” means one or two qualifying batches (roughly up to ten minutes at the observed baseline); it is a sampled duration, not a measured continuous signal lifetime.

This tests phase sensitivity across all seven seven-minute offsets and all ten ten-minute offsets. It is **not** a rerun of the AI engine at the alternative timestamps. It does not recompute indicators from as-of candles, resimulate fills, or replay portfolio state, cooldowns, position limits, and executor rejections.

| Cadence / phases | BUY episodes captured / 90 | Short BUY episodes captured / 29 | SELL episodes captured / 578 | Short SELL episodes captured / 165 |
|---|---:|---:|---:|---:|
| 5-minute observed baseline | 90 / 90 | 29 / 29 | 578 / 578 | 165 / 165 |
| 7-minute, all 7 offsets | 71–83 / 90 | 10–22 / 29 | 478–516 / 578 | 65–103 / 165 |
| 10-minute, all 10 offsets | 65–82 / 90 | 4–21 / 29 | 436–536 / 578 | 23–123 / 165 |

For the literal `*/7` phase (offset 0), the replay captured 72/90 BUY episodes, 11/29 short BUY episodes, 478/578 SELL episodes, and 65/165 short SELL episodes. For literal `*/10` (offset 0), it captured 66/90 BUY episodes, 5/29 short BUY episodes, 438/578 SELL episodes, and 25/165 short SELL episodes. SELL totals include signals for markets without open positions and are not counts of missed executable exits.

### Observed trades under each phase

Using each actual trade's linked decision and same-symbol/same-side signal:

- Every simulated phase sampled the one observed SELL episode; this is only one exit and cannot establish general exit safety.
- Each phase sampled the original qualifying episode for **4 or 5 of the 6 observed BUY entries**. No phase captured all six same-episode entries.
- If an original BUY episode was not sampled, a later same-symbol qualifying state could appear substantially later. In this replay, the first later qualifying sample was delayed by **58.6–92.6 minutes** across seven-minute phases and **57.6–96.6 minutes** across ten-minute phases. The ten-minute result is consistent with the earlier alternate-phase finding of about 95 minutes.

These are decision-sampling delays, not counterfactual trade execution results. A later BUY might be blocked by a changed portfolio, the five-position cap, cooldown, market state, or another risk control. Conversely, an apparent sampled signal might not pass all executor checks. The database does not retain per-decision rejection outcomes.

The replay summary retained phase-wide episode capture counts and the trade-specific later-sample delays above, but not a median time-to-first-sample for every captured episode. No such aggregate latency is inferred from capture counts.

## Workload estimates

The measured comparison baseline is 285 complete AI decision batches in the trailing 24 hours, with 102 decision writes per batch. For workload projection, one analysis run uses 156 AI-candle RPCs by the documented formula (`ceil(102 / 4) * 6 intervals`). The latest per-run candle count recorded in the same-day [market-universe investigation](./ACTIVE_MARKET_UNIVERSE_USAGE_INVESTIGATION.md) was 91,674 at 2026-11-05 12:46 UTC. Multiplying that sample by modeled run counts is an estimate, not a current daily byte or CPU measurement.

| Schedule model | Runs/day | Decision rows/day | AI-candle RPCs/day | Candle rows/day, projected | Change vs measured 5m baseline |
|---|---:|---:|---:|---:|---:|
| Observed 5m baseline | 285 | 29,070 | 44,460 | 26,127,090 | Baseline |
| `*/7` (offsets 0–3) | 216 | 22,032 | 33,696 | 19,801,584 | -24.2% |
| 7-step offsets 4–6 | 192 | 19,584 | 29,952 | 17,601,408 | -32.6% |
| `*/10` (all offsets) | 144 | 14,688 | 22,464 | 13,201,056 | -49.5% |

Paper Trading invocation counts would follow these run rates only if it is invoked once after each successful analysis run. The production paper-invocation count is not directly available; snapshot counts are not a substitute. The estimates keep the 102-market universe and all six candle intervals unchanged. They estimate request/row volume only. **No CPU, egress-byte, latency, or cost savings were directly measured**, and no such savings are claimed.

## Reconciliation and recommendation

- The 2026-11-04 [24-hour cadence audit](./AI_ANALYSIS_CADENCE_AUDIT.md) recommended ten minutes based on a stored-decision simulation. That historical recommendation did not change schedules and is not current approval.
- The 2026-11-04 [10-minute validation](./AI_ANALYSIS_10MIN_CADENCE_VALIDATION.md) returned **Verdict B: additional validation required**. Its 5.5-hour stored-decision replay found a possible 95-minute delay in an alternate phase and had no actual exits in its window.
- The [implementation plan](./AI_ANALYSIS_10MIN_IMPLEMENTATION_PLAN.md) is deferred and unapproved. Its prior “approved change” language has been corrected.
- The latest [active market-universe investigation](./ACTIVE_MARKET_UNIVERSE_USAGE_INVESTIGATION.md) and this read-only query both show approximately five-minute production decision spacing. Neither verified the current external AI/paper scheduler configuration.

**Retain the observed five-minute cadence. Do not roll out seven or ten minutes from these data.** Seven minutes is not supported merely because its nominal interval is below 15 minutes: the actual cron step has nonuniform hour-boundary gaps, the phase replay misses short episodes, and some phases delayed observed qualifying BUY samples by more than an hour. Ten minutes remains inconclusive, with the established alternate-phase delay and less freshness margin.

### Evidence needed to reconsider seven or ten minutes

Before any separate approval, complete at least a **14-consecutive-day** phase-complete shadow replay (two full weekly cycles) that:

1. Reruns the deterministic AI engine at the actual candidate timestamps for every seven-minute and ten-minute phase using only as-of stored candles and market snapshots; do not select an arbitrary favorable phase.
2. Replays the paper executor statefully, including the 15-minute freshness gate, entry threshold, open-position cap, cooldowns, and BUY/SELL handling, while recording eligible, executed, skipped, and stale outcomes.
3. Injects one- and two-cycle analysis failures, delayed analysis completion, delayed/failed paper calls, and hour-boundary cases; verifies that Paper Trading never runs before successful AI Analysis and that stale decisions fail closed.
4. Reports per-phase captured/missed short BUY and SELL episodes, time to first qualifying sample, effects on observed entries and exits, and completeness of every input series.

Fourteen days is a proposed minimum observation window, not a statistical guarantee. The current one closed trade is not enough to establish observed trading-outcome equivalence.

## Read-only methods and limitations

Successful read-only checks included:

```sql
SELECT current_database(), current_user, version(), now() AT TIME ZONE 'UTC';
```

Decision batches were grouped by exact `created_at` and retained only when `count(*) = 102` and `count(DISTINCT symbol) = 102`. Run gaps were calculated with `lag(created_at)`; trades were joined to their linked AI decision to calculate decision age; open positions and status were read directly; portfolio snapshot gaps were calculated with `lag(captured_at)`. Phase simulation used all minute-of-hour offsets (`p=0..6` for 7 and `p=0..9` for 10), then compared sampled qualifying states with contiguous observed signal episodes and linked trades.

Limitations:

- The retained common decision window is about 4.3 days, not a representative market-cycle study.
- Stored-decision sampling is a proxy for rerunning the engine. At a different analysis timestamp, candles, indicators, confidence, reasons, and decisions can differ.
- One- or two-batch episode lengths are sampled observations; continuous signal start/end times are unknown. A phase-wide median time-to-first-sample for every episode was not retained, so only the linked-trade delays above are reported.
- Only six entries, one exit, one closed position, and five open positions were observed. Actual performance and counterfactual risk-manager outcomes cannot be inferred.
- No durable paper-run invocation or per-decision rejection log was available. External AI/paper scheduler settings, phase, timezone, and ordering were not verified.
- The latest per-run candle count is a same-day report measurement, not a fresh response-byte measurement. Production CPU, egress, and cost attribution are unavailable here.
- The production `ENABLE_LIVE_TRADING` environment value was not queried. No production settings were changed; the project-required default remains false.
- No tests or builds were run; this was a read-only assessment and documentation deliverable.
