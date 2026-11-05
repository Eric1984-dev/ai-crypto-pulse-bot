# AI Analysis Cadence Audit

**Date:** 2026-11-04
**Observation window:** 2026-11-03 07:31:14 → 2026-11-04 07:26:19 UTC (24h; 287 complete batches × 102 markets = 29,274 stored decisions)
**Scope:** Diagnosis only. No code, scheduler settings, or production data were changed.
**Data sources:** Live Supabase (`AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Portfolio_Snapshots`, `AI_Crypto_Bot_Status`), repository code ([lib/ai-engine.mjs](../../lib/ai-engine.mjs), [20261101154600_phase08_paper_trading.sql](../../supabase/migrations/20261101154600_phase08_paper_trading.sql)), and the 2026-11-03 scheduler/CPU reports.

> **Historical recommendation only (clarified 2026-11-05):** The 10-minute recommendation below reflects this report's 24-hour replay and is not current approval to change schedules. The subsequent 5.5-hour validation returned Verdict B (additional validation required), and the latest market-universe investigation observed roughly five-minute decision spacing and advised keeping cadence unchanged during a market-universe pilot. Ten-minute cadence is not active, approved, or deployed. See the [current cadence clarification](./AI_ANALYSIS_CADENCE_STATUS_CLARIFICATION_2026-11-05.md).

## Executive answer

**Yes. AI Analysis cadence can be reduced from 5 to 10 minutes without materially affecting trading behaviour — and 10 minutes is the recommended ceiling, not 15.**

- In the last 24 hours, **only 1 trade was actually executed** (BEAM-EUR SELL, 2026-11-04 01:48:12 UTC). Its SELL signal persisted for **20+ consecutive minutes** (01:46 → 02:06+), so it would have been generated and executed under both alternative cadences — delayed by at most ~10–15 minutes, with identical direction and size.
- Simulated decision-change rate: **0.245%** (10m) and **0.180%** (15m) of per-timestamp comparisons in normal operation; every change is a marginal crossing of the confidence-65 signal gate (average |Δconfidence| < 0.1 in normal operation), not a directional reversal.
- **15 minutes is not recommended** because it removes all slack against the paper-trading executor's **15-minute decision-freshness gate**: one skipped/failed analysis run would leave no fresh decision and silently suspend trading for a full cycle. 10 minutes retains one cycle of slack.
- Estimated savings at 10m: **−50%** AI-analysis invocations, candle-row reads, and decision writes; at 15m: **−66.7%**. AI Analysis is the highest work-per-invocation endpoint (~300k candle rows and ~0.8s pure decision CPU per run), so this directly relieves the Hobby Active CPU budget.

## 1. Does AI Analysis truly need to run every 5 minutes?

**No hard requirement exists at 5 minutes.** The findings:

- **Signals persist far longer than 5 minutes.** Directional episodes in the last 24h lasted tens of minutes: BEAM-EUR SELL persisted 20+ min; UNI-EUR BUY clusters persisted 10–30 min; BEAM/WIN BUY episodes on Nov 3 persisted for hours. A 5-minute sampling interval is far denser than the signal dynamics require.
- **The binding constraint is downstream, not analytical.** The paper-trading executor processes only the newest stored decision per market and rejects decisions older than **15 minutes** (freshness check in `AI_Crypto_Bot_Run_Paper_Trading`). Analysis cadence must stay comfortably below 15 minutes to tolerate a missed/failed run.
- **Freshness protection is unaffected.** The AI Engine's per-interval stale-candle limits (30 min for `1m`, up to 72h for `1d`) gate *input data*, not run frequency. Running analysis less often does not weaken those safeguards.
- 5 minutes is an operator choice documented in [SCHEDULING.md](../SCHEDULING.md) ("Scheduler cadence is an operator choice"), not an application invariant.

## 2–3. Simulation: 5m vs 10m vs 15m

**Method.** Stored decisions were aligned to fixed 10-minute (A) and 15-minute (B) slots; each slot's decision set is the **latest stored decision per symbol within that slot** — i.e., what paper trading would have seen had analysis run at that cadence. This is a decision-series simulation, not a full engine replay with shifted candle inputs; a true replay of candle-cadence sensitivity was already performed in [REFRESH_FREQUENCY_IMPACT_REPORT.md](./REFRESH_FREQUENCY_IMPACT_REPORT.md) and reproduced 21/21 decisions exactly under added input lag.

### Decision counts (24h)

| Decision | Current 5m | Alt A 10m | Alt B 15m |
|---|---:|---:|---:|
| HOLD | 24,696 | 12,395 | 8,242 |
| SELL | 3,855 | 1,920 | 1,285 |
| WAIT | 561 | 293 | 212 |
| BUY | 162 | 80 | 53 |

Counts scale ~1:1 with run frequency, as expected — the *mix* is unchanged.

