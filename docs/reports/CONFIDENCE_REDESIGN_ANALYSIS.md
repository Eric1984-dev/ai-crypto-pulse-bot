# Confidence Redesign Analysis

**Data source:** live Supabase production AI decisions and candles  
**Analysis date:** 2026-11-09 UTC; BUY decisions span 2026-11-01 11:15 through 2026-11-09 05:56 UTC  
**Scope:** read-only investigation. No code, thresholds, production data, or deployment settings were changed.

## Executive findings

- Current confidence is driven mostly by the Market Strength contribution and volatility penalty. Coverage and depth add many points to the score but scarcely distinguish BUY decisions: depth is constant, and coverage varies for only a small fraction.
- Current confidence barely ranks forward profitability: Spearman **+0.012 at 24 hours** across all BUY decisions and **+0.019** in the reduced sample.
- The direct inputs have stronger historical associations: 1-day EMA spread score **+0.403** and EMA direction **+0.345** at 24 hours; 1-hour volume ratio **+0.187**. The reduced sample correlations are respectively **+0.379**, **+0.271**, and **+0.343**, with only 133 labeled decisions.
- A centered exploratory redesign—halving Market Strength and volatility influence, neutralizing coverage/depth variation, and adding direct 1-day EMA and 1-hour ratio terms—raised 24-hour confidence-rank correlation to **+0.319** on all rows and **+0.293** in the reduced sample. The top confidence quartile had a 40.5% win rate versus 18.1% in the bottom quartile; its mean net return was approximately break-even at **+0.004%**. The reduced sample remained slightly negative.
- This is a promising ranking result, not a validated confidence model or an expected portfolio return. The redesigned scores fall below the existing AI signal threshold for 224 historical BUY rows; thresholds and BUY eligibility were not changed or replayed.

## 1. Current confidence formula and actual influence

