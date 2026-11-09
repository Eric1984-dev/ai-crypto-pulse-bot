# AI Indicator Attribution Analysis

**Production snapshot:** Supabase data queried 2026-11-09, approximately 07:26 UTC  
**Decision history:** 2026-11-01 05:57:38 UTC–2026-11-09 07:26:09 UTC  
**Scope:** Production AI decisions, paper trades, open positions, and 15-minute candles  
**Mode:** Read-only investigation. No code, thresholds, production data, or deployment were changed.

## Executive findings

- The decision history contains **234,192 decisions**, including **3,745 BUY decisions** across 31 symbols. Repeated BUY decisions are highly correlated observations, not independent trades.
- The clearest recurring relationship is with **1-day trend strength**. The Spearman correlation between 1-day EMA spread and net 24-hour forward return is **+0.391** across repeated rows and **+0.377** after de-duplicating to the latest BUY per symbol per 4-hour bucket. The related 1-day EMA direction correlation is **+0.345 / +0.271**. These associations are promising for further validation, but they do not prove profitability.
- **1-hour volume ratio** also ranks positively with 24-hour outcomes (**+0.187 raw / +0.343 de-duplicated**), but the relationship is nonlinear: the `0.50–1.00` bucket did better than low volume, while `>1.00` was still negative on average. Volume confirmation is not a standalone guarantee.
- **Daily volatility** and **daily RSI** show moderate positive 24-hour associations in both samples; results are much weaker or inconsistent at 4 hours. This may reflect the short period's market regimes rather than stable predictive value.
- **1-hour RSI, 1-hour EMA spread, Market Strength, and Confidence** have little consistent correlation with forward returns. Confidence and Market Strength do not show clear independent predictive value within BUY decisions.
- **MACD is low-information in its stored form**: the 1-hour MACD histogram is exactly zero in **70.4% of raw BUY rows** and **69.1% of the de-duplicated BUY sample**. Across intervals, 62.5%–82.7% of de-duplicated values are zero. The engine rounds stored MACD outputs to two decimal places, which can erase useful differences for low-priced assets.
- Actual execution history is too small for reliable attribution: **three closed BUY positions all lost**, with realized SELL P&L totaling **-€270.58**; two positions remain open, one currently positive and one negative. Their entry indicators overlap substantially, showing that the observed patterns do not yet separate winners from losers reliably.
- No tested combination is validated. The most favorable 24-hour combination (1-day EMA spread >1% and 1-hour volume ratio >1) has only **9 paired de-duplicated outcomes**, concentrated in three symbols; its positive average is dominated by two large winners, while 4-hour results remain negative.

## Data and method

### Production population

| Decision | Rows | Symbols | First recorded | Last recorded |
|---|---:|---:|---|---|
| BUY | 3,745 | 31 | 2026-11-01 11:15:44 UTC | 2026-11-09 05:56:08 UTC |
| HOLD | 179,779 | 102 | 2026-11-01 06:15:26 UTC | 2026-11-09 07:26:09 UTC |
| SELL | 44,993 | 95 | 2026-11-01 11:15:44 UTC | 2026-11-09 07:26:09 UTC |
| WAIT | 5,675 | 101 | 2026-11-01 05:57:38 UTC | 2026-11-09 07:26:09 UTC |

The primary attribution population is BUY decisions, since the question concerns BUY-entry quality. This conditions the analysis on the engine already having selected BUY and therefore restricts the range of its inputs.

### Forward-return proxy

- Entry reference: first 15-minute candle close at or after the decision, no more than 30 minutes later.
- Horizons: 4 and 24 hours after that entry candle; the target close must fall within a 30-minute tolerance.
- Net return applies the observed paper-trading fee (0.25%) and adverse slippage (0.10%) to both entry and exit:
  `((exit × 0.9975 × 0.999) / (entry × 1.0025 × 1.001) − 1) × 100`.
