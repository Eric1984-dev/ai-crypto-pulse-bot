# Market Strength Signal Dilution Analysis

**Data source:** live Supabase production AI decisions and candles  
**Analysis date:** 2026-11-09 UTC  
**BUY decision window:** 2026-11-01 11:15 through 2026-11-09 05:56 UTC  
**Forward-candle cutoff:** 2026-11-09 09:00 UTC  
**Scope:** read-only. No application code, thresholds, production data, or deployment settings were changed.

## Executive findings

- **The current Market Strength score materially dilutes the 1-day EMA signal for 24-hour returns.** On all BUY rows, Spearman correlation with the 24-hour forward return is **+0.423** for 1-day EMA alone, **+0.317** for EMA across all timeframes, and only **+0.077** for current Market Strength. The latest-per-symbol/4-hour sample shows the same ordering: **+0.436**, **+0.235**, and **+0.037**.
- Adding **RSI** to the multi-timeframe EMA score makes a small improvement at 24 hours (+0.009 all rows; +0.005 de-duplicated), but little or no improvement at 4 hours.
- Adding **MACD** reduces the 24-hour association (−0.040 all rows; −0.006 de-duplicated) but improves the 4-hour association (+0.033; +0.055). Its usefulness is horizon-dependent and limited by production precision: the stored MACD histogram is zero for 64–84% of BUY observations in each interval.
- **Momentum is the clearest harmful indicator in the 24-hour nested comparison.** Adding it reduces 24-hour rank correlation by 0.068 all rows and 0.073 de-duplicated. The all-row 4-hour result also falls by 0.034.
- **Volume adds little stable predictive information.** Its marginal effect is small and changes sign between the repeated-row and de-duplicated samples.
- The final **10% market-context blend** is the largest measured source of dilution after the indicator stack: it reduces rank correlation by 0.124–0.133 at 24 hours and 0.062–0.068 at 4 hours.

These are historical, in-sample rankings within stored BUY decisions. They do not prove that changing weights would improve realized trading results.

## Production formulas and test design

The JavaScript engine computes these per-timeframe component scores and weights:

| Component | Production score | Weight |
|---|---|---:|
| EMA trend | `clamp((EMA12 - EMA26) / EMA26 * 5000, -100, 100)` | 0.30 |
| Momentum | `clamp(changePct * 20, -100, 100)` | 0.25 |
| RSI | `clamp((RSI14 - 50) * 2, -100, 100)` | 0.15 |
| MACD | `clamp(round(histogram) / latestClose * 20000, -100, 100)` | 0.15 |
| Volume | Existing direction-and-volume-ratio score | 0.15 |

Unavailable features are omitted and the remaining feature weights are normalized. Timeframe scores are then averaged using the engine's configured interval weights. When current market data is available, final Market Strength is a 90% timeframe score plus a 10% market-context score. The source definitions are in [lib/ai-engine.mjs](../../lib/ai-engine.mjs) and the corresponding database-analysis implementation in [20261106120000_ai_analysis_database_mode.sql](../../PostgreSQL/migrations/20261106120000_ai_analysis_database_mode.sql).

The nested comparisons use the existing component weights, renormalized after each added feature:

1. EMA only across the valid timeframes
2. EMA + RSI
3. EMA + RSI + MACD
4. EMA + RSI + MACD + Momentum
5. All five components, without the 10% market-context blend
6. The actual stored production Market Strength score

The separate **1-day EMA only** result isolates the strongest previously identified timeframe. EMA scores are reconstructed from the stored EMA spread; the other component scores are reconstructed from production decision indicators. The actual full Market Strength benchmark is read directly from the stored decision.

Forward returns start at the stored market snapshot price and use the first available 1-hour candle close at or after the 4-hour or 24-hour target, allowing up to one additional hour. Returns are gross mark-to-market returns, before fees and slippage.

To reduce repeated observations, the robustness sample keeps the latest BUY decision per symbol in each 4-hour UTC bucket. Quantile groups include tied scores, so group sizes can differ from exactly 25%.

## Sample and baseline outcomes

| Population | Horizon | Decisions with forward return | Positive return | Mean return | Median return |
|---|---:|---:|---:|---:|---:|
| All BUY rows | 4h | 3,599 | 37.3% | −0.661% | −0.618% |
| All BUY rows | 24h | 3,412 | 32.0% | −2.650% | −2.715% |
| Latest per symbol/4h bucket | 4h | 165 | 32.7% | −1.203% | −0.878% |
| Latest per symbol/4h bucket | 24h | 161 | 26.7% | −3.507% | −3.558% |

The full BUY cohort contains 3,745 decisions. Many decisions repeat for the same symbol; the de-duplicated sample is consequently much smaller. The 4-hour bucket filter reduces duplicate entries but does not make the 24-hour forward outcomes independent: adjacent buckets can still have overlapping return windows. The negative cohort averages also show that all component comparisons occurred in a broadly adverse period.

