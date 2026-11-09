# Confidence Model Attribution Analysis

**Data source:** live Supabase production records  
**Snapshot:** 2026-11-09 UTC (latest queried records were approximately 07:41 UTC)  
**Scope:** read-only analysis of the AI Engine, AI Decisions, Trades, and Positions. Production 15-minute candles were used only to label forward returns. No code, thresholds, database contents, or deployments were changed.

## Executive findings

- The current confidence score has almost no rank association with net forward returns across historical BUY decisions: Spearman correlation was **-0.0177 at 4 hours** and **+0.0120 at 24 hours**. After reducing repeated decisions to the latest BUY per symbol per 4-hour bucket, correlations were **-0.0101** and **+0.0185**.
- Most current confidence components provide little variation in this BUY sample. The base is constant, depth is saturated, and coverage is nearly always complete. Market Strength and volatility show horizon- and sample-dependent effects; the ablations do not justify simply removing either.
- An exploratory additive model that directly includes signed 1-day EMA spread and a 1-hour volume-ratio signal has higher rank correlation with forward returns. At the existing feature weights, its 24-hour Spearman correlation is **+0.2272** on repeated rows and **+0.2239** on the de-duplicated sample. The improvement is driven primarily by the 1-day EMA term; it is not proof of causal or realized trading improvement.
- The engine's current volume score mixes volume with the last candle's direction. At low volume, a falling candle produces a **+10** score. All three closed BUY trades in the queried production history had low-volume-branch scores at entry; two scored +10. This is a concrete reason not to interpret the existing volume score as pure volume confirmation.
- The direct-input experiment is a candidate for walk-forward validation, not a threshold or implementation recommendation. It reuses historical BUY decisions and does not replay Risk Manager constraints, portfolio limits, cooldowns, or changed signal eligibility.

## 1. Current confidence formula

For decisions with sufficient data, [lib/ai-engine.mjs](../../lib/ai-engine.mjs) calculates:

```text
confidence =
  clamp(
    35
    + abs(Market Strength) * 0.38
    + candle coverage * 15
    + average depth * 10
    - average volatility penalty,
    0,
    95
  )
```

In the BUY population, Market Strength is positive, so the absolute value does not change its direction. Market Strength itself combines the weighted timeframe score with market context. Timeframe scores include EMA trend, momentum, RSI, MACD, and volume. The engine uses timeframe weights of 1m 0.05, 5m 0.10, 15m 0.15, 1h 0.25, 4h 0.30, and 1d 0.15; within a timeframe, EMA has weight 0.30 and volume 0.15.

The insufficient-data path uses a separate formula and caps confidence below the directional-signal threshold when fewer than four valid intervals are present. All BUY rows analyzed here had five or six valid intervals and used the sufficient-data formula.

### Average component decomposition for 3,745 BUY decisions

| Component | Average points | Observed variation |
|---|---:|---|
| Base score | +35.000 | None |
| Market Strength contribution | +13.417 | 8.383–23.674 |
| Coverage bonus | +14.992 | 15.000 for six intervals; 12.500 for five |
| Depth bonus | +10.000 | None; saturated for every BUY |
| Volatility penalty | -5.949 | 3.333–12.000 deducted |
| **Mean confidence** | **67.460** | — |

Of the 3,745 BUY decisions, 3,733 had all six intervals and 12 had five. The base and depth bonuses therefore do not rank BUY decisions in this sample. Coverage has very little variation.

## 2. Production data and forward-return method

At the queried snapshot, production contained 3,745 BUY, 179,853 HOLD, 45,121 SELL, and 5,677 WAIT decisions. The executed-trade sample was much smaller: five BUY entries, three closed trades, and two open positions.

Forward outcomes were calculated from production 15-minute candles:

1. Use the first close at or after the decision, within 30 minutes, as the entry reference.
2. Use the close nearest the 4-hour or 24-hour target, within a 30-minute tolerance.
3. Apply 0.25% fees and 0.10% adverse slippage on both entry and exit to obtain net forward returns.
4. Exclude rows without both required price observations.

The full-row results include repeated, overlapping decisions. To reduce this dependence, a second sample keeps only the latest BUY for each symbol in each 4-hour bucket. That sample is still not statistically independent: symbols and market regimes are shared.