- Historical spread is unavailable and is not included. These are candle-based forward-return proxies, not executed-trade P&L or a portfolio backtest.
- All BUY rows with a complete horizon yielded **3,283 paired 4-hour** and **3,086 paired 24-hour** outcomes.
- To reduce repeated-signal weighting, a second sample retains only the latest BUY per symbol in each fixed 4-hour bucket: **168 candidates**, of which **145** had a paired 4-hour outcome and **133** a paired 24-hour outcome. This reduces overlap but does not make market observations statistically independent.
- Correlation is Spearman rank correlation against net forward return. Positive values mean higher indicator readings tended to rank with better returns; negative values mean the opposite. Small values indicate little monotonic relationship, not proof of no nonlinear effect.

## Overall BUY outcome and executed-trade evidence

The repeated-row BUY sample averaged **-1.164% net at 4 hours** and **-3.184% at 24 hours**. The de-duplicated sample averaged **-1.407% at 4 hours** and **-3.683% at 24 hours**. The short forward-return results are negative overall; they should not be confused with realized strategy performance.

Production paper-trade records contained five BUY executions and three SELL executions. All three closed positions were losses:

| Closed position | Entry RSI 1h | Entry 1h momentum | Entry 1h EMA spread | Entry 1h volume ratio | Entry confidence | Realized SELL P&L |
|---|---:|---:|---:|---:|---:|---:|
| ARX-EUR | 68.10 | +6.06% | +1.39% | 0.01 | 67.31 | -€56.11 |
| POL-EUR | 67.41 | +3.33% | +1.51% | 0.07 | 67.08 | -€65.74 |
| SXT-EUR | 72.90 | +3.48% | +1.09% | 0.00 | 67.51 | -€148.72 |

The three losing entries all had bullish 1-hour EMA direction, positive momentum, and a 1-hour volume ratio below 0.10. This is a recurring pattern in this tiny realized sample, not a validated rejection rule. The open MEGA-EUR position currently has positive unrealized P&L (+€36.25) while sharing several of those characteristics—RSI 72.75, positive momentum, bullish EMA direction, and a 1-hour MACD histogram of zero. The other open position, WIN-EUR, is currently negative (-€13.38), despite a 1-hour volume ratio of 1.73. Thus high RSI, bullish EMA direction, and positive momentum alone do not distinguish the observed open winner from losers.

Closed SELL P&L totals **-€270.58**. Open-position marks are current unrealized values and are not realized wins or losses.

## Indicator correlation and ranking

The following table compares repeated decision rows with the de-duplicated sample. Correlations use the listed timeframe; the forward horizon is the table column. All values are Spearman `rho`.

| Input | Timeframe / measure | 4h raw / de-duplicated | 24h raw / de-duplicated | Attribution reading |
|---|---|---:|---:|---|
| RSI | 1d RSI | -0.042 / -0.014 | +0.245 / +0.226 | Moderate positive long-horizon association; little 4h association. |
| RSI | 1h RSI | +0.046 / -0.033 | -0.068 / -0.060 | Near zero; weak evidence for 1h RSI as a standalone discriminator. |
| MACD | 1d normalized histogram | +0.006 / +0.017 | -0.274 / -0.079 | Stronger negative raw-row association largely disappears after de-duplication. |
| MACD | 1h normalized histogram | +0.089 / +0.063 | -0.155 / -0.035 | Weak and inconsistent; the stored value is frequently zero. |
| EMA trend strength | 1d EMA spread | +0.113 / +0.132 | +0.391 / +0.377 | Strongest and most stable association in this sample, primarily at 24h. |
| EMA direction | 1d bullish/bearish | +0.099 / +0.062 | +0.345 / +0.271 | Supports the daily EMA-spread result, but remains observational. |
| EMA trend strength | 1h EMA spread | +0.049 / +0.038 | +0.047 / -0.084 | Little consistent attribution at 1h. |
| Momentum | 1h change percentage | -0.128 / -0.109 | +0.034 / +0.007 | More positive short-term momentum did not predict better 4h returns; no meaningful 24h relation. |
| Volume ratio | 1h volume ratio | -0.051 / +0.066 | +0.187 / +0.343 | Positive rank association at 24h, but bucket outcomes are nonlinear and mostly negative. |
| Volume ratio | 15m volume ratio | -0.029 / +0.249 | +0.049 / +0.176 | Some positive de-duplicated association; raw rows do not show the same short-horizon result. |
| Volume ratio | 1d volume ratio | -0.076 / — | -0.144 / -0.157 | Higher daily volume ratio did not map to better 24h outcomes in either sample. |
| Volatility | 1d ATR percentage | +0.062 / +0.074 | +0.301 / +0.222 | Moderate positive association at 24h; not present at 4h. |
| Volatility | 1h ATR percentage | -0.035 / +0.003 | -0.035 / +0.003 | Essentially no monotonic relationship at either horizon. |
| Market Strength | Overall score | -0.060 / -0.091 | +0.104 / +0.012 | Weak; the small raw 24h association vanishes after de-duplication. |
| Confidence | Confidence score | -0.018 / -0.010 | +0.012 / +0.019 | No meaningful monotonic relationship with profitability in BUY rows. |

