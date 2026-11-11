# Simplified Market Strength Analysis

**Data source:** live Supabase production AI decisions and candles  
**Analysis date:** 2026-11-09 UTC  
**Decision history:** 2026-11-01 05:57 through 2026-11-09 08:41 UTC  
**Evaluation window:** decisions from 2026-11-01 00:00 through 2026-11-08 08:00 UTC  
**Scope:** read-only. No application code, thresholds, production data, or deployment settings were changed.

## Executive findings

- The stored production model (A) ranked forward returns poorly in this sample: Spearman rho was **−0.1723 at 4h** and **−0.2189 at 24h**.
- The **1-day EMA-only model (B)** had the strongest score-to-return ranking at both horizons: **+0.0464 at 4h** and **+0.1235 at 24h**. It retained only 27 of 80 and 27 of 79 current BUY observations, respectively.
- Models B–E produced positive average returns among their hypothetical BUY signals, while A and the single-component ablations F–H had negative averages. The candidate signal sets were small (24–29 BUYs in the main 4-hour-bucket sample), so these results are exploratory, not evidence of a stable edge.
- No single ablation fixed the current model. Removing market context (G) improved rank correlation modestly but did not change its BUY set or BUY outcomes. Removing momentum (F) or MACD (H) also left BUY outcomes materially unchanged.
- RSI reduced the overall score-to-return correlation when added to EMA, but some RSI-containing models had slightly stronger selected-signal returns. Volume confirmation gave a small 4h benefit, but not a consistent 24h benefit.
- **Verdict:** this sample favors simplifying the score toward the 1-day EMA, with volume and RSI effects mixed. It does not establish one universally best model or justify a production change.

## Production data and sample

The live `AI_Crypto_Bot_AI_Decisions` table contained **235,518** rows at query time:

| Decision | Rows | First recorded | Latest recorded |
|---|---:|---|---|
| BUY | 3,745 | 2026-11-01 11:15 UTC | 2026-11-09 05:56 UTC |
| HOLD | 180,161 | 2026-11-01 06:15 UTC | 2026-11-09 08:41 UTC |
| SELL | 45,924 | 2026-11-01 11:15 UTC | 2026-11-09 08:41 UTC |
| WAIT | 5,688 | 2026-11-01 05:57 UTC | 2026-11-09 08:41 UTC |

For the primary comparison, the latest decision for each symbol in each UTC 4-hour bucket was selected. This reduces repeated observations from frequent analysis runs while retaining intraday variation. Of 4,369 sampled rows, the common complete-case evaluation contained:

| Forward horizon | Evaluated observations |
|---|---:|
| 4h | 3,685 |
| 24h | 3,705 |

The 24h cutoff leaves enough time for a future 1-hour candle to be observed. The 4h cohort is 20 observations smaller because a qualifying forward candle was unavailable for those rows.

## Model construction

Indicator transformations follow the production calculations in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs) and [`20261106120000_ai_analysis_database_mode.sql`](../../PostgreSQL/migrations/20261106120000_ai_analysis_database_mode.sql). The persisted `marketStrength` value is used directly for Model A. Candidate scores are offline reconstructions from stored indicator fields; most are rounded in production, so reconstructed results can differ slightly from a fresh full-precision replay.

The normalized production component scores are:

- **EMA trend:** clamp(`percentSpread × 50`, −100, 100).
- **RSI:** clamp(`(RSI14 − 50) × 2`, −100, 100).
- **Momentum:** clamp(`changePct × 20`, −100, 100).
- **MACD:** the production-scaled histogram feature.
- **Volume:** the production signed `volume.score`, derived from the volume ratio and the latest candle direction. A raw volume ratio has no direction by itself.

The simplified combinations retain the production relative weights for shared features and renormalize them: C uses 2/3 EMA and 1/3 RSI; D uses 2/3 EMA and 1/3 volume; E uses 1/2 EMA, 1/4 RSI, and 1/4 volume.

| Model | Offline score |
|---|---|
| A | Stored production Market Strength |
| B | 1d EMA trend score |
| C | 1d EMA + 1d RSI |
| D | 1d EMA + 1h production volume score |
| E | 1d EMA + 1d RSI + 1h production volume score |
| F | Current component model without Momentum; remaining feature weights renormalized |
| G | Current multi-timeframe component score without the 10% Market Context blend |
| H | Current component model without MACD; remaining feature weights renormalized |