## Standalone indicator usefulness

Spearman rho measures how well each production-derived score ranks subsequent returns. Positive values indicate that higher bullish scores tended to precede higher returns; negative values indicate an inverse relationship.

| Standalone score | 24h rho: all / de-duplicated | 4h rho: all / de-duplicated | Assessment |
|---|---:|---:|---|
| 1-day EMA spread | **+0.423 / +0.436** | **+0.107 / +0.112** | Strongest and most consistent signal; stronger at 24h |
| EMA across all intervals | +0.317 / +0.235 | −0.018 / −0.031 | Useful at 24h, not at 4h; blending shorter intervals weakens the 1-day result |
| RSI | +0.219 / +0.153 | +0.043 / −0.001 | Moderate 24h association; nearly neutral at 4h |
| MACD | −0.241 / −0.117 | +0.087 / +0.120 | Inverse at 24h, modest positive association at 4h; precision and horizon are concerns |
| Momentum | −0.005 / −0.058 | −0.093 / −0.015 | No useful 24h ranking; inverse at 4h in all rows |
| Volume | −0.162 / −0.032 | −0.054 / −0.008 | Weak or inverse standalone relationship |
| Full current Market Strength | +0.077 / +0.037 | −0.096 / −0.045 | Weak at 24h and inverse at 4h |

## Nested contribution and signal-to-noise impact

Each delta compares a row with the immediately preceding component stack. A negative delta means that adding that component weakened the score/return rank association.

### 24-hour forward return

| Model | Rho: all BUY rows | Δ rho | Rho: 4h de-duplicated | Δ rho |
|---|---:|---:|---:|---:|
| 1-day EMA only | **+0.423** | — | **+0.436** | — |
| EMA only, all intervals | +0.317 | — | +0.235 | — |
| + RSI | +0.326 | +0.009 | +0.240 | +0.005 |
| + MACD | +0.286 | −0.040 | +0.234 | −0.006 |
| + Momentum | +0.218 | −0.068 | +0.161 | −0.073 |
| + Volume, no market context | +0.201 | −0.017 | +0.170 | +0.009 |
| Full current Market Strength | +0.077 | **−0.124** | +0.037 | **−0.133** |

### 4-hour forward return

| Model | Rho: all BUY rows | Δ rho | Rho: 4h de-duplicated | Δ rho |
|---|---:|---:|---:|---:|
| 1-day EMA only | **+0.107** | — | **+0.112** | — |
| EMA only, all intervals | −0.018 | — | −0.031 | — |
| + RSI | −0.019 | −0.001 | −0.049 | −0.019 |
| + MACD | +0.014 | +0.033 | +0.006 | +0.055 |
| + Momentum | −0.021 | −0.034 | +0.004 | −0.002 |
| + Volume, no market context | −0.028 | −0.007 | +0.017 | +0.012 |
| Full current Market Strength | −0.096 | **−0.068** | −0.045 | **−0.062** |

### Interpreting the additions

- **Timeframe mixing:** replacing the 1-day EMA-only score with EMA blended across all intervals reduces 24-hour rho by 0.106 on all rows and 0.202 on the de-duplicated sample. It changes 4-hour rho from +0.107/+0.112 to −0.018/−0.031. The shorter-timeframe EMA inputs appear to dilute the higher-timeframe signal for this cohort.
- **RSI:** slightly improves the 24-hour EMA stack, but does not provide a stable 4-hour gain.
- **MACD:** the next addition worsens 24-hour rho but improves 4-hour rho. It is not a uniformly useful component.
- **Momentum:** adding it is the largest negative indicator increment at 24 hours. Its 4-hour effect is negative in the full sample and approximately neutral after de-duplication.
- **Volume:** changes are small and reverse direction in the de-duplicated sample. The current evidence does not justify treating its 15% weight as reliable signal.
- **Market context:** adding the current 10% context blend after all five indicators consistently causes the largest remaining decline in rho. The score's weakest performance is therefore not attributable to a single technical indicator alone.

## Return separation: 1-day EMA versus current Market Strength

The following groups are selected by each score's 25th/75th percentile thresholds, including all tied values. They are descriptive rankings, not trade simulations.

