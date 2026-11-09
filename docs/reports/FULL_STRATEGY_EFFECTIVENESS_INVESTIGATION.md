# Full Strategy Effectiveness Investigation

**Evidence window:** 2026-11-02 00:00 UTC through 2026-11-09 00:16 UTC  
**Primary evidence:** read-only queries against the live production Supabase database  
**Scope:** paper-trading decisions, trades, positions, portfolio snapshots, shadow exits, and stored strategy/backtest records  
**Changes made:** report only. No code, thresholds, deployment, or database contents were changed.

## Executive summary

The five BUY trades since 2 November were five paper-position entries, not five profitable completed trades. Three entries have closed and all three lost, for approximately **-€270.6 realized**, **0% win rate**, **0 profit factor**, and **-€90.19 expectancy per closed trade**. Two positions remained open at the latest observation. The portfolio's latest value was €9,742.91 against a €10,000 starting balance; the maximum observed peak-to-trough drawdown in the snapshot history was 7.18%.

The evidence does **not** support lowering entry thresholds to increase trade count. Every tested 4-hour candidate cohort had negative net expectancy and profit factor below 1 after the modeled fees and slippage. The loosest tested combination increased the signal sample substantially, but remained unprofitable. No tested threshold-specific portfolio drawdown is reported: the proxy does not reproduce the five-position cap, overlapping positions, actual risk-gate rejections, or actual exits.

BUY scarcity has more than one cause. The five-position cap likely constrained entries while all slots were occupied. After slots began to free on 7–8 November, the latest observed market decisions were bearish/neutral rather than BUY: across 102 markets there were 71 SELL, 30 HOLD, one WAIT, and no BUY. The live rejection records needed to allocate exact responsibility to confidence, cooldown, capacity, or other risk gates are not persisted.

Shadow exits provide one promising but very small comparison: on the closed ARX position, three hypothetical rules would have reduced the realized loss, with a +5% fixed take-profit producing the best modeled difference (+€114.63). This is one position, not evidence that the rule is superior across strategies or market regimes. Shadow scenarios are prospective simulations, not executable orders.

**Verdict:** neither “current strategy is optimal” nor “lower thresholds will improve outcomes” is supported. Preserve paper-only risk controls; improve attribution and run a reproducible, cost-aware out-of-sample evaluation before changing entry, confidence, or exit logic.

## 1. Data and method

The live database was the primary source of truth. The decision history contains **203,913 rows** from 2 November through the observation window end. Portfolio metrics were derived from the production snapshots and actual paper trades. Threshold and forward-return calculations are counterfactual signal analyses, not executed portfolio simulations.

The production decision history stores repeated decisions over time. Therefore:

- Decision-row counts are not unique opportunities or trades.
- The threshold “eligible rows” below must not be interpreted as executed entries.
- A separate action-quality sample selects the latest decision for each market in each 4-hour bucket, then pairs it with 15-minute candles near the decision and four hours later.
- The threshold proxy uses a fixed four-hour holding period and applies 0.25% fee and 0.10% adverse slippage on entry and exit. It does not model historical spread, real order fills, risk-gate rejections, portfolio capacity, or the actual exit policy.
- The action-quality table reports raw spot returns without fees or slippage; its sample and method differ from the threshold proxy.
- Shadow exit fills use stored observed marks and configured exit costs; historical bid/ask spread is unavailable.

The period is short and market-regime specific. Results are descriptive, not a statistically validated strategy backtest.

## 2. Current strategy effectiveness

| Metric | Observed result |
|---|---:|
| BUY entries since 2 November | 5 |
| Closed trades | 3 |
| Open positions at latest observation | 2 |
| Closed-trade win rate | 0% (0 wins / 3 losses) |
| Average winning trade | Not applicable; no winning closed trades |
| Average losing trade | Approximately -€90.19 |
| Gross profit / gross loss | €0 / approximately €270.6 |
| Profit factor | 0.00 |
| Expectancy per closed trade | Approximately -€90.19 |
| Average holding duration | Approximately 88.3 hours |
| Latest portfolio value | €9,742.91 |
| Change from €10,000 starting balance | -€257.09 (-2.57%) |
| Maximum observed portfolio drawdown | 7.18% (peak €10,138.96; trough €9,411.13) |
| Maximum observed daily drawdown | 3.02% |

