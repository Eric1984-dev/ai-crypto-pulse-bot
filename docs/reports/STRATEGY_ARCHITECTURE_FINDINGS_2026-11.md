# Strategy Architecture Findings — November 2026

**Scope:** Read-only review of V2.0.0 and V2.1.0 strategy documentation, implementation, and stored production decision history.  
**Observed history:** 2026-11-14 22:20 UTC through 2026-11-20 22:05 UTC (about six days, despite the 30-day query window).  
**Database changes:** None. **Code/configuration changes:** None.

## Samenvatting

- The inspected V2 strategy is primarily a daily EMA-led directional scoring model: `dailyEmaScore` correlated about **0.985** with stored Market Strength in both V2.0.0 and V2.1.0.
- The daily EMA base term accounted for about **82% of the aggregate absolute Market Strength** in both versions.
- Momentum has no direct contribution to Market Strength or confidence. V2.1.0 uses positive 1d momentum as a post-score BUY-selection filter.
- Volume is direction-confirming through multiplication by signed daily EMA strength; high volume can add bullish or bearish score, and is not independently bullish.
- Confidence is a model-strength score, not a direction or calibrated probability. High-confidence bearish SELLs occurred in the stored history.
- The available history covered about six days, with 101 active markets and a strongly bearish model-scored regime. In the 2026-11-20 21:55 UTC latest-market snapshot, 92 markets had a latest SELL decision.
- V2.1.0 is an experiment, not validated evidence of improvement. Its executed/closed trade sample is still small; await at least 25 closed trades before the first formal evaluation and 50 for a fuller review.

### Belangrijkste bevindingen

- The daily EMA base component accounts for about **82% of aggregate absolute Market Strength** in the stored V2.0.0/V2.1.0 sample.
- Correlation between `dailyEmaScore` and `marketStrength` is approximately **0.985**.
- The strategy therefore behaves primarily as a **daily EMA-trend strategy** in this observed sample.
- Momentum does not directly affect Market Strength or confidence; V2.1.0 uses it as a post-score BUY filter.
- Volume confirms the signed EMA direction: it can strengthen bullish or bearish Market Strength and is not a standalone bullish signal.
- Confidence measures model signal strength, not direction or calibrated outcome probability.

## Bevindingen

### 1. Strategie is voornamelijk een EMA-trendstrategie

The active V2 Market Strength formula is:

```text
dailyEmaScore = clamp(1d EMA spread (%) × 50, -100, 100)
Market Strength = clamp(
    0.75 × dailyEmaScore
  + 0.10 × dailyEmaScore × alignment
  + 0.10 × dailyEmaScore × volumeConfirmation
  + 0.05 × dailyRsiScore
  - misalignmentPenalty,
  -100, 100)
```

`alignment` is 1 when 1d and 1h directions match and are not sideways; otherwise it is 0. `misalignmentPenalty` is 20 in the inspected active implementation. Volume confirmation is `clamp(hourlyVolumeRatio - 0.5, 0, 1)`. The directional score and decision gate are implemented in [`ai-engine.mjs`](../../raspberry-pi/src/services/ai-engine.mjs).

| Strategy version | Valid stored rows | Correlation: dailyEmaScore ↔ Market Strength | Daily EMA base term / aggregate absolute Market Strength |
|---|---:|---:|---:|
| 2.0.0 | 140,722 | 0.9855 | 81.54% |
| 2.1.0 | 30,858 | 0.9846 | 82.24% |
| Combined | 171,580 | 0.9853 | Approximately 82% |

The share is calculated as the sum of absolute daily EMA base contributions divided by the sum of absolute Market Strength values. It is an aggregate contribution ratio, not a per-decision percentage. The very high correlation and the large base coefficient support describing the strategy as daily EMA-led. This does not establish that EMA is predictive or profitable.

For context, `dailyEmaScore` had a median of -100 in both versions over the observed history. Mean scores were -87.65 in V2.0.0 and -89.33 in V2.1.0. This reflects a strongly negative score distribution during this short observed period and must not be generalized to other regimes.

### 2. Momentum heeft geen directe invloed op Market Strength

The stored 1d momentum metric does not appear in the Market Strength or confidence formula. V2.1.0 applies it after the directional BUY decision: a candidate with 1d momentum `<= 0` is converted to HOLD. This is a separate entry-selection filter, not a component of the EMA-led score.