## 3. Attribution of current components

The table reports Spearman correlation between confidence ranking and net forward return. “Without” means the stated component was removed from the confidence score, with the remaining historical inputs unchanged.

| Component test | 4-hour result | 24-hour result | Interpretation |
|---|---|---|---|
| Current score | All rows: -0.0177; de-duplicated: -0.0101 | All rows: +0.0120; de-duplicated: +0.0185 | Essentially no rank signal |
| Remove base score | No change in rank correlation | No change in rank correlation | Constant offset cannot rank outcomes; absolute threshold effects were not replayed |
| Remove depth bonus | No change in rank correlation | No change in rank correlation | Depth is constant at +10 in this population |
| Remove coverage bonus | — | All rows: +0.0131; de-duplicated: unchanged | Negligible change; coverage is nearly constant |
| Remove Market Strength contribution | All rows: +0.0894; de-duplicated: +0.1295 | All rows: -0.1683; de-duplicated: -0.0544 | Helps 4-hour ranking but materially hurts 24-hour ranking; not a generally beneficial removal |
| Remove volatility penalty | — | All rows: +0.1033; de-duplicated: +0.0112 | Apparent full-row gain does not persist in the de-duplicated sample |

**Conclusion:** no varying current component has a stable, sample-independent contribution across both horizons. Market Strength and volatility are horizon-sensitive. The base, depth, and coverage results primarily reflect their lack of variation, not proof that they are unhelpful in other populations or when confidence thresholds are applied.

## 4. Direct 1-day EMA and 1-hour volume-ratio experiment

This sensitivity test adds the two features directly to confidence using the engine's existing timeframe and indicator weights. It deliberately tests an additional contribution even though those features already feed Market Strength. It does not fit weights to returns.

For the 1-day EMA input:

```text
EMA1d = clamp(1-day EMA percent spread * 50, -100, 100)
```

For a volume-ratio-only input, the existing ratio score mapping was used without multiplying by the last candle's direction:

```text
Vratio1h =
  clamp((ratio - 1) * 25, 0, 60), when ratio >= 1.5
  -10,                            when ratio <= 0.5
  0,                              otherwise
```

This isolates the ratio contribution; it is not a complete price-direction confirmation rule. The additional confidence points are:

```text
delta =
  0.38 * 0.9
  * (0.15 * 0.30 * EMA1d + 0.25 * 0.15 * Vratio1h)
  / sum(active timeframe weights)
```

The `x0.5`, `x1`, and `x2` results scale this same delta. `x1` uses the existing coefficients; `x2` is only a sensitivity bound and is not recommended. For six active intervals, the EMA term contributes at most ±1.539 confidence points and the ratio term ranges from -0.128 to +0.770 points.

### Correlation results

| Model | All BUY rows: 4h / 24h | Latest BUY per symbol/4h bucket: 4h / 24h |
|---|---|---|
| Current confidence | -0.0177 / +0.0120 (n=3,283 / 3,086) | -0.0101 / +0.0185 (n=145 / 133) |
| Add 1-day EMA only | +0.0381 / +0.2032 | +0.0400 / +0.1643 |
| Add existing signed volume score only | -0.0044 / +0.0395 | -0.0148 / +0.0692 |
| Add 1-day EMA + existing signed volume score | +0.0433 / +0.2203 | +0.0515 / +0.2076 |
| Add 1-day EMA + ratio-only score, x0.5 | +0.0154 / +0.1360 | +0.0362 / +0.1507 |
| Add 1-day EMA + ratio-only score, x1 | +0.0372 / +0.2272 | +0.0600 / +0.2239 |
| Add 1-day EMA + ratio-only score, x2 | +0.0570 / +0.3187 | +0.0878 / +0.2926 |

The EMA-only results explain most of the lift. The volume-only term using the current signed volume score is weaker. The ratio-only combined model also performs better than current confidence in this historical sample, but its results do not isolate the volume term from EMA. Do not treat the largest x2 correlation as an optimal weight: scaling a feature that is already associated with returns mechanically raises its influence and is not a validation procedure.

### Exploratory time split

The same history was split at 2026-11-06 00:00 UTC as a diagnostic, not as a pre-registered holdout.