Closed-trade losses:

```text
ARX  -€56.11  ######
POL  -€65.74  #######
SXT -€148.72  ###############
```

The two open positions were WIN (-€14.28 unrealized) and MEGA (+€33.10 unrealized), for approximately +€18.82 combined at the latest mark. Open-position marks are not realized outcomes. The latest portfolio value, rather than the sum of rounded trade figures, is the source for current portfolio value.

The observed 7.18% peak-to-trough drawdown is below the documented 15% portfolio drawdown gate and 20% emergency stop; the observed 3.02% daily drawdown is below the 5% daily limit. No evidence indicates these drawdown gates were the primary cause of the low entry count.

## 3. BUY scarcity and ranked contributing factors

### Decision distribution

| Stored decision | Rows | Share |
|---|---:|---:|
| HOLD | 159,427 | 78.18% |
| SELL | 39,749 | 19.49% |
| BUY | 3,485 | 1.71% |
| WAIT | 1,252 | 0.61% |

```text
HOLD 159,427 | ################################ 78.18%
SELL  39,749 | ########                         19.49%
BUY    3,485 | #                                 1.71%
WAIT   1,252 | #                                 0.61%
```

These are repeated stored decisions, not trade attempts. All five actual entry decisions had confidence between **67.08 and 69.08** and market strength between **30.9 and 38.22**. They were above the live paper-entry confidence threshold of 67 and comfortably above the directional market-strength threshold of 20.

The AI engine's directional signal floor is 65 confidence; the production paper-trading entry gate is 67 during the approved experiment. Of 3,485 stored BUY rows, 1,761 (50.5%) met confidence ≥67. The other 1,724 rows do not represent 1,724 distinct rejected opportunities: repeated market/decision rows and downstream execution gates prevent that interpretation.

### Ranked factors

| Rank | Factor | Assessment | Evidence and confidence |
|---:|---|---|---|
| 1 | Market regime after the last entries | Strongest explanation for no subsequent BUYs | No new entries occurred after 4 November. After exits began on 7–8 November, the latest decisions across 102 markets were 71 SELL, 30 HOLD, one WAIT, and zero BUY. **High confidence for the latest snapshot; moderate for the full period.** |
| 2 | Five-open-position cap | Likely constrained entries while capacity was full | Five positions were occupied by 4 November. Three closed on 7–8 November; two remained open. The exact number of blocked attempts is not recorded. **Moderate confidence.** |
| 3 | Confidence execution gate | A material filter, but not the sole cause | About half of stored BUY rows met the 67 entry threshold, but repeated rows are not unique attempts. All five filled entries only narrowly cleared the threshold. **Moderate confidence that it filtered rows; low confidence on its share of missed entries.** |
| 4 | Data freshness / candle coverage | Reduced decision availability for some markets | Of 1,252 WAIT rows, 1,031 (82.3%) were `STALE_CANDLE_DATA`; all had fewer than two valid candle intervals. The other 221 (17.7%) cited a missing, invalid, or stale market snapshot. **High confidence for WAIT reasons; unknown effect on would-be executions.** |
| 5 | Market-strength threshold | Unlikely to explain scarcity at current confidence gates | All five actual entries had market strength above 30.9. At confidence 67 or 65, lowering strength from 20 to 18, 15, or 12 did not change eligible-row counts. **Moderate confidence for this window.** |
| 6 | Cooldown and other risk gates | Possible but not quantifiable from stored data | The 15-minute per-market cooldown, balance checks, pause state, and other execution controls can reject entries. There is no persisted per-decision rejection audit to count their contribution. **Low confidence / insufficient evidence.** |

The position cap plausibly explains a period when all slots were occupied; it cannot explain the absence of BUY decisions after capacity returned. The later bearish/neutral decision mix is the clearest explanation for that later interval.

## 4. Near-miss opportunities and decision quality

### Threshold eligibility counts

The following are historical decision rows that satisfy a counterfactual confidence and absolute market-strength screen. They are **not unique trades**.