### Predictive-value ranking

For 24-hour return, ranked by absolute de-duplicated Spearman correlation:

1. **1d EMA spread: +0.377**
2. **1h volume ratio: +0.343**
3. **1d EMA direction: +0.271**
4. **1d RSI: +0.226**
5. **1d ATR volatility: +0.222**
6. **15m volume ratio: +0.176**

These are relative associations, not validated predictors. In the 4-hour sample, the leading de-duplicated relationships change: 5-minute EMA spread is negative (`rho=-0.261`), 15-minute volume ratio is positive (`+0.249`), and 15-minute RSI is negative (`-0.200`). The change in ordering and direction across horizons warns against treating one ranking as universal.

## Winning and losing indicator ranges

All results below use the de-duplicated candidate sample and net 24-hour forward returns unless otherwise stated.

### Daily EMA trend strength

| 1d EMA spread at BUY | Candidates | Paired outcomes | Mean net return | Win rate | Profit factor |
|---|---:|---:|---:|---:|---:|
| Bearish | 111 | 94 | -4.953% | 19.15% | 0.112 |
| Bullish, spread <=1% | 18 | 15 | -2.830% | 13.33% | 0.116 |
| Bullish, spread >1% | 39 | 24 | +0.754% | 45.83% | 1.257 |

This is the clearest favorable subgroup. However, the 24 paired outcomes with spread above 1% came from only **four symbols**: CAP-EUR (13 outcomes, +2.265% mean), WIN-EUR (7, -0.443%), MEGA-EUR (3, +1.986%), and BEAM-EUR (1, -14.215%). The apparently favorable average is highly sensitive to symbol mix and includes a single large loss.

### 1-hour volume ratio

| Volume ratio | Paired outcomes | Mean net return | Win rate | Profit factor |
|---|---:|---:|---:|---:|
| <0.10 | 46 | -6.072% | 15.22% | 0.152 |
| 0.10–<0.50 | 31 | -3.489% | 25.81% | 0.275 |
| 0.50–1.00 | 11 | -1.252% | 27.27% | 0.375 |
| >1.00 | 45 | -1.970% | 28.89% | 0.376 |

Low volume (<0.10) is the weakest group in this sample. Higher ratios performed better on average, but every bucket remained negative and the relationship is not monotonic: `0.50–1.00` had a less negative mean than `>1.00`. The three closed losing entries all had low 1-hour volume, but one open profitable position also has high volume and one open losing position has high volume.

### RSI, momentum, volatility, strength, and confidence

