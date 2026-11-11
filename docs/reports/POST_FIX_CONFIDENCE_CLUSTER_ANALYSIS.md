# Post-Fix Confidence Cluster Analysis

**Post-fix BUY window:** 2026-11-04 08:56:02–10:45:16 UTC

**Data cutoff:** 2026-11-04 10:45:16.611867 UTC

**Scope:** Read-only comparison of the 32 BUY decisions in the [Post-Fix Trade Generation Audit](./POST_FIX_TRADE_GENERATION_AUDIT.md) with the BEAM-EUR and WIN-EUR entry decisions. No code, database, scheduler, or trading settings were changed.

## Executive result

The current BUYs have full candle coverage and maximum depth bonuses. Their average Market Strength contribution is 10.88 points, while the average volatility penalty subtracts 5.08 points. The resulting average confidence is 65.80, with a mean deficit of **1.2019 points** to 67.

**In the formula arithmetic, volatility is the final subtractive component that puts these BUYs below 67:** all 32 reconstructed scores are at least 67 before the volatility penalty and below 67 after it. However, the current volatility penalty is lower than those on the BEAM and WIN entry decisions. Compared with those actual entries, the current BUYs' substantially lower Market Strength contribution is the main distinguishing factor. All current BUYs have six fresh valid intervals, so freshness filtering does not reduce their coverage or depth bonuses.

## Confidence formula and component definitions

The deterministic AI Engine calculates confidence for sufficient data as:

```text
clamp(
  35
  + abs(Market Strength) * 0.38
  + candleCoverage * 15
  + averageDepth * 10
  - averageVolatilityPenalty,
  0,
  95
)
```

The result is rounded to two decimal places. `candleCoverage` is the fraction of the six configured intervals that are valid and fresh. `averageDepth` is a candle-history depth bonus, not order-book depth; it averages `min(candleCount / 100, 1)` across valid intervals. Volatility contributes a penalty of 12 for each high-volatility interval, 4 for each medium-volatility interval, and 0 for low or insufficient volatility, averaged over valid intervals. If fewer than four valid intervals remain, confidence is additionally capped at 64.

The component values below are reconstructed from the stored decision indicators using this implementation formula; the database stores the final confidence and inputs, not a separate field for each confidence component.

## Current post-fix BUY component breakdown

There were 32 BUY decisions in the fixed post-fix window. Every decision had six valid fresh intervals, so each received the full coverage and depth bonuses. None triggered the fewer-than-four-interval cap.

| Component | Average points | Per-decision range / status |
|---|---:|---|
| Base score | 35.00 | Fixed |
| Market Strength contribution | 10.88 | 10.28–11.94 |
| Coverage bonus | 15.00 | 15.00 for all 32 |
| Depth bonus | 10.00 | 10.00 for all 32 |
| Volatility penalty | -5.08 | -4.67 to -5.33 |
| Score before volatility penalty | 70.88 | All 32 at or above 67 |
| Stored confidence | 65.80 | 65.10–66.61 |

The formula reconstruction averages 65.7989 versus stored confidence of 65.7981; the 0.0008-point difference is consistent with reconstructing from the rounded values persisted in the decision indicators.

### Deficit to 67

| Measure | Result |
|---|---:|
| Mean deficit (`67 - confidence`) | **1.2019 points** |
| Smallest deficit (highest BUY confidence, 66.61) | 0.39 points |
| Largest deficit (lowest BUY confidence, 65.10) | 1.90 points |

## Comparison with historical entry decisions

The entries below are the AI decisions linked to the recorded BUY trades. Both had the same full 15-point coverage and 10-point depth bonuses as the post-fix BUYs.

| Decision | Decision time (UTC) | Confidence | Market Strength | Strength contribution | Coverage | Depth | Volatility penalty | Reconstructed confidence |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Post-fix BUYs (average) | 2026-11-04 window | 65.80 | 28.64 | 10.88 | 15.00 | 10.00 | 5.08 | 65.80 |
| BEAM-EUR entry | 2026-11-01 18:06:36 | 70.10 | 54.66 | 20.77 | 15.00 | 10.00 | 10.67 | 70.10 |
| WIN-EUR entry | 2026-11-02 14:11:15 | 68.52 | 38.22 | 14.52 | 15.00 | 10.00 | 6.00 | 68.52 |

Relative to the WIN entry, the post-fix average has **3.64 fewer points** from Market Strength, while its volatility penalty is **0.92 points smaller**. Relative to the BEAM entry, it has **9.89 fewer points** from Market Strength, while its volatility penalty is **5.58 points smaller**. Thus, the present volatility penalty is not unusually large compared with these prior entries; stronger Market Strength compensated for larger penalties in both historical examples.

## Component attribution

- **Volatility penalty — direct arithmetic crossing:** The mean pre-penalty score is 70.88; subtracting the mean 5.08-point penalty yields 65.80. All 32 reconstructed post-fix scores would be at least 67 before this penalty. In the current score formula, volatility is the final component that moves these signals below 67.
- **Reduced Market Strength — primary comparison with prior entries:** The current average strength contribution (10.88) is 3.64 points below WIN-EUR's and 9.89 points below BEAM-EUR's. The historical entries cleared 67 despite higher volatility penalties because their Market Strength contributions were larger.
- At the observed mean volatility penalty and full coverage/depth bonuses, a Market Strength of about **31.80** would be required to reach 67; the current BUY average was 28.64, about 3.16 points lower.
- **Market conditions:** The current 32 BUYs met the AI's directional strength condition; their Market Strength ranged from 27.05 to 31.43. Their strength was nevertheless materially lower than the two compared entry decisions.
- **Freshness filtering:** Not a cause for these BUYs. Every one recorded all six candle intervals as fresh and valid, with 100% coverage and the full depth bonus.

**Conclusion:** The confidence cluster is produced by the interaction of moderate Market Strength with the volatility deduction. Volatility is the immediate subtractive term crossing the threshold in the formula, while the lower Market Strength—rather than unusually severe volatility or freshness loss—is the primary difference from the BEAM and WIN entry examples. This report explains the distribution only and does not recommend changing any threshold.

## Sources and limitations

- [Post-Fix Trade Generation Audit](./POST_FIX_TRADE_GENERATION_AUDIT.md) — fixed window, current BUY set, and freshness evidence.
- [Post-Fix Threshold Impact Analysis](./POST_FIX_THRESHOLD_IMPACT_ANALYSIS.md) — confidence distribution and threshold counts for the same window.
- [AI confidence calculation](../../lib/ai-engine.mjs) — formula, valid-interval coverage/depth, volatility penalty, and confidence cap.
- [Risk management rules](../RISK_MANAGEMENT.md) — current Phase 08 execution controls.
- [Confidence-threshold experiment migration](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql).

**Tests:** Not run; this is a read-only production data analysis.