The stored-decision correlation between dailyEmaScore and encoded decision direction (BUY = +1, SELL = -1, HOLD/WAIT = 0) was **0.4687** for V2.0.0 and **0.6889** for V2.1.0. The combined correlation was **0.4873**. These correlations describe this particular record set; repeated market evaluations are not independent observations and the correlation does not demonstrate causality.

### 3. Volume is richtingbevestigend

The volume term is `0.10 × dailyEmaScore × volumeConfirmation`. Because `dailyEmaScore` is signed:

- Positive daily EMA strength plus stronger volume adds positive Market Strength.
- Negative daily EMA strength plus stronger volume adds negative Market Strength.
- Volume alone cannot set the direction; it confirms/scales the signed daily EMA contribution.

Average signed contributions in the stored sample were:

| Version | Daily EMA base | Alignment term | Volume term | RSI term |
|---|---:|---:|---:|---:|
| 2.0.0 | -65.74 | -6.05 | -2.80 | -1.96 |
| 2.1.0 | -66.99 | -8.60 | -3.66 | -1.79 |

These are average score-point contributions, including the observed market regime. A positive or high raw volume ratio should not be interpreted as an inherently bullish input.

### 4. Confidence is geen richtingsindicator

The active confidence calculation uses absolute trend strength, alignment, volume and RSI confirmations, minus volatility and misalignment penalties. The 30-point trend-strength term uses the magnitude of the daily EMA score, so strong bearish trend strength can increase confidence just as strong bullish trend strength can. Confidence is a deterministic model-strength measure; it is not a calibrated probability that a trade will win and does not encode bullish versus bearish direction.

In the 2026-11-20 latest SELL-market snapshot, **39 of 92** markets had confidence above 80. The V2.1.0 average confidence across the broader stored sample was 77.13. High confidence therefore did occur alongside bearish SELL decisions; it should not be read as bullishness.

The same 92-market SELL snapshot had **48** markets with positive 1d momentum
and **43** with volume-score >= 0.25. Their mean score decomposition was:

| Component | Mean Market Strength contribution |
|---|---:|
| Daily EMA base term | -74.93 |
| Alignment term | -9.99 |
| Volume term | -3.56 |
| RSI term | -1.90 |
| Misalignment penalty | 0.00 |
| **Recomputed Market Strength** | **-90.38** |

All 92 had bearish 1d and 1h directions in that snapshot. Positive momentum or
high volume therefore did not outweigh the negative EMA-led score. The volume
term itself was negative on average because it multiplies signed bearish EMA
strength.

### 5. Marktregime tijdens analyseperiode

The nominal 30-day query returned usable history only from **14 November through 20 November 2026**, about six days. The market-universe snapshot contained **101 active markets**. All 101 were analyzed in the inspected 24-hour period. At the 20 November 21:55 UTC snapshot, **92 markets had a latest SELL decision**, consistent with the broadly negative daily EMA score distribution.

During the observed V2.1.0 candidate history, **three markets generated BUY
candidates: CAP-EUR, MEGA-EUR, and USDC-EUR**. The other **98 markets generated
no BUY candidates**; within that no-candidate group, 92 had a latest SELL and
six had a latest HOLD. These candidate-history and latest-decision counts are
different classifications and should not be added as mutually exclusive
latest-decision buckets. The three candidate markets' latest decisions at the
snapshot were HOLD.

This is evidence about the model's decisions in that observed window, not a definitive external bull/bear classification or a long-term market-regime estimate. The stored dataset is short and market/decision rows are repeated over time.

### 6. V2.1.0 experiment

V2.1.0 adds two paper BUY-selection filters after the existing directional score and confidence gate:

- Daily momentum must be `> 0`.
- Hourly volume score must be `>= 0.25`, where `volumeScore = clamp(hourlyVolumeRatio - 0.5, 0, 1)`.

Signals that otherwise qualify as BUY but fail either condition are persisted as HOLD with the corresponding filter reason. The filters do not change the confidence formula, EMA score, alignment calculation, executor, or exit logic.