For score-ranking quality, rho is Spearman correlation between the signed model score and gross forward return across the common evaluation rows. For the long-entry metrics, a hypothetical BUY requires **model score ≥ 20** and the existing production **confidence ≥ 65**. Confidence is held fixed from the current model; no thresholds or confidence formula are redesigned. This rule reproduces Model A's actual BUY decisions in the sampled rows.

Forward return is the percentage change from the stored decision-time market price to the first 1-hour candle close at or after the 4h or 24h target, allowing at most one extra hour. Returns are unweighted and gross of fees and slippage.

## Predictive quality and long-entry results

### 4-hour horizon

| Rank by rho | Model | Spearman rho | BUY signals | Win rate | Profit factor | Mean signal return | Signal vs. no-signal return gap |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | B | **+0.0464** | 29 | 37.93% | 1.103 | +0.1090% | +0.2277 pp |
| 2 | D | +0.0398 | 28 | **39.29%** | **1.201** | +0.2027% | +0.3220 pp |
| 3 | E | −0.0012 | 26 | 38.46% | 1.199 | **+0.2110%** | **+0.3302 pp** |
| 4 | C | −0.0101 | 27 | 37.04% | 1.099 | +0.1101% | +0.2286 pp |
| 5 | G | −0.1493 | 80 | 35.00% | 0.488 | −0.9470% | −0.8485 pp |
| 6 | H | −0.1666 | 80 | 35.00% | 0.488 | −0.9470% | −0.8485 pp |
| 7 | F | −0.1682 | 75 | 36.00% | 0.492 | −0.9700% | −0.8709 pp |
| 8 | A | −0.1723 | 80 | 35.00% | 0.488 | −0.9470% | −0.8485 pp |

### 24-hour horizon

| Rank by rho | Model | Spearman rho | BUY signals | Win rate | Profit factor | Mean signal return | Signal vs. no-signal return gap |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | B | **+0.1235** | 29 | 51.72% | 1.799 | +1.6374% | +2.6031 pp |
| 2 | D | +0.1103 | 28 | 50.00% | 1.793 | +1.6845% | +2.6499 pp |
| 3 | E | +0.0609 | 26 | 53.85% | 2.310 | **+2.3259%** | **+3.2944 pp** |
| 4 | C | +0.0454 | 27 | **55.56%** | **2.317** | +2.2515% | +3.2203 pp |
| 5 | G | −0.1960 | 79 | 29.11% | 0.288 | −3.1865% | −2.2900 pp |
| 6 | H | −0.2109 | 79 | 29.11% | 0.288 | −3.1865% | −2.2900 pp |
| 7 | F | −0.2170 | 73 | 28.77% | 0.302 | −3.1394% | −2.2381 pp |
| 8 | A | −0.2189 | 79 | 29.11% | 0.288 | −3.1865% | −2.2900 pp |

The gap is the mean return of model-selected BUYs minus the mean return of all other evaluated rows. Profit factor is the sum of positive returns divided by the absolute sum of negative returns among the selected BUYs.

## Trade-count impact versus current BUY decisions

Counts below are from the same complete-case sample. “Added” means the candidate score passed the common score and confidence gates on a row where the stored production decision was not BUY.

| Model | 4h BUY signals | 4h current BUYs retained / removed / added | 24h BUY signals | 24h current BUYs retained / removed / added |
|---|---:|---:|---:|---:|
| A | 80 | 80 / 0 / 0 | 79 | 79 / 0 / 0 |
| B | 29 | 27 / 53 / 2 | 29 | 27 / 52 / 2 |
| C | 27 | 25 / 55 / 2 | 27 | 25 / 54 / 2 |
| D | 28 | 26 / 54 / 2 | 28 | 26 / 53 / 2 |
| E | 26 | 24 / 56 / 2 | 26 | 24 / 55 / 2 |
| F | 75 | 75 / 5 / 0 | 73 | 73 / 6 / 0 |
| G | 80 | 80 / 0 / 0 | 79 | 79 / 0 / 0 |
| H | 80 | 80 / 0 / 0 | 79 | 79 / 0 / 0 |

Models B–E improve selected-entry returns in this sample while removing about two-thirds of current BUY observations. Their better per-entry results do not demonstrate higher total portfolio profit: the simulations do not apply position sizing, portfolio limits, cooldowns, fees, slippage, or trade overlap.

## 24-hour non-overlapping sensitivity