| Input range | Paired 24h outcomes | Mean net return | Win rate | Profit factor |
|---|---:|---:|---:|---:|
| 1h RSI 50–<60 | 22 | -2.714% | 31.82% | 0.207 |
| 1h RSI 60–<70 | 40 | -3.989% | 27.50% | 0.261 |
| 1h RSI >=70 | 68 | -3.650% | 19.12% | 0.246 |
| 1h momentum <0% | 14 | -3.047% | 28.57% | 0.387 |
| 1h momentum 0–2% | 39 | -4.261% | 17.95% | 0.113 |
| 1h momentum >2% | 80 | -3.513% | 25.00% | 0.271 |
| Market Strength 20–<40 | 115 | -3.968% | 21.74% | 0.159 |
| Market Strength >=40 | 18 | -1.868% | 33.33% | 0.664 |
| Confidence <67 | 95 | -4.013% | 22.11% | 0.167 |
| Confidence 67–<70 | 30 | -3.860% | 23.33% | 0.299 |
| Confidence >=70 | 8 | +0.887% | 37.50% | 1.363 |
| 1h ATR volatility 0.5–<2% | 104 | -3.790% | 21.15% | 0.148 |
| 1h ATR volatility >=2% | 29 | -3.302% | 31.03% | 0.468 |

**RSI >70 is not shown to be harmful on its own.** Its 24-hour mean is slightly less negative than the 60–70 group, though its win rate is lower; neither group is profitable. Actual closed losses often entered with elevated RSI, but the currently profitable MEGA-EUR position entered at a similarly high RSI.

Higher Market Strength and confidence buckets look relatively better here, but the >=70 confidence bucket has only eight paired outcomes and Market Strength is already part of the decision-generation process. Neither result establishes a reliable threshold effect. The 1-hour volatility buckets are both negative; their small relative difference is not a dependable volatility edge.

## MACD resolution and noise

MACD histogram zero rates among BUY decisions, after interpreting the stored values numerically:

| Interval | Zero among all 3,745 BUY rows | Zero among 168 de-duplicated candidates |
|---|---:|---:|
| 1m | 84.19% | 82.74% |
| 5m | 80.27% | 77.98% |
| 15m | 72.34% | 73.81% |
| 1h | 70.44% | 69.05% |
| 4h | 64.11% | 62.50% |
| 1d | 64.19% | 63.10% |

The production records also show only 45 distinct numeric 1-hour histogram values across 3,745 BUY rows and 23 among the de-duplicated sample. All five executed BUY entries had a zero 1-hour MACD histogram. The engine's `round()` helper stores indicator values to two decimal places, so absolute MACD differences below the rounding resolution are lost before attribution; dividing the stored value by price afterward cannot recover them. This is particularly relevant to small-price markets.

MACD's 1-day 24-hour raw correlation (`-0.274`) weakens to `-0.079` after de-duplication. The observed negative/positive/zero buckets do not provide a stable separation, and the zero-heavy representation makes MACD the clearest candidate for low signal quality in its current stored form.

## Indicator combinations

| De-duplicated filter | 24h paired N | Mean net return | Win rate | Profit factor | 4h mean |
|---|---:|---:|---:|---:|---:|
| All BUY candidates | 133 | -3.683% | 23.31% | 0.238 | -1.407% |
| 1d bullish | 39 | -0.625% | 33.33% | 0.794 | -0.960% |
| 1d bullish AND 1h volume >0.50 | 17 | -0.012% | 29.41% | 0.992 | -1.381% |
| 1d bullish AND 1h volume >0.50 AND 1h momentum >0 | 15 | +0.288% | 33.33% | 1.189 | -1.452% |
| 1d EMA spread >1% AND 1h volume >1 | 9 | +2.020% | 55.56% | 3.039 | -2.087% |

The final combination is the best observed 24-hour result, but it is not robust evidence of superiority: its nine paired cases cover only CAP-EUR (one +17.331% outcome), MEGA-EUR (one +3.953% outcome), and WIN-EUR (seven outcomes averaging -0.443%, with three wins and four losses). The two large positive cases drive the aggregate. Its 4-hour mean remains negative. The less restrictive 1-day bullish + volume filter is essentially flat at 24 hours and negative at 4 hours. No combination consistently improves both horizons with an adequate, broadly distributed sample.