| Horizon and sample | Score | Bottom group: n / mean / positive | Top group: n / mean / positive |
|---|---|---:|---:|
| 24h, all BUY rows | 1-day EMA | 1,035 / −5.821% / 10.6% | 885 / +0.018% / 51.4% |
| 24h, all BUY rows | Current Market Strength | 854 / −3.886% / 20.8% | 854 / −2.152% / 31.7% |
| 24h, de-duplicated | 1-day EMA | 64 / −6.478% / 7.8% | 41 / +0.699% / 56.1% |
| 24h, de-duplicated | Current Market Strength | 41 / −4.013% / 22.0% | 41 / −4.083% / 24.4% |
| 4h, all BUY rows | 1-day EMA | 1,056 / −1.530% / 30.9% | 904 / +0.024% / 40.7% |
| 4h, all BUY rows | Current Market Strength | 901 / −0.713% / 38.3% | 900 / −1.073% / 35.4% |
| 4h, de-duplicated | 1-day EMA | 65 / −1.908% / 30.8% | 44 / −0.414% / 34.1% |
| 4h, de-duplicated | Current Market Strength | 42 / −1.182% / 31.0% | 42 / −1.826% / 28.6% |

At 24 hours, the 1-day EMA ranking separates winners from losses much better than current Market Strength. At 4 hours, all scores are weak, but current Market Strength's higher-ranked group is not better than its lower-ranked group.

## MACD production precision

In the 3,745 stored BUY decisions, the MACD histogram was exactly zero at these rates:

| Interval | Zero histograms / non-null | Zero rate |
|---|---:|---:|
| 1m | 3,153 / 3,734 | 84.4% |
| 5m | 3,006 / 3,744 | 80.3% |
| 15m | 2,709 / 3,745 | 72.3% |
| 1h | 2,638 / 3,745 | 70.4% |
| 4h | 2,401 / 3,745 | 64.1% |
| 1d | 2,404 / 3,745 | 64.2% |

The engine rounds the MACD histogram to two decimal places before using it in the component score. For low-priced EUR markets, this often removes the histogram signal entirely. The component remains non-null and retains its 15% feature weight when the histogram is zero, so it still reduces the relative influence of the non-zero components. This is a concrete mechanism by which MACD can dilute EMA information even when it contributes no directional information.

## Rankings

### Indicator usefulness

1. **1-day EMA spread** — strongest 24-hour predictor and the only tested component with a consistent signal across both tested horizons.
2. **EMA across all timeframes** — useful at 24 hours, but materially weaker than the 1-day EMA alone and unhelpful at 4 hours.
3. **RSI** — small incremental 24-hour benefit; little 4-hour value.
4. **MACD** — potentially useful at 4 hours, harmful at 24 hours, and frequently quantized to zero.
5. **Momentum** — the most consistently harmful addition to the 24-hour stack; weak or negative standalone association.
6. **Volume** — weak, noisy, and unstable across sample handling.

### Harmfulness to the EMA signal

1. **10% market-context blend** — largest measured incremental decline: −0.124 to −0.133 rho at 24 hours.
2. **Momentum** — −0.068 to −0.073 rho when added to the 24-hour stack.
3. **MACD** — −0.006 to −0.040 at 24 hours; benefit reverses at 4 hours.
4. **Volume** — small, inconsistent changes; cannot be classified as a reliable benefit.
5. **RSI** — generally small effect, slightly positive at 24 hours and negative or neutral at 4 hours.

The ordering is horizon-specific; MACD's positive 4-hour contribution is evidence against removing or down-weighting it uniformly without further testing.

## Conclusions and evidence-led next steps

The current Market Strength formula **does appear to dilute the predictive value of the 1-day EMA spread** in this BUY cohort. The strongest observed degradation occurs when EMA is mixed across all timeframes, when Momentum is added, and when the final market-context blend is applied. The available results do not show that the full score is a better 24-hour ranker than 1-day EMA alone.

For any later controlled experiment, the evidence supports:

- Compare a 1-day-EMA-led ranking against the current all-timeframe score.
- Test lower Momentum and market-context influence separately rather than changing several weights at once.
- Keep RSI as a small candidate input, not a proven improvement.
- Treat MACD as horizon-dependent and address histogram precision before judging its value.
- Do not infer a deployable weight from this report; validate any candidate with a time-separated, out-of-sample replay and realistic fees/slippage.

## Limitations

- The predictive comparison is restricted to historical **BUY** decisions, because this report tests long-entry forward returns. A broader all-action indicator comparison exceeded the production SQL statement timeout and is not reported; this report therefore makes no conclusion about SELL, HOLD, or WAIT predictions.
- BUY decisions are repeatedly recorded for the same symbols. The full-row correlations are serially dependent; the 4-hour de-duplicated sample is much smaller and remains exploratory.
- BUYs are already selected by the current decision logic, which conditions the sample on the current Market Strength and confidence gates. The findings do not establish how the features rank the complete, unfiltered market universe.
- Persisted indicator fields are rounded. Component stacks reconstructed from those fields are approximate; the stored full Market Strength comparator is the production value.
- Forward returns are hourly-candle mark-to-market estimates, not executed or executable trades. Fees, slippage, spreads, portfolio constraints, cooldowns, and position limits are not simulated.
- No walk-forward validation, confidence intervals, or multiple-testing correction was performed. The analysis is evidence for controlled testing, not proof of causation or profitability.