| Confidence floor | Strength ≥20 | Strength ≥18 | Strength ≥15 | Strength ≥12 |
|---:|---:|---:|---:|---:|
| 67 | 1,761 | 1,761 | 1,761 | 1,761 |
| 65 | 3,485 | 3,485 | 3,485 | 3,485 |
| 63 | 5,877 | 6,007 | 6,122 | 6,128 |
| 60 | 7,568 | 8,597 | 10,340 | 12,084 |

Lowering confidence increases the historical row pool; lowering strength adds very little at 67/65 and only adds rows when confidence is also reduced. This is an opportunity-count result, not a profitability result.

### Forward return by stored action

This independent action-quality sample uses the latest action per market per 4-hour bucket and a four-hour spot return. It is **before** trading costs and is not an executable backtest.

| Action | Sampled decisions | With paired candles | Candle coverage | Mean confidence | Mean spot return | Median | Positive spot return |
|---|---:|---:|---:|---:|---:|---:|---:|
| BUY | 82 | 69 | 84.1% | 67.72 | -0.891% | -1.076% | 31.88% |
| HOLD | 3,324 | 2,091 | 62.9% | 59.08 | -0.296% | -0.252% | 39.89% |
| SELL | 952 | 560 | 58.8% | 68.33 | +0.270% | -0.005% | 49.64% |
| WAIT | 16 | 0 | 0% | 22.50 | Not measurable | Not measurable | Not measurable |

SELL's mean direction-adjusted return was **-0.196%**, meaning the four-hour short direction was slightly negative on average in this sample. The positive raw spot return after SELL decisions is not evidence that every SELL was wrong, but it does not support a strong short-term predictive edge. HOLD outcomes were negative on average, with about 40% of paired samples rising; this shows some missed upside, not a positive aggregate HOLD-to-BUY edge. WAIT cannot be evaluated because no sampled WAIT had a paired candle window.

### Cost-aware threshold proxy

The separate threshold proxy takes one candidate per market per 4-hour bucket, holds for four hours, and includes the configured fee and slippage on both sides. `N` is the proxy's candidate sample size, not actual filled trades.

| Confidence | Strength | Eligible decision rows | Proxy N | Win rate | Profit factor | Expectancy / candidate |
|---:|---:|---:|---:|---:|---:|---:|
| 67 | 20 / 18 / 15 / 12 | 1,761 each | 44 | 22.73% | 0.302 | -1.317% |
| 65 | 20 / 18 / 15 / 12 | 3,485 each | 82 | 26.83% | 0.339 | -1.386% |
| 63 | 20 | 5,877 | 130 | 27.69% | 0.319 | -1.213% |
| 63 | 18 | 6,007 | 133 | 27.07% | 0.314 | -1.209% |
| 63 | 15 | 6,122 | 138 | 26.09% | 0.301 | -1.240% |
| 63 | 12 | 6,128 | 138 | 26.09% | 0.301 | -1.240% |
| 60 | 20 | 7,568 | 168 | 25.60% | 0.350 | -1.199% |
| 60 | 18 | 8,597 | 191 | 26.70% | 0.409 | -1.011% |
| 60 | 15 | 10,340 | 235 | 25.11% | 0.375 | -1.098% |
| 60 | 12 | 12,084 | 273 | 23.44% | 0.354 | -1.098% |

The best tested proxy combination by expectancy and profit factor was 60/18, but it still lost **1.011% per candidate on average** and had PF 0.409. No tested combination had positive expectancy or PF ≥1.

```text
Net expectancy per candidate (all negative)
67 / 20  -1.317%  #############
65 / 20  -1.386%  ##############
63 / 18  -1.209%  ############
60 / 18  -1.011%  ##########
```

No threshold-specific portfolio drawdown is claimed. A reliable drawdown estimate requires chronological execution with overlapping positions, the five-position and one-position-per-market constraints, actual risk rejections, capital allocation, and a defined exit policy. Those inputs are not represented by this fixed-horizon signal proxy.

## 5. Closed-trade learning and indicator evidence