## Indicator-by-indicator assessment

| Indicator | Appears in losing situations | Appears in better situations | Current attribution |
|---|---|---|---|
| RSI | 1h RSI >=70 had a 19.12% 24h win rate; two of three closed losers entered above 70. | 1d RSI has a positive 24h rank association; elevated RSI also appears in the open profitable MEGA position. | 1h RSI is weak and cannot separate actual winner from losers; no standalone overbought conclusion. |
| MACD | Zero histogram is common in all intervals; the few nonzero values do not produce stable outcome separation. | No robust profitable MACD bucket identified. | Low-information/noisy as currently persisted; two-decimal rounding is a plausible data-resolution limitation. |
| EMA trend strength | Bearish 1d spread was associated with the worst 24h outcome; the closed losing entries nevertheless had bullish 1h spreads. | 1d spread >1% is the strongest candidate subgroup; daily direction and spread correlations persist after de-duplication. | Best-supported association, but highly sensitive to timeframe, symbol mix, and small sample. |
| Momentum | Strong positive 1h momentum was present at all three closed losing entries; >2% did not improve 24h results. | Slightly better relative outcomes for >2% than 0–2%, still negative. | Not a consistent standalone predictor; short-horizon correlations are weak and negative. |
| Volume ratio | All three closed losers had 1h ratios <0.10; low-volume bucket had the worst 24h metrics. | Mid/high ratios were less negative; 1h volume ratio has a positive 24h de-duplicated correlation. | Potentially useful confirmation signal, but nonlinear and insufficient alone. |
| Volatility | Most 1h ATR cases remained negative; 1h correlations are near zero. | Daily ATR has a positive 24h association in raw and de-duplicated samples. | Horizon-dependent; no stable 1h volatility edge. |
| Market Strength | BUY-only outcomes are mostly in the 20–40 range and remain poor; 4h correlation is negative. | >=40 bucket is relatively less negative at 24h. | Weak after de-duplication; restricted range and overlap with constituent indicators limit attribution. |
| Confidence | Most observations below 70 remain net negative; correlation is near zero. | >=70 bucket is positive in eight 24h cases. | No reliable evidence of independent predictive value; the apparent high-confidence edge is too small to trust. |

## Limitations

- The history covers only about eight days and includes multiple market regimes, a changing BUY population, and many repeated decisions.
- The de-duplicated sample is still small and clustered by symbol/time. Selecting among many intervals and indicators makes the strongest observed correlations prone to multiple-testing noise.
- Correlations are conditional on BUY decisions. They cannot establish what would happen among HOLD/WAIT decisions or if the BUY-generation logic changed.
- Market Strength is a composite of timeframes and market context; Confidence is derived from score magnitude, data coverage/depth, and volatility penalty. They are not independent predictors. Implementation definitions were checked in [the AI Engine](../../lib/ai-engine.mjs); production decision values remain the empirical source for this report.
- Forward candle returns do not reproduce the Risk Manager, position limits, cooldowns, execution timing, actual order sizing, or actual exit logic. The cost model uses configured/observed paper fees and slippage, not historical spread.
- Actual realized trade attribution has only three closed losing positions and no closed winners. Open-position P&L can change and is not realized performance.
- No statistical significance or out-of-sample validation is claimed.

## Evidence-only conclusion

Among the requested inputs, **1-day EMA spread/direction has the strongest repeatable association with 24-hour BUY outcomes**, and **1-hour volume ratio is a secondary, nonlinear candidate**. **Daily RSI and daily volatility** also show moderate long-horizon associations, but short-horizon values and other intervals are inconsistent. **MACD's stored precision, 1-hour RSI, 1-hour momentum, Market Strength, and Confidence provide little robust separation** in this short BUY-only history.

The evidence does not establish an optimal indicator set or justify changing any threshold. The favorable daily-trend/volume combinations are small, concentrated, and horizon-sensitive; they require a longer, pre-specified, out-of-sample evaluation before being treated as predictive.