| De-duplicated sample | Current 24h correlation | EMA + ratio x1 24h correlation | n |
|---|---:|---:|---:|
| Before split | +0.0404 | +0.2213 | 99 |
| On/after split | -0.0591 | +0.1390 | 34 |

The direction of the association is consistent across this split, but the later independent-ish sample is only 34 observations. The repeated-row later sample changes from -0.1426 to +0.0177 (n=784), illustrating how overlapping decisions and market regimes affect estimates. This diagnostic is not out-of-sample proof.

## 5. Volume-score interpretation

The engine's existing `calculateVolume` logic in [lib/ai-engine.mjs](../../lib/ai-engine.mjs) multiplies the volume-ratio branch by the last candle's direction:

```text
ratio >= 1.5: sign(lastChange) * clamp((ratio - 1) * 25, 0, 60)
ratio <= 0.5: -sign(lastChange) * 10
otherwise:    0
```

Therefore, a low-volume falling candle produces **+10**, while a low-volume rising candle produces **-10**. A positive volume score is not necessarily evidence of strong volume or bullish confirmation. This is particularly relevant when considering whether volume should directly raise BUY confidence.

## 6. Executed-trade context

Only five BUY entries were present in the queried trade history. The three closed trades were losses, each entered with a negative 1-day EMA spread. Their 1-hour volume scores were all in the low-volume branch:

| Market | Entry time (UTC) | 1-day EMA spread | Existing 1h volume score | Status / outcome |
|---|---|---:|---:|---|
| WIN-EUR | 2026-11-02 14:13 | +7.88% | +18.2 | Open; unrealized -€13.38 |
| ARX-EUR | 2026-11-04 11:03 | -2.40% | +10 | Closed; realized -€56.11 |
| MEGA-EUR | 2026-11-04 11:03 | +0.81% | 0 | Open; unrealized +€31.29 |
| POL-EUR | 2026-11-04 11:03 | -2.49% | -10 | Closed; realized -€65.74 |
| SXT-EUR | 2026-11-04 14:48 | -1.51% | +10 | Closed; realized -€148.72 |

The three realized losses total **-€270.58**. Two open-position P&Ls are mark-to-market and can change. This tiny executed sample is consistent with investigating daily trend alignment, but it cannot validate an indicator or confidence model. It also must not be conflated with the much larger historical decision sample.

## 7. Answers and recommendations

1. **Is current confidence predictive of BUY profitability?** Not materially in the measured sample. Its rank correlation is near zero at both horizons.
2. **Does removing a component improve prediction?** No removal is consistently beneficial. Removing Market Strength helps the 4-hour ranking but hurts 24-hour ranking. Removing volatility appears beneficial only in the repeated-row 24-hour result, not after de-duplication.
3. **Is confidence too conservative?** This analysis does not establish that. It evaluates ranking, not confidence thresholds, candidate trade counts, or execution after risk controls.
4. **Should 1-day EMA and 1-hour volume ratio enter confidence directly?** The historical evidence supports testing the idea, particularly the 1-day EMA term. It does not support deploying the simulated coefficients without further validation. The volume-ratio mapping and direction interaction need explicit product decisions.
5. **What should happen next?** Preserve the current production model for now. Run a chronological walk-forward evaluation over additional data, reporting calibration and net outcomes by regime. Replay any candidate through the same BUY eligibility, Risk Manager, position limits, cooldowns, fees, and slippage. Keep model weights fixed before the holdout and compare against current confidence.

## Limitations

- Spearman correlation measures ranking association, not probability calibration, causality, or expected euro profit.
- The full-row sample contains overlapping decisions and clustered symbols. De-duplication reduces but does not remove dependence.
- The time split is exploratory, especially the 34-observation later de-duplicated sample.
- The direct-input formula duplicates features already represented in Market Strength; the experiment does not isolate a causal benefit.
- The historical BUY population is conditioned on the existing engine's BUY decisions. It does not show how a changed confidence score would alter decision generation.
- No statistical significance tests, confidence intervals, walk-forward trade replay, or risk-manager simulation were performed.
- Production P&L values are snapshot-specific.

**Change status:** report only. No application tests, builds, deployments, threshold changes, or database writes were performed.