The three closed losses shared a bullish 1-hour trend and positive momentum at entry. Their 1-hour RSI values were approximately 67–73 and their 1-hour volume ratios were very low (0–0.07). The two open positions had 1-hour volume ratios of 1.34 and 1.73. This pattern is worth testing, but three losses and two unresolved positions are far too few to establish an entry filter.

In the 44-candidate baseline threshold proxy:

- All 44 samples had a bullish 1-hour trend; the trend condition did not distinguish profitable outcomes in that sample.
- RSI 60–69.99 was the least-negative measured band (12 samples, PF 0.717, expectancy -0.447%).
- RSI ≥70 was worse (24 samples, PF 0.226, expectancy -1.402%).
- High volatility was less negative than medium volatility (12 samples: PF 0.712, expectancy -0.578%; 32 samples: PF 0.136, expectancy -1.594%).
- None of the observed bands had positive expectancy. Small sample sizes and correlated market observations make these exploratory only.

EMA12/EMA26, MACD, momentum, and volume cannot be independently credited with predictive value from five actual entries. The baseline sample's uniformly bullish 1-hour trend also shows why an indicator being present in a BUY setup is not proof of predictive power.

## 6. Confidence model assessment

The deterministic engine combines timeframe and indicator scores; it also applies coverage/depth adjustments and a volatility penalty. The available production outcomes do not validate confidence as a calibrated probability of profit:

- The five actual entries clustered narrowly at 67.08–69.08 and all three resolved trades lost.
- In the cost-aware threshold proxy, the 67 cohort was worse than the 65 cohort on win rate and PF; reducing confidence to 60 increased candidate count but did not make any tested cohort profitable.
- The action-quality BUY sample averaged 67.72 confidence and returned -0.891% over four hours before costs.
- No stored strategy-performance or backtest records exist to provide an independent calibration baseline.

These results do not prove that the confidence formula is intrinsically too conservative or too aggressive. They show that a larger score is not demonstrated to mean a higher probability of profit in this short window. Component-level attribution (base score vs. strength weighting, coverage/depth bonuses, and volatility penalty) requires an ablation study on chronologically separated data; current production outcomes cannot isolate those contributions.

## 7. Shadow Exit Scenarios and Events

Production contained 35 scenarios (five positions × seven rules) and 67 events. Five hypothetical triggers were observed; event data quality was fresh. The three closed-trade comparisons available for actual-exit evaluation are limited to ARX; scenarios on open MEGA cannot be compared to a completed actual exit.

| Position / shadow rule | Modeled shadow result | Actual result | Difference vs. actual | Interpretation |
|---|---:|---:|---:|---|
| ARX / fixed TP +5% | +€58.52 | -€56.11 | +€114.63 | Best observed comparison |
| ARX / trailing stop, arm +5%, retrace 5% | +€3.79 | -€56.11 | +€59.90 | Reduced the observed loss |
| ARX / trailing stop, arm +5%, retrace 10% | -€27.44 | -€56.11 | +€28.67 | Reduced, but did not avoid, the loss |
| MEGA / fixed TP +5% | +€51.57 | Still open | Not comparable | Prospective mark only |
| MEGA / trailing stop, arm +5%, retrace 5% | +€7.77 | Still open | Not comparable | Prospective mark only |

The other tested scenarios did not trigger before the corresponding actual closes. ARX supplies one closed-position example in which shadow timing would have improved the marked result; it cannot support a population-level ranking, a premature-exit rate, or a portfolio-level drawdown comparison. The MEGA values are unrealized scenario marks, not realized gains. The shadow rules do not execute SELL orders or alter actual positions/trades.

## 8. Strategy records and evaluation gaps

At query time, the production strategy catalog, strategy-performance table, and backtest table each had **zero rows**. Consequently, the system has no stored strategy-level comparison, no reproducible backtest baseline, and no performance history with which to rank strategies. This is a material gap relative to the project goals for measurable strategy versions and comparable performance.

The following observability gap limits this investigation: per-decision paper-trading rejections (for example `CONFIDENCE_TOO_LOW`, `MAX_OPEN_POSITIONS`, `COOLDOWN`, stale decision, and drawdown gates) are not persisted as outcome records. Without them, the exact cause of each missed entry cannot be measured from production history.

## 9. Recommendations