### Confidence and Market Strength (averages per decision class)

| Decision | 5m conf / str | 10m conf / str | 15m conf / str |
|---|---|---|---|
| HOLD | 58.71 / −8.80 | 58.71 / −8.83 | 58.71 / −8.78 |
| SELL | 67.49 / −33.02 | 67.48 / −32.99 | 67.48 / −32.97 |
| WAIT | 32.82 / −40.85 | 32.80 / −40.82 | 32.84 / −40.88 |
| BUY | 66.60 / +37.34 | 66.59 / +37.29 | 66.60 / +37.36 |

Average confidence and Market Strength are **identical to within 0.05 points** across all three cadences.

### Per-timestamp decision changes

Each stored 5-minute decision was compared with the decision that the alternative cadence would have produced for the same symbol at that moment:

| Scenario | Comparisons | Changed decisions | Change rate | Avg |Δconf| | Max |Δconf| | Avg |Δstr| | Max |Δstr| |
|---|---:|---:|---:|---:|---:|---:|---:|
| A (10m) — full 24h | 29,274 | 273 | 0.933% | 0.278 | 42.44 | 0.418 | 58.83 |
| B (15m) — full 24h | 29,274 | 275 | 0.939% | 0.341 | 42.44 | 0.483 | 58.83 |
| A (10m) — normal operation* | 6,120 | 15 | **0.245%** | 0.043 | 2.43 | 0.115 | 5.10 |
| B (15m) — normal operation* | 6,120 | 11 | **0.180%** | 0.068 | 2.09 | 0.181 | 9.40 |

\* "Normal operation" excludes the 2026-11-03 12:36–13:16 UTC stale-candle incident, when 77 then 52 markets returned `WAIT/STALE_CANDLE_DATA` after a candle-refresh gap. All large deltas (max |Δconf| 42.44) are HOLD/SELL/BUY→WAIT transitions at that boundary — an artifact of the data outage, not of analysis cadence. Notably, at a lower cadence the WAIT state would have been *shorter-lived* (fewer runs during the outage).

### Nature of the changes (full 24h)

| Transition | A (10m) | B (15m) | Character |
|---|---:|---:|---|
| SELL → HOLD | 85 | 104 | Marginal: avg |Δconf| 1.5–1.6, hovering at the 65 gate |
| HOLD → SELL | 56 | 90 | Marginal: avg |Δconf| 1.8–1.9 |
| HOLD ↔ WAIT | 119 | 69 | Stale-candle incident artifact |
| SELL/BUY → WAIT | 10 | 10 | Stale-candle incident artifact |
| HOLD → BUY | 2 | 1 | Marginal (Δconf 0.4–0.7) |
| BUY → HOLD | 1 | 1 | Marginal (Δconf 0.14) |

No change is a directional reversal (BUY↔SELL). All BUY/SELL↔HOLD changes are borderline crossings of the confidence-65 signal gate within ±5 confidence points.

## 4. Would any actual trading decision have changed in the last 24 hours?

**No executed trade would have been prevented or altered in direction.** Exactly one trade executed in the window:

**BEAM-EUR SELL — executed 2026-11-04 01:48:12 UTC** (220,837.15 units, realized PnL −€246.71):

| Time (UTC) | 5m decision | 10m slot representative | 15m slot representative |
|---|---|---|---|
| 01:31–01:41 | HOLD (conf ≤64.8) | HOLD | HOLD |
| 01:46 | **SELL 65.76 / −34.45** | **SELL** (slot 01:40–01:50) | HOLD (slot 01:30–01:45) |
| 01:51 | SELL 65.59 | SELL | **SELL** (slot 01:45–02:00) |
| 01:56–02:06+ | SELL (66.1–67.2) | SELL | SELL |

- **At 10m:** the SELL is present in the 01:40–01:50 slot → paper trading executes on the same or next run, ≤ ~5 min later.
- **At 15m:** the SELL is present from the 01:45–02:00 slot → execution at ~01:51–02:00, i.e. **~3–12 min later** than actual.
- The signal **strengthened** over the period (−34.45 → −38.34), so the delay does not risk missing the exit; the execution price could differ marginally (paper fill = market price + 0.1% slippage at execution minute), but the trade itself is unchanged.

**All other BUY/SELL signals in the window never reached execution**, for reasons independent of cadence:

- BEAM-EUR and WIN-EUR BUYs (122 decisions, conf 66.3–68.0): blocked by the one-position-per-symbol rule — both positions were already open.
- UNI-EUR BUYs (37, conf 65.07–66.15) and INJ-EUR BUYs (3, conf 65.17–65.24): below the executor's 67 confidence gate; never submitted as executable entries.
- All SELLs for symbols without an open position: nothing to close.

## 5. Estimated resource reduction

