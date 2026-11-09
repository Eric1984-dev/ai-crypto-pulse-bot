# Market Strength Component Analysis

**Data source:** live Supabase production AI decisions and candles  
**Analysis date:** 2026-11-09 UTC; latest BUY decision observed at 2026-11-09 05:56 UTC  
**Scope:** read-only investigation. No code, thresholds, database contents, or deployments were changed.

## Executive findings

- **1-day EMA trend is the clearest BUY-quality signal.** Its weighted contribution correlated with net 24-hour return at Spearman **+0.403** across repeated BUY decisions and **+0.379** after reducing repetition to the latest BUY per symbol per 4-hour bucket.
- **RSI adds modest 24-hour information**, but its 4-hour association is weak and does not persist in the de-duplicated sample.
- **Volume is interval- and representation-dependent.** The 1-hour volume ratio is positively associated with 24-hour returns, while the combined volume contribution across all intervals is negatively associated in the repeated-row sample. Ratio buckets are non-monotonic, and all buckets have negative mean net returns.
- **MACD is horizon-dependent and precision-limited.** It is positively associated with 4-hour returns, negatively associated with 24-hour returns, and its stored histogram is zero for 64–84% of BUY interval records. The engine rounds the histogram to two decimal places before using it in the score.
- **Momentum contributes little useful ranking information** at 24 hours and is negatively associated with 4-hour outcomes.
- **Volatility is not part of Market Strength.** It is a separate confidence penalty. Its relationship with outcomes changes by horizon and sample; the daily volatility level is “high” for every observed BUY.
- In fixed-BUY-cohort weighting experiments, shifting weight from daily MACD to daily EMA and from 1-hour MACD to a ratio-only volume score improved 24-hour Market Strength rank correlation from **+0.104 to +0.201** on repeated rows and **+0.012 to +0.099** in the de-duplicated sample. This is evidence for further paper-only validation, not an estimate of realized profit or a production recommendation.

## 1. Engine scoring and method