| Priority | Proposal | Expected impact | Risk | Confidence |
|---:|---|---|---|---|
| 1 | Persist a compact, idempotent paper-execution outcome for each considered decision, including accepted/rejected status and gate reason. | Directly quantifies whether confidence, capacity, cooldown, freshness, balance, or drawdown controls constrain entries; improves BUY-scarcity diagnosis. | Additional database/write volume and schema work; keep records minimal and prefixed. | High that it closes the attribution gap. |
| 2 | Build a reproducible decision-label dataset with 1h/4h/24h forward returns, fees/slippage, and maximum favorable/adverse excursion; retain missing-data reasons. | Makes BUY/HOLD/WAIT and indicator comparisons measurable and supports calibrated confidence. | Lookahead/leakage risk unless features are frozen at decision time and evaluation is chronological. | High for measurement value; no guaranteed performance gain. |
| 3 | Do not lower confidence or market-strength thresholds based on this evidence. Run threshold changes only as versioned paper experiments with a holdout period and minimum sample size. | Avoids increasing trades based on larger but still negative proxy cohorts; preserves existing risk gates. | May leave some valid opportunities unused while the sample is weak. | High for the current observation window; low generalization across regimes. |
| 4 | Validate the ARX shadow-exit signal with a portfolio-aware, out-of-sample replay, including spread, actual risk sizing, and comparison to current exits. | Tests whether fixed TP/trailing exits reduce losses or merely sacrifice later upside. | A single ARX result may overfit; mark-based fills may overstate executable prices. | Low for expected trading benefit; high that further validation is needed. |
| 5 | Populate versioned strategy, performance, and backtest records before ranking or self-optimizing strategies. | Establishes a reproducible baseline and supports strategy comparison. | Backtests can mislead if candle coverage, fees, slippage, spread, and leakage controls are incomplete. | High for governance and measurement value. |
| 6 | Investigate RSI ≥70 and very low volume at entry as a hypothesis; do not activate a blocking rule without broader validation. | Could help detect weak momentum/chase entries if the observed pattern generalizes. | Three closed losses are an extremely small sample; a filter may suppress winners. | Low. |
| 7 | Monitor active-market freshness and candle coverage, especially the 1,031 WAIT rows caused by stale candle data. | Distinguishes lack of opportunity from lack of usable inputs and improves scanner coverage. | More refresh workload; stale data must continue to fail safely rather than force signals. | High for diagnosis; uncertain for profitability. |

## 10. Final verdict

| Question | Finding |
|---|---|
| A. Is the current strategy optimal? | **Not demonstrated.** The closed sample is losing, and strategy/backtest records are empty. |
| B. Is the current strategy too conservative? | **Partially plausible, not proven.** The entry count is low, but post-exit decisions were mostly SELL/HOLD and lower-threshold cohorts were still unprofitable. |
| C. Should entry logic be adjusted now? | **No threshold change supported.** Add attribution and validate out of sample first. |
| D. Should exit logic be adjusted now? | **Not yet.** ARX is a promising single-position shadow comparison, not a robust exit ranking. |
| E. Should the confidence model be adjusted now? | **Not yet.** Confidence is not calibrated by current evidence; run component ablation and chronological validation. |
| F. Does shadow evidence indicate superior alternatives? | **For one ARX exit only.** It does not establish a general alternative. |
| G. Is a hybrid approach recommended? | **Yes.** Keep paper-only risk controls, improve decision/rejection logging and outcome labeling, then test entry/exit hypotheses as versioned paper experiments. |

## Source notes

- Production evidence: read-only Supabase queries against AI decisions, paper trades, positions, portfolio snapshots, shadow scenarios/events, strategy records, and 15-minute candles, queried on 9 November 2026 UTC.
- Implementation context for thresholds, scoring, freshness, and shadow rules: [lib/ai-engine.mjs](../../lib/ai-engine.mjs), [lib/shadow-exits.mjs](../../lib/shadow-exits.mjs), and [lib/paper-trading.mjs](../../lib/paper-trading.mjs).
- Production risk-control documentation: [RISK_MANAGEMENT.md](../RISK_MANAGEMENT.md).
- No deployment or migration was performed as part of this evidence-only investigation.
