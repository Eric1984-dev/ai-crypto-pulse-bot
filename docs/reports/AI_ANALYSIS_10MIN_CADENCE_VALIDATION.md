# AI Analysis 10-Minute Cadence Validation

**Audit window:** 2026-11-04 08:56:02–14:26:19 UTC  
**Capture cutoff:** 2026-11-04 14:26:20 UTC  
**Scope:** Read-only replay of post-fix production decisions. No code, database, scheduler, or deployment settings were changed.

## Executive summary

**Verdict: B. Additional validation required.**

The wall-clock-aligned 10-minute sample retained all three BUY entries executed in the audit window and produced nearly the same decision mix as the observed 5-minute runs. It had 13 decision-state differences among 3,366 sampled market decisions (0.386%). However, the alternate 10-minute phase missed one short BUY and one short SELL episode; more importantly, it would have delayed one of the three observed BUY opportunities by about 95 minutes before a sampled decision reached the current entry threshold.

The replay covers only about 5.5 hours, and it samples stored 5-minute decisions rather than rerunning the AI engine or paper-trading executor. It therefore does not establish how a 10-minute schedule behaves across a representative range of market conditions, scheduler failures, or external-job timing.

Steady-state invocation volume would fall from 288 to 144 runs per day, approximately 50%. The replay's aligned sample used 50.8% fewer persisted analyzed-candle inputs. These are workload proxies, not measured Vercel Active CPU savings. Current absolute Active CPU telemetry was unavailable.

## Scope and method

The window begins at **08:56:02 UTC**, the post-fix boundary used by the Post-Fix Trade Generation Audit, and ends with the last complete 102-market run at **14:26:19 UTC**. The production query included **67 complete runs**, or **6,834 stored decisions**. Observed run spacing averaged about five minutes.

Two 10-minute phases were simulated by retaining every other actual 5-minute run:

- **Wall-clock-aligned phase:** 33 runs / 3,366 decisions; the phase corresponding to the expected `*/10` alignment given the observed run timestamps.
- **Alternate phase:** 34 runs / 3,468 decisions; the opposite phase, included because schedule alignment affects which short-lived signals are sampled.

This is a stored-decision sampling replay. It does not recompute indicators from historical candles at a changed analysis time, nor does it fully replay executor decisions, fills, cooldowns, or portfolio state. The cadence validation in [AI_ANALYSIS_CADENCE_AUDIT.md](./AI_ANALYSIS_CADENCE_AUDIT.md) covers an earlier 24-hour window and is not used as the production sample here.

## 1. Decision profile

| Decision | Observed 5-minute runs | Share | Aligned 10-minute phase | Share | Alternate 10-minute phase |
|---|---:|---:|---:|---:|---:|
| BUY | 119 | 1.741% | 58 | 1.723% | 61 |
| SELL | 167 | 2.444% | 84 | 2.496% | 83 |
| HOLD | 6,548 | 95.815% | 3,224 | 95.781% | 3,324 |
| WAIT | 0 | 0.000% | 0 | 0.000% | 0 |
| **Total** | **6,834** | **100%** | **3,366** | **100%** | **3,468** |

Decision mix was stable across the observed and aligned samples. The average BUY confidence / Market Strength was **66.335 / 31.679** for 5-minute runs and **66.417 / 31.981** for the aligned 10-minute phase. Corresponding SELL averages were **67.551 / -34.539** and **67.515 / -34.379**.

The absence of WAIT decisions does not mean all inputs were fresh: **1,353 of 6,834 rows** recorded at least one stale interval. None recorded fewer than two fresh intervals, so this sample did not trigger the stale-data WAIT condition.

## 2. Decision changes and signal episodes

For the aligned phase, comparing each selected 10-minute decision set with the intervening 5-minute set found:

| Measure | Result |
|---|---:|
| Comparisons | 3,366 |
| Different decision states | 13 (0.386%) |
| Mean absolute confidence difference | 0.344 |
| Maximum absolute confidence difference | 6.61 |
| Mean absolute Market Strength difference | 0.460 |
| Maximum absolute Market Strength difference | 6.67 |

