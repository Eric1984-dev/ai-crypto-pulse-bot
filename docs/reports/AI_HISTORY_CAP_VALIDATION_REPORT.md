# AI History Cap Validation Report

> **Superseded:** This earlier report used a SQL reconstruction for its 1,000-vs-150 comparison. It is not the final deployment evidence. See [FINAL_HISTORY_CAP_DEPLOYMENT_REPORT.md](./FINAL_HISTORY_CAP_DEPLOYMENT_REPORT.md), which replays the JavaScript engine and documents the historical-input limitations.

**Latest complete production decision batch:** 2026-11-03 20:41:19.874536 UTC  
**Markets:** 102  
**Scope:** Read-only replay against live Supabase data. No code, database, or production settings were changed.

## Executive result

For this 102-market run, the 150-candle scenario produced the **same decision for all 102 markets** as the 1,000-candle scenario. No market changed between `BUY`, `SELL`, `HOLD`, or `WAIT`.

Confidence differed by at most **0.01 points**; no market differed by more than 1 or 5 points. Market Strength differed by at most **0.01 points**. The small displayed strength differences occurred for `BCH-EUR`, `GRT-EUR`, `INJ-EUR`, `JASMY-EUR`, `MAGIC-EUR`, `MOVR-EUR`, and `XLM-EUR`.

The observed row count would fall from **385,844 to 91,665 candles per run**, a **76.24% reduction**.

**Conclusion:** This replay supports reducing the per-market, per-interval history cap to 150 without materially affecting the tested run's decisions, confidence, or Market Strength. It does not prove that every future market condition or decision near a threshold will be unaffected.

## Comparison

| Measure | Result |
|---|---:|
| Markets compared | 102 |
| Identical decisions (1,000 vs. 150) | 102 |
| Changed decisions | 0 |
| Confidence delta greater than 1 point | 0 |
| Confidence delta greater than 5 points | 0 |
| Maximum absolute confidence delta | 0.01 |
| Maximum absolute Market Strength delta | 0.01 |

The four markets with a displayed 0.01-point confidence difference were `GRT-EUR`, `MAGIC-EUR`, `MOVR-EUR`, and `XLM-EUR`. No market crossed a decision boundary.

## Candle row counts

The 1,000-candle counts below are recorded in the latest production decision batch. The 150-candle counts apply `min(recorded candle count, 150)` per market and interval.

| Interval | 1,000-cap rows | 150-cap rows | Reduction |
|---|---:|---:|---:|
| 1m | 86,865 | 15,300 | 82.39% |
| 5m | 80,474 | 15,300 | 80.99% |
| 15m | 66,809 | 15,300 | 77.10% |
| 1h | 52,656 | 15,300 | 70.94% |
| 4h | 52,050 | 15,300 | 70.61% |
| 1d | 46,990 | 15,165 | 67.73% |
| **Total** | **385,844** | **91,665** | **76.24%** |

All six intervals retained at least 26 candles per market in this run, so the cap did not remove a timeframe from analysis.

## Replay method and confidence limits

The replay used the latest stored decision batch's market snapshots and fresh-interval lists, and selected each market's newest candle rows at or before the batch timestamp. A read-only SQL calculation implemented the indicator, timeframe scoring, confidence, and decision formulas in [lib/ai-engine.mjs](../../lib/ai-engine.mjs) for both 1,000- and 150-candle inputs. The reconstructed 1,000-cap row counts matched the counts recorded in the decision batch for every market and interval.

As a baseline check, the 1,000-cap replay reproduced the stored `BUY`/`SELL`/`HOLD`/`WAIT` decision for **all 102 markets**. Its numerical outputs were not an exact match to the stored JavaScript results: maximum differences were **0.19 confidence points** and **0.49 Market Strength points**. This may reflect calculation/rounding differences between the SQL replay and JavaScript implementation; therefore, the 150-vs-1,000 numeric deltas should be treated as rounded replay estimates, not bit-for-bit engine output. The decision comparison itself matched the production batch.

The replay validates one production snapshot only. It does not cover other market regimes, longer time periods, markets with shorter future histories, or cases where a small score change may cross a confidence or Market Strength threshold.

## Recommendation

The evidence supports **150 candles as a candidate cap**: all decisions were unchanged, confidence differences were negligible, and modeled candle-row volume fell by about 76%. This is diagnosis only; do not treat it as approval or implementation of a production setting change. Before deployment, run the exact JavaScript engine over multiple historical batches and specifically review cases near decision thresholds.

No tests were run because no code changed.