The motivating V2.0.0 in-sample trade set had 14 closed trades: 7 winners and 7 losers, 50.0% winrate, +€4.15 average winner, -€10.06 average loser, and -€2.95 expectancy. Retrospectively applying both filters retained 6 trades (5 wins, 1 loss), with 83.3% winrate, +€2.07 expectancy and +€12.43 total net P&L. That six-trade subset was selected from the same historical sample and is not out-of-sample validation.

Three executed V2.1.0 BUY entries were examined in the early post-deployment comparison. The available closed-trade sample remains only a few trades and is far below a reliable evaluation size. No claim that V2.1.0 outperforms V2.0.0 is supported yet. The operator reports deployment to the Pi, and production decision rows tagged `2.1.0` were observed; the running binary/build identity was not independently inspected for this report.

The three linked entry-decision snapshots were all MEGA-EUR and all had
bullish 1d and 1h trend labels. Their alignment score was 1:

| Entry timestamp (UTC) | 1d / 1h trend | Alignment score | Market Strength | Confidence |
|---|---|---:|---:|---:|
| 2026-11-20 00:30:42 | bullish / bullish | 1 | +97.39 | 87.39 |
| 2026-11-20 02:10:12 | bullish / bullish | 1 | +90.99 | 80.99 |
| 2026-11-20 04:05:15 | bullish / bullish | 1 | +96.59 | 86.59 |

These are entry-decision attributes, not independent closed-trade outcome
evidence. They do not test whether the executor's alignment gate could be
removed or whether V2.1.0 improves performance.

### 7. Niet bewezen

The available evidence does **not** prove:

- That V2.1.0 performs better than V2.0.0.
- That `marketData.dailyChangePct` is a better entry filter than the stored daily momentum metric.
- That the daily EMA weight should be reduced or otherwise changed.
- That the current losses were caused by the V2.1.0 entry filters.
- That positive momentum and volume cause better results, rather than identifying a favorable subgroup by chance or market regime.
- That confidence is statistically calibrated to outcome probability.

The six-trade retrospective filtered subset, a few executed V2.1.0 entries, and repeated decision rows do not establish robust expectancy or causality. Regime concentration, serial dependence, repeated decisions per market, and in-sample selection limit inference.

### 8. Aanbevolen opvolging

- Make no further strategy changes based on this short evidence window.
- Continue collecting prospective V2.1.0 paper-trading data with the current rules and preserve the strategy-version tags.
- Conduct the first formal evaluation after **at least 25 closed V2.1.0 trades**; treat it as preliminary and report uncertainty.
- Conduct a broader evaluation at **50 closed V2.1.0 trades**, with market/pair concentration, fees, slippage, drawdown, and an appropriate time-based comparison against V2.0.0.
- Keep open positions separate from closed-trade outcome metrics and avoid treating repeated AI decisions as independent trades.

## BUY generation versus paper execution

Trend alignment is **not a hard gate for generating an AI BUY decision**. In the AI engine it changes Market Strength and confidence. The AI decision gate requires valid directional inputs, Market Strength at least +20, and confidence at least 65; positive Market Strength selects BUY. V2.1.0 momentum and volume filters then may turn that candidate into HOLD.

There is a separate hard alignment check in the paper executor: it will not open a simulated position unless the stored BUY has explicit daily/hourly alignment. The executor also applies confidence >=70 and the other risk, freshness, capacity, cooldown, and portfolio checks. Thus an AI BUY label and an executed paper BUY are distinct events.

In the confidence equation, aligned timeframes receive a +10 alignment term;
misaligned/sideways timeframes receive a -20 misalignment penalty. Holding the
other inputs fixed, this makes the alignment contribution's confidence swing
30 points between aligned and misaligned states. Market Strength also has the
explicit 10% EMA-alignment term and 20-point misalignment penalty.

## Reproducibility notes

- Data source: saved `AI_Crypto_Bot_AI_Decisions` rows, grouped by `strategy_version`; timestamps are UTC.
- The 30-day lookback contained only approximately six days of rows at query time.
- Daily EMA score was reconstructed from saved 1d EMA `percentSpread` using the active code's clamp and scale.
- Market-strength contribution share uses absolute aggregate contributions; correlations use stored decisions and the stated categorical encoding.
- Analysis is descriptive. No backtest, strategy optimization, database write, code change, or configuration change was performed for this report.