Across the observed interior of the window, all **8 BUY and 8 SELL signal episodes** were captured by the aligned phase. Two episodes of each direction were first sampled about five minutes after they began.

The alternate phase missed one short **CAP-EUR BUY** episode (confidence 65.77) and one short **ENSO-EUR SELL** episode (confidence 65.14). The BUY was below the current 67 paper-entry threshold; the SELL was not an executable exit without an open position in that market. The alternate phase also delayed five BUY and five SELL episodes by about five minutes.

## 3. Observed paper trades and entry/exit implications

Three BUY trades were executed at **11:03:10 UTC**, linked to decisions from the **11:01:23 UTC** run (run 26). The wall-clock-aligned 10-minute phase includes that run, so the sampled phase retains all three actual entry decisions.

In the alternate phase, MEGA-EUR and POL-EUR BUYs appeared in the next sampled run. ARX-EUR was below the 67 entry threshold in that sample and did not reach a sampled BUY at or above 67 until **12:36:26 UTC**, approximately **95 minutes** after the actual entry decision. This demonstrates that a favorable result in one phase does not establish phase-independent entry timing.

There were no SELL trades in the window and no observed SELL decisions for positions after their entry. Consequently, the data cannot quantify actual exit delays or their portfolio impact.

## 4. Workload and CPU impact

| Measure | Observed 5-minute runs | Aligned 10-minute sample | Estimated change |
|---|---:|---:|---:|
| Runs in audit window | 67 | 33 | 50.75% fewer |
| Decision rows | 6,834 | 3,366 | 50.75% fewer |
| Persisted analyzed-candle inputs | 23,203,480 | 11,415,489 | 50.80% fewer |
| Steady-state runs/day | 288 | 144 | 50% fewer |

The persisted analyzed-candle-input total reflects the history-depth profile recorded during this window and should not be treated as a direct count of REST rows read or as a current per-run cost measurement. The latest complete batch recorded approximately **87,021 analyzed-candle inputs** across 102 markets. If that latest batch is representative, a simple steady-state projection is about **25.06 million** inputs/day at 5-minute cadence versus **12.53 million** at 10 minutes. This extrapolation is workload context only.

No current per-endpoint Active CPU measurement was available for this audit. If per-run AI Analysis cost remains similar, halving run count would approximately halve AI Analysis's cadence-driven CPU contribution. Total application CPU would fall by less than 50% because other endpoints and fixed overhead are unchanged. No absolute CPU or Fluid allocation savings can be verified from these data.

## 5. Freshness, reliability, and execution limitations

- The paper-trading decision-freshness gate is 15 minutes; market-snapshot freshness is also 15 minutes. The gate itself is unchanged by sampling stored decisions.
- A 10-minute analysis schedule normally leaves less margin than the current 5-minute schedule. A failed or delayed run can make the latest stored decision stale before the next successful analysis, depending on paper-trading cadence and scheduler offsets. The database gate should fail closed, but an executor skip or temporary pause in trading is possible.
- The production replay contains 67 complete runs, but it does not establish behavior during a prolonged scheduler outage or repeated failed runs.
- The analysis and paper-trading schedulers are external. The replay cannot verify their actual future phase, run ordering, or network/runtime delays.
- Stored decisions do not retain a durable per-decision executor rejection outcome. Trade links establish the three executed BUYs, but do not support a full counterfactual execution replay for every sampled BUY or SELL.

## Verdict

**B. Additional validation required.**

The aligned phase is promising: its decision mix closely matches the 5-minute sample, it preserves all three observed entry decisions, and it reduces run count by about half. The short observation period, alternate-phase delay of one observed entry, lack of actual exit events, and unmeasured Active CPU prevent a production-readiness conclusion.

Before any scheduler change, validate a representative 24–48-hour period across both 10-minute phases, confirm the intended external scheduler phase and analysis-to-paper execution offset, and monitor decision age, stale-decision skips, executed entries/exits, and per-endpoint Active CPU. No scheduler change is recommended or made by this report.

## Validation status

- Production decision and linked-trade data queried read-only.
- No code, database, scheduler, or deployment changes made.
- No tests or build run; this report does not claim implementation or deployment validation.