To reduce overlap between forward-return windows, a second sample selected the latest decision per symbol per UTC day. This produced **694 complete observations**, with only 3–11 hypothetical BUYs per model.

| Model | BUY signals | Win rate | Profit factor | Mean signal return | Signal vs. no-signal gap |
|---|---:|---:|---:|---:|---:|
| A | 11 | 18.18% | 0.326 | −3.3418% | −2.0441 pp |
| B | 4 | 25.00% | 1.047 | +0.1463% | +1.4849 pp |
| C | 3 | 33.33% | 1.903 | +2.0574% | +3.4022 pp |
| D | 4 | 25.00% | 1.047 | +0.1463% | +1.4849 pp |
| E | 3 | 33.33% | 1.903 | +2.0574% | +3.4022 pp |
| F | 10 | 20.00% | 0.360 | −3.1645% | −1.8613 pp |
| G | 11 | 18.18% | 0.326 | −3.3418% | −2.0441 pp |
| H | 11 | 18.18% | 0.326 | −3.3418% | −2.0441 pp |

This directionally supports the main comparison, but the 3- and 4-signal candidate results are too small to rank reliably.

## Interpretation by component

### 1-day EMA

EMA-only (B) was the strongest ranker at both horizons and had positive signal returns. It removed 52–53 current BUY observations in the primary sample while adding two non-BUY rows. This is the clearest simplification signal in these data, but the selected sample is small and the 24h rank correlation remains modest.

### RSI

Adding RSI reduced score-ranking quality relative to B at both horizons: rho fell from **+0.0464 to −0.0101 at 4h** and from **+0.1235 to +0.0454 at 24h**. Selected-entry win rate and profit factor were slightly better for C than B at 24h, but not at 4h. RSI therefore looks mixed: weaker as a broad ranker, potentially useful in a narrow high-score subset, and not consistently validated.

### 1-hour volume confirmation

D ranked slightly below B at both horizons. It had better 4h selected-signal win rate and profit factor than B, while at 24h B and D were similar and B ranked higher. The daily non-overlap check produced identical B and D signal results. The production signed volume score is not equivalent to treating a high raw volume ratio as bullish; its sign depends on the latest candle direction.

### Momentum, Market Context, and MACD

- **Momentum removal (F):** rho improved only slightly relative to A, while selected-signal outcomes remained poor and a few current BUYs were removed.
- **Market Context removal (G):** rho improved by about **0.023** at both horizons, but the selected BUY set and its outcomes were unchanged.
- **MACD removal (H):** rho improved by about **0.006 at 4h** and **0.008 at 24h**, with no change in the selected BUY set or outcomes.

These are small one-at-a-time effects. In particular, they do not explain why current BUYs underperformed in this period; removing any one feature did not materially improve their forward outcomes.

## Rankings and verdict

**By score-to-return predictive quality (Spearman rho):**

- **4h:** B > D > E > C > G > H > F > A.
- **24h:** B > D > E > C > G > H > F > A.

**By selected long-entry metrics, results are horizon-dependent:**

- At **4h**, D had the highest win rate and profit factor; E had the highest mean signal return and return separation.
- At **24h**, C had the highest win rate and profit factor by a narrow margin; E had the highest mean signal return and return separation.
- A, F, G, and H had negative selected-signal mean returns and profit factors below 1 at both horizons.

**Final assessment:** simplified EMA-centered variants outperformed the current composite on this historical sample. B is the best broad ranker; C–E produce the strongest selected-entry return separation, but with fewer trades and very small effective sample sizes. The evidence supports further walk-forward validation of simplified candidates, not an immediate production change.

## Limitations

- The 4-hour-bucket sample reduces high-frequency duplicates but its 24-hour forward windows still overlap. The daily sensitivity sample reduces overlap but has very few selected trades.
- The decision history spans roughly eight days and one market regime. The results should not be generalized to other regimes.
- Scores B–H are offline reconstructions from stored, rounded indicators. Model A uses the stored production Market Strength value directly.
- The current confidence value is retained as a shared gate for all models; candidate confidence is not independently recomputed.
- Returns are mark-to-market, long-only, unweighted, and gross. Fees, slippage, spreads, portfolio exposure, position limits, cooldowns, execution timing, and trade interactions are not modeled.
- These observational comparisons do not establish causality or statistical significance. Small candidate trade counts make win rate and profit factor especially unstable.

No code, thresholds, production records, or deployment configuration were changed. No tests were run; this was a read-only production-data analysis and report.