Per verified production run ([AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md](./AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md), [VERCEL_CPU_ATTRIBUTION_REPORT.md](./VERCEL_CPU_ATTRIBUTION_REPORT.md)): 612 logical candle reads, **~300,849 candle rows** scanned, 102 decision rows inserted, ~9.6–11.5s wall runtime of which ~0.8s is synchronous decision-generation CPU (plus CPU for parsing ~300k JSON rows). Route-level Active CPU is not measurable on Hobby; estimates below state their assumptions.

| Measure | Current 5m (288 runs/day) | A 10m (144/day) | B 15m (96/day) |
|---|---:|---:|---:|
| Invocations/day | 288 | 144 (**−50%**) | 96 (**−66.7%**) |
| Candle rows read/day | ~86.6M | ~43.3M (−43.3M) | ~28.9M (−57.7M) |
| Decision rows written/day | 29,376 | 14,688 | 9,792 |
| Active CPU/day (est. 1.5–3s CPU/run) | ~432–864 CPU-s | ~216–432 CPU-s | ~144–288 CPU-s |
| Active CPU/month (30d, same est.) | **~3.6–7.2 CPU-hrs** | ~1.8–3.6 CPU-hrs | ~1.2–2.4 CPU-hrs |

**Key observation for the Hobby budget:** at the current 5-minute cadence, AI Analysis alone is estimated at **3.6–7.2 CPU-hours/month** — i.e., roughly **90–180% of the entire 4 CPU-hour Hobby Active CPU allowance**, before candle-refresh, market-refresh, paper-trading, and page traffic. Halving or third-ing this cost is the single largest AI-analysis-side lever available. (Estimates assume 1.5–3s active CPU per run; the exact figure requires Vercel route-level Function CPU Time, unavailable on Hobby.)

**Supabase read reduction:** −43.3M (A) or −57.7M (B) candle rows scanned per day, plus proportionally fewer PostgREST page requests and decision-insert batches. This also reduces pressure on the Disk IO budget discussed in [DISK_IO_ANALYSIS_REPORT.md](./DISK_IO_ANALYSIS_REPORT.md).

## Risks and constraints

1. **15-minute cadence has zero slack against the executor's 15-minute decision-freshness gate.** One skipped run (ANALYZING overlap, timeout, scheduler miss) means no fresh decision exists and paper trading silently skips until the next success. At 10 minutes, one skip still leaves a ~10-minute-old (fresh) decision. **This is the decisive argument for 10m over 15m.**
2. **Execution latency for fast-moving signals increases by up to one cadence step** (≤10 min at A, ≤15 min at B). In 24h of data, no signal appeared and disappeared within a single step; the shortest actionable episode (UNI-EUR BUY at 09:21) was transient but below the executor gate anyway, and its cluster re-appeared 25 minutes later.
3. **Paper trading is scheduled on the same cadence as analysis** (per SCHEDULING.md guidance). A cadence change would naturally apply to both, halving/third-ing paper-trading invocations as well; that coupling should be reviewed before any change.
4. The simulation assumes the slot's latest stored decision approximates what a lower-cadence run would have produced. Indicator inputs at slightly different minutes can differ marginally; the REFRESH_FREQUENCY_IMPACT engine replay showed such input shifts did not change any of 21 tested decisions.

## Verdict

**Can AI Analysis cadence be reduced without materially affecting trading behaviour? Yes.**

- **Recommended: 10 minutes.** Decision mix, confidence, and Market Strength are statistically identical; the decision-change rate in normal operation is 0.245% with only marginal threshold crossings; the only executed trade in 24h would still have executed; and one cycle of slack is preserved against the 15-minute decision-freshness gate. Estimated savings: −50% invocations, −43.3M candle-row reads/day, and roughly −1.8 to −3.6 CPU-hours/month of Active CPU.
- **15 minutes is analytically equivalent but operationally fragile** (zero freshness-gate slack) and is therefore not recommended despite the larger (−66.7%) resource saving.

This report is a diagnosis only. No code, scheduler, or configuration changes were made. Any cadence change should be applied together with the paper-trading schedule, documented in [SCHEDULING.md](../SCHEDULING.md), and followed by 24–48h of monitoring of decision batches, `AI_Crypto_Bot_Status.last_run`, and snapshot continuity.

## Sources and limitations

- Live Supabase queries executed 2026-11-04 07:30–08:45 UTC over the 24h decision window (29,274 rows, 287 batches, 102 symbols).
- Simulation method: latest-decision-per-symbol per 10m/15m slot; not a full engine replay.
- Active CPU figures are estimates with stated assumptions; Vercel Hobby does not expose route-level Function CPU Time (see [VERCEL_CPU_ATTRIBUTION_REPORT.md](./VERCEL_CPU_ATTRIBUTION_REPORT.md)).
- The 2026-11-03 12:36–13:16 UTC stale-candle incident was excluded from "normal operation" change rates and analyzed separately.
- No tests were run; this was a read-only diagnostic task.