The AI Engine weights six intervals: 1m 0.05, 5m 0.10, 15m 0.15, 1h 0.25, 4h 0.30, and 1d 0.15. Within each valid interval, the feature weights are EMA trend 0.30, momentum 0.25, RSI 0.15, MACD 0.15, and volume 0.15. Available feature weights and valid interval weights are normalized before aggregation. Market Strength then combines 90% timeframe score with 10% market context. See [the feature scoring and aggregation code](../../lib/ai-engine.mjs#L351-L461) and [timeframe weights](../../lib/ai-engine.mjs#L47-L54).

The source calculations are:

| Component | Engine input/score |
|---|---|
| EMA trend | `clamp((EMA12 - EMA26) / EMA26 * 5000, -100, 100)` |
| RSI | `clamp((RSI14 - 50) * 2, -100, 100)` |
| MACD | `clamp(histogram / latest close * 20000, -100, 100)` |
| Momentum | `clamp(changePct * 20, -100, 100)` |
| Volume | Ratio- and last-candle-direction-dependent score |
| Volatility | Not a Market Strength component; a separate per-interval confidence penalty of 0, 4, or 12 points for low, medium, or high volatility |

Component scores were reconstructed from stored decision indicators using the engine's formula and the historical valid-interval list. MACD normalization used the latest stored close at or before the decision when available, falling back to stored EMA26. Stored indicators are rounded, so the component reconstruction is approximate.

For forward labels, the first 15-minute close at or after a decision within 30 minutes was used as the entry reference. The 4-hour and 24-hour target closes were allowed a 30-minute tolerance. Returns include 0.25% fees and 0.10% adverse slippage on each side. A positive net return is counted as a win.

The full sample includes repeated, overlapping BUY decisions. The reduced sample keeps the latest BUY per symbol per 4-hour bucket; it is still clustered by market and regime. Component attribution is rank association, not causal inference.

## 2. Production outcome context

The live database contained 3,745 BUY decisions in this analysis window.

| Sample | 4h observations | 4h win rate | Mean 4h net return | 24h observations | 24h win rate | Mean 24h net return |
|---|---:|---:|---:|---:|---:|---:|
| All BUY decisions | 3,283 | 25.5% | -1.164% | 3,087 | 27.2% | -3.183% |
| Latest per symbol/4h bucket | 145 | 22.8% | -1.409% | 133 | 23.3% | -3.683% |

These are decision-level counterfactual returns, not executed-trade P&L. Every population's mean is negative after modeled costs; a better ranking correlation does not imply positive expectancy.

## 3. Standalone component attribution

Spearman correlations below compare each component's weighted Market Strength contribution with forward net return. “All” includes repeated BUY rows; “Reduced” is the latest BUY per symbol/4-hour bucket. Larger positive values indicate that stronger component contributions tended to rank better returns; negative values indicate an inverse association.

| Component / input | 4h rho: All / Reduced | 24h rho: All / Reduced | Assessment |
|---|---:|---:|---|
| EMA, all intervals | -0.004 / -0.041 | +0.288 / +0.142 | Positive 24h association; the aggregate obscures a particularly strong daily contribution |
| **EMA, 1d contribution** | **+0.107 / +0.118** | **+0.403 / +0.379** | Strongest and most consistent component result |
| RSI, all intervals | +0.060 / -0.041 | +0.231 / +0.146 | Modest positive 24h signal; weak at 4h |
| MACD, all intervals | +0.100 / +0.106 | -0.234 / -0.093 | Horizon conflict: positive at 4h, inverse at 24h |
| Momentum, all intervals | -0.104 / -0.111 | +0.034 / -0.028 | No meaningful 24h association; inverse short-horizon association |
| Volume score, all intervals | -0.051 / -0.052 | -0.144 / -0.020 | Aggregate volume signal is weak or inverse, especially before reducing repeated rows |
| Volume contribution, 1h only | +0.032 / +0.053 | +0.111 / +0.202 | Modest positive 24h association; de-duplicated sample is small |
| Raw 1h volume ratio | -0.051 / +0.066 | +0.187 / +0.343 | Positive 24h association, but non-monotonic buckets and only 133 reduced observations |
| Volatility penalty | -0.110 / -0.177 | +0.124 / -0.024 | Unstable by horizon and sample; not a Market Strength input |

### Average contribution in profitable versus losing decisions

The following are mean component values for 24-hour winners (`net return > 0`) and non-winners (`<= 0`). Numbers are in the component's own units; compare winner/loss differences within a row, not absolute magnitudes across different components.

| Component | All rows: winners / non-winners | Reduced: winners / non-winners |
|---|---:|---:|
| EMA, all intervals | +14.514 / +11.023 | +12.070 / +9.234 |
| EMA, 1d contribution | +0.852 / -1.288 | -0.262 / -1.930 |
| RSI, all intervals | +4.043 / +3.626 | +3.668 / +3.494 |
| MACD, all intervals | +1.329 / +2.333 | +2.003 / +2.308 |
| Momentum, all intervals | +11.466 / +11.598 | +10.967 / +11.207 |
| Volume, all intervals | +0.384 / +0.817 | +0.625 / +0.953 |
| Volume, 1h contribution | +0.272 / +0.282 | +0.362 / +0.273 |
| Volatility penalty | 6.309 / 5.865 | 6.108 / 5.869 |

The daily EMA gap is notably separated between 24-hour winners and non-winners. RSI has a smaller separation. Stronger aggregate MACD and volume contributions occurred more often in non-winning BUY rows. The 1-hour volume contribution has little winner/loss separation in the repeated rows and a modestly favorable separation in the reduced sample.

## 4. Volume confirmation

The engine's volume score combines ratio with the most recent candle's price direction: at ratio `<= 0.5`, it returns `-sign(lastChange) * 10`; at ratio `>= 1.5`, it multiplies the ratio score by `sign(lastChange)`. Thus, low-volume falling candles receive a **positive +10** score. In the 3,745 BUY records, 1,978 1-hour ratios were `<= 0.5`; 930 of those had a positive volume score and 1,031 a negative score. The remaining 17 were neutral, consistent with no last-candle change. The score therefore does not mean “volume confirmation” by itself. See [the volume scoring implementation](../../lib/ai-engine.mjs#L680-L705).

The raw 1-hour volume ratio had a positive 24-hour rank association, but results by ratio bucket were not monotonic:

| 1h ratio | All rows: n / 24h win rate / mean net return | Reduced: n / 24h win rate / mean net return |
|---|---:|---:|
| `<0.10` | 1,208 / 18.8% / -4.352% | 46 / 15.2% / -6.072% |
| `0.10–<0.50` | 543 / 36.5% / -2.852% | 31 / 25.8% / -3.489% |
| `0.50–1.00` | 234 / 26.5% / -2.862% | 11 / 27.3% / -1.252% |
| `>1.00` | 1,102 / 32.0% / -2.134% | 45 / 28.9% / -1.970% |

All buckets had negative average net returns. The lowest ratio bucket performed worst, and `>1.00` performed better than `<0.10` on mean return, but the highest win rate was in the `0.10–<0.50` bucket. The reduced `0.50–1.00` group has only 11 observations. Evidence supports testing ratio-aware confirmation, not adopting a single hard filter.

## 5. MACD precision

`calculateMacd` rounds the line, signal, and histogram to two decimal places before the histogram is normalized into a feature score. This means sub-cent histogram differences can be lost before scoring. See [MACD calculation and rounding](../../lib/ai-engine.mjs#L635-L656).

Among BUY decisions, the stored histogram was exactly zero in:

| Interval | Zero histograms / 3,745 | Share |
|---|---:|---:|
| 1m | 3,153 | 84.2% |
| 5m | 3,006 | 80.3% |
| 15m | 2,709 | 72.3% |
| 1h | 2,638 | 70.4% |
| 4h | 2,401 | 64.1% |
| 1d | 2,404 | 64.2% |

This confirms substantial information loss is possible, particularly for low-priced assets. However, the production decision history stores the rounded histogram, not the pre-rounding value. A zero may also be a true zero. The available history therefore cannot quantify how much predictive value higher precision would recover. The MACD component's negative 24-hour correlation may reflect the signal itself, rounding, market regime, or a combination; it should not be attributed to precision alone.

## 6. Volatility's separate role

Volatility affects confidence, not Market Strength. The engine assigns a penalty of 12 for high, 4 for medium, and 0 for low volatility and averages that penalty across valid intervals. In the BUY population, 1d volatility was high in all 3,745 records; 4h was high in 3,327; 1h was medium in 2,959 and high in 780.

The penalty correlated negatively with 4-hour returns in both samples, but its 24-hour association was positive only in repeated rows and nearly zero after reducing repetition. This does not support changing or removing the risk penalty based on the present evidence. Its risk-control role should be evaluated separately from Market Strength predictive ranking.

## 7. Weighting sensitivity and estimated impact

The following fixed-cohort experiments changed only component weights in reconstructed Market Strength; historical BUY membership, thresholds, and trades were held unchanged:

- **Daily EMA scenario:** transfer 0.10 weight in the 1d timeframe from MACD (`0.15 → 0.05`) to EMA (`0.30 → 0.40`).
- **1h signed-volume scenario:** transfer 0.10 in the 1h timeframe from MACD (`0.15 → 0.05`) to the existing signed volume score (`0.15 → 0.25`).
- **1h ratio scenario:** replace the signed 1h volume score with the ratio-only mapping described above and set its weight to 0.25, transferring 0.10 from 1h MACD.
- **Combined scenario:** apply the daily EMA and 1h ratio scenarios together.

| Market Strength score | 4h rho: All / Reduced | 24h rho: All / Reduced | Change in 24h rho vs current |
|---|---:|---:|---:|
| Current weights | -0.060 / -0.090 | +0.104 / +0.012 | — |
| 1d EMA 0.40, MACD 0.05 | -0.042 / -0.071 | +0.165 / +0.048 | +0.062 / +0.035 |
| 1h signed volume 0.25, MACD 0.05 | -0.066 / -0.088 | +0.129 / +0.036 | +0.025 / +0.023 |
| 1h ratio-only, current volume weight | -0.064 / -0.088 | +0.113 / +0.021 | +0.009 / +0.008 |
| 1h ratio-only 0.25, MACD 0.05 | -0.072 / -0.080 | +0.144 / +0.054 | +0.040 / +0.042 |
| **Combined 1d EMA + 1h ratio-only 0.25** | **-0.055 / -0.053** | **+0.201 / +0.099** | **+0.097 / +0.087** |

**Estimated impact is limited to ranking association:** the combined scenario raises 24-hour Spearman correlation by about 0.10 on repeated rows and 0.09 in the reduced sample, with little-to-moderate change in the 4-hour ranking. This does not estimate additional profitable trades, win-rate changes after the BUY gate, or portfolio P&L. All BUY outcomes remain the same negative-return sample because the historical decisions were held fixed.

## 8. Component ranking and recommendations

Ranked primarily by 24-hour association and stability in the reduced sample:

1. **EMA — strongest evidence.** The 1d contribution is the most consistent standalone predictor. Test a modest transfer from 1d MACD to 1d EMA (`0.30/0.15` to `0.40/0.05`) in a chronological paper-only replay.
2. **RSI — modest positive signal.** Its 24-hour association persists after reducing repeated decisions, but short-horizon behavior is weak. Keep its weight unchanged until a time-separated replay validates an alternative.
3. **Volume — promising only when represented carefully.** The 1h ratio outperforms the aggregate signed volume score at 24 hours, but the ratio buckets are non-monotonic and all have negative average returns. Test ratio and price-direction confirmation as separate inputs; do not simply increase the current signed volume score.
4. **MACD — horizon-specific and precision-limited.** It is positively associated at 4h but inversely associated at 24h. Do not remove it globally based on one horizon. Preserve higher internal precision in a future controlled test and compare the unrounded score before reducing its weight.
5. **Volatility — not a Market Strength component and unstable as a predictor.** Keep its risk/confidence role separate; do not use this analysis to weaken risk controls.
6. **Momentum — weakest evidence.** Its 24-hour rank association is near zero, and it is inversely associated at 4h. Do not increase its weight; test any reduction only in a horizon-specific replay.

The strongest candidate is a **paper-only validation of the combined daily-EMA / ratio-aware 1h scenario**. The weight figures above are the tested sensitivity, not approved production settings. Before adoption, use a chronological holdout, retain transaction costs, calculate win rate and drawdown, and replay the unchanged risk manager, cooldown, position limits, and decision thresholds.

## Limitations

- This is a fixed historical BUY cohort; it does not simulate how new weights would change BUY/HOLD/WAIT decisions or paper-trade execution.
- Repeated decisions overlap in time. De-duplication reduces repetition but leaves only 133 24-hour outcomes.
- Rank correlations have no confidence intervals or significance tests and are vulnerable to regime clustering and multiple comparisons.
- The stored MACD histogram is already rounded. Its historical pre-rounding value is unavailable, so the benefit of a precision fix is not numerically estimated.
- Components are correlated with each other, and observed association is not causal attribution.
- The modeled forward outcomes use candles, fees, and slippage; they are not realized trade outcomes. No production tests, builds, or deployments were run.

**Change status:** report only. No code, thresholds, database records, or deployment settings were modified.