For decisions with sufficient data, [the AI Engine](../../lib/ai-engine.mjs#L366-L380) calculates:

```text
confidence =
  clamp(
    35
    + abs(Market Strength) * 0.38
    + coverage fraction * 15
    + average depth * 10
    - average volatility penalty,
    0,
    95
  )
```

In the BUY population, Market Strength is positive. Coverage is the share of the six supported intervals that are valid; depth is the average capped candle-count fraction. Volatility contributes a penalty of 0, 4, or 12 points for each low-, medium-, or high-volatility interval, averaged across valid intervals. See [the confidence formula](../../lib/ai-engine.mjs#L361-L380) and [the volatility penalty](../../lib/ai-engine.mjs#L733-L749).

The formula was reconstructed from production decision records. There were **zero mismatches greater than 0.011 points** across 3,745 BUY decisions; mean absolute difference was 0.00250 points.

| Current input | Mean points in confidence | Standard deviation | Observed range | What it means in this BUY sample |
|---|---:|---:|---:|---|
| Fixed base | +35.000 | 0 | 35.000 | Constant offset; cannot rank decisions |
| Market Strength contribution | +13.417 | 2.868 | — | Largest varying positive term |
| Coverage bonus | +14.992 | 0.141 | 12.500–15.000 | Nearly constant; only 12 records had five valid intervals |
| Depth bonus | +10.000 | 0 | 10.000 | Fully saturated and constant |
| Volatility penalty | -5.949 | 1.498 | -12.000 to -3.333 | Second-largest varying term |
| **Stored confidence** | **67.460** | **2.089** | **65.00–76.34** | — |

These are score-point contributions, not proportions of predictive value. The base, coverage, and depth improve a completeness/reliability interpretation, but this history offers little evidence that they predict whether a BUY will be profitable.

## 2. Predictive comparison

Forward returns use production 15-minute candles, entry/target timestamps within 30-minute tolerances, and 0.25% fees plus 0.10% adverse slippage on each side. “All” includes overlapping BUY decisions; “Reduced” keeps the latest BUY per symbol per 4-hour bucket. Correlation is Spearman correlation with net forward return.

| Confidence input or direct signal | 4h rho: All / Reduced | 24h rho: All / Reduced | 24h labeled n: All / Reduced |
|---|---:|---:|---:|
| Current confidence | -0.018 / -0.009 | +0.012 / +0.019 | 3,087 / 133 |
| Market Strength contribution | -0.060 / -0.090 | +0.104 / +0.012 | 3,087 / 133 |
| Coverage bonus | +0.063 / no variation | -0.030 / no variation | 3,087 / 133 |
| Depth bonus | No variation | No variation | 3,087 / 133 |
| Volatility penalty | -0.110 / -0.176 | +0.124 / -0.024 | 3,087 / 133 |
| 1-day EMA direction (bullish +1, bearish -1) | +0.099 / +0.062 | +0.345 / +0.271 | 3,087 / 133 |
| 1-day EMA spread score | +0.107 / +0.119 | **+0.403 / +0.379** | 3,087 / 133 |
| 1-hour volume ratio | -0.051 / +0.067 | +0.187 / +0.343 | 3,087 / 133 |

The 1-day EMA score is derived from signed EMA spread, so it already encodes direction. Direction and spread should not be treated as independent evidence and blindly counted twice. The direct spread score ranks outcomes better than the binary direction value in this sample.

### Importance mismatch

1. **Market Strength is the main variable driver of current confidence, but is a weaker predictor than its best underlying signal.** Its 24-hour correlation is +0.104 in all rows and +0.012 after reducing repeated decisions, versus +0.403/+0.379 for the 1-day EMA spread score.
2. **Volatility affects confidence materially but has no stable predictive association.** Its 24-hour correlation changes from +0.124 to -0.024 between samples; its 4-hour correlation is negative in both.
3. **Coverage and depth add fixed or nearly fixed points without useful ranking information in this sample.** Depth has no variance. Coverage is almost always 15 points.
4. **The direct 1-day EMA signal and 1-hour volume ratio are not explicit confidence inputs.** They can influence confidence indirectly through Market Strength, but their contribution is diluted by other intervals and indicators.
5. **Current confidence does not reflect this predictive ordering.** Its correlation remains near zero, while the 1-day EMA spread and direction have materially higher 24-hour associations.

## 3. Redesigned confidence simulation

To compare rankings without shifting the score's average or changing thresholds, the simulation centered each variable around its mean in the 3,745-row BUY cohort. It treats coverage and depth as constants at their current-sample means, halves Market Strength influence, halves the volatility-penalty coefficient, and adds direct EMA-spread and volume-ratio terms:

```text
EMA1d = clamp(1-day EMA percent spread * 50, -100, 100)

VolumeRatio1h =
  clamp((ratio - 1) * 25, 0, 60), when ratio >= 1.5
  -10,                            when ratio <= 0.5
  0,                              otherwise

confidence_redesigned = clamp(
  mean_current_confidence
  + 0.50 * (MarketStrengthContribution - cohort_mean)
  - 0.50 * (VolatilityPenalty - cohort_mean)
  + 0.01539 * (EMA1d - cohort_mean)
  + 0.012825 * (VolumeRatio1h - cohort_mean),
  0,
  95
)
```

The EMA and ratio coefficients mirror the engine's existing confidence and feature/timeframe weights. The ratio-only mapping intentionally omits candle direction to isolate ratio information; it is not a complete BUY-confirmation rule. The redesign preserves the average confidence of the full BUY cohort at 67.460. It is an exploratory formula, not a fitted or approved model.

| Score model | 4h rho: All / Reduced | 24h rho: All / Reduced | Bottom 24h quartile: win rate / mean net return | Top 24h quartile: win rate / mean net return |
|---|---:|---:|---:|---:|
| Current confidence | -0.018 / -0.009 | +0.012 / +0.019 | All: 24.9% / -3.378%; reduced: 17.6% / -3.944% | All: 29.2% / -2.566%; reduced: 21.2% / -3.505% |
| Reduce weak inputs only; no direct signals | -0.025 / -0.008 | +0.013 / +0.020 | All: 24.9% / -3.378%; reduced: 17.6% / -3.944% | All: 29.4% / -2.529%; reduced: 21.2% / -3.505% |
| **Redesigned with direct 1d EMA and 1h ratio** | **+0.054 / +0.089** | **+0.319 / +0.293** | **All: 18.1% / -5.074%; reduced: 11.8% / -5.837%** | **All: 40.5% / +0.004%; reduced: 39.4% / -0.098%** |

The score-only reduction did not improve 24-hour ranking consistently. The direct signals account for the redesign's apparent lift. Even in the redesigned top quartile, mean net return is negative in both samples; this is not evidence that the revised score would make paper trading profitable.

### Existing-threshold interaction

The AI Engine's minimum confidence for a directional signal remains 65, and the paper-trading entry gate is 67. No threshold was changed or re-applied to the simulation.

| Historical BUY cohort | Below 65: current / redesigned | Below 67: current / redesigned |
|---|---:|---:|
| All 3,745 BUY rows | 0 / 224 | 1,935 / 1,734 |
| Reduced 168-row sample | 0 / 34 | 122 / 111 |

The redesign produces scores as low as 63.49 in the labeled sample. If it were implemented, the unchanged thresholds would alter which decisions qualify; counts above are not equivalent to executed or rejected trades because cooldown, position, balance, market, and risk controls were not replayed.

## 4. Recommendations and estimated impact

1. **Validate direct 1-day EMA spread before changing production weights.** It is the strongest measured input. Keep direction encoded in the signed spread score rather than adding a second, redundant direction bonus.
2. **Test a ratio-aware 1-hour term with direction handled explicitly.** The current confidence model underrepresents this input, but the ratio-only simulation can reward high volume even when price is falling. Compare the ratio, candle direction, and their interaction in a chronological holdout.
3. **Do not remove coverage/depth as safety or data-quality checks solely because they do not predict returns.** Their score bonuses can be evaluated separately from the reliability signal they represent.
4. **Do not reduce volatility controls based only on predictive correlation.** Volatility has risk semantics, and its observed correlation is unstable. Keep any confidence experiment separate from risk-manager controls.
5. **Do not treat this report's redesign coefficients as deployment-ready.** The full-sample rank correlation rises from +0.012 to +0.319 at 24 hours, and the reduced-sample result rises from +0.019 to +0.293. These are in-sample ranking changes, not estimates of additional trades, win-rate lift after unchanged gates, or euro P&L.
6. **Next validation:** pre-register coefficients; evaluate future periods not used to select the model; retain fee/slippage assumptions; replay unchanged signal thresholds and the complete Risk Manager; report calibration, trade counts, expectancy, win rate, and drawdown.

## Limitations

- The redesign uses the existing historical BUY cohort; it does not regenerate BUY/HOLD/WAIT decisions.
- The reduced sample contains only 133 24-hour outcomes and is still clustered by symbols and regimes.
- Coefficients were tested on the same history used to measure results; no independent holdout, confidence intervals, or significance tests were used.
- The 1-hour ratio mapping is a heuristic derived from existing indicator ranges, and it omits candle direction by design.
- Forward returns are counterfactual candle-based labels, not realized trade outcomes. All-sample 24-hour mean return was -3.183%; reduced-sample mean was -3.683%.
- No code, thresholds, database contents, or deployments were changed. No tests or builds were run; this is a report-only deliverable.
