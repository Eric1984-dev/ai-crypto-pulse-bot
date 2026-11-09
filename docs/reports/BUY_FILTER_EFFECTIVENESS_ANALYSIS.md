# BUY Filter Effectiveness Analysis

**Production query window:** 2026-11-01 05:57 UTC through 2026-11-09 07:16 UTC  
**Primary evidence:** all production `AI_Crypto_Bot_AI_Decisions` rows and paired production 15-minute candles  
**Read-only:** no code, thresholds, database contents, or deployment were changed

## Executive summary

The full stored history contains **233,988 AI decisions**, including **3,745 BUY decision rows** across 31 symbols. These are repeated decisions, not 3,745 independent trades.

The results support higher-timeframe alignment as a promising quality filter in this short history. BUY decisions with bullish 1-hour and bearish 1-day trends underperformed BUY decisions with both trends bullish:

- On the full decision-row sample, net mean return was **-1.462% vs. -0.666% at 4 hours**, and **-5.057% vs. -0.155% at 24 hours**.
- After reducing repeated rows to the latest BUY per symbol per 4-hour bucket, the corresponding means were **-1.576% vs. -0.983% at 4 hours**, and **-4.953% vs. -0.544% at 24 hours**.
- All group means remained negative; the aligned group did not establish a profitable edge.

Volume ratio does not show a simple “more volume is always better” relationship. The `>1.00` bucket had the worst 4-hour raw-row mean return (-1.343%); the `0.50–1.00` bucket had the highest raw-row 4-hour win rate (34.51%) but still had PF 0.289 and mean return -0.883%. Results vary by horizon and by row-vs-opportunity sample.

Filter A (1-day bullish) improved average forward returns relative to all BUY rows at both horizons in both samples, but retained only **42.6% of raw BUY rows** and **33.9% of the de-duplicated opportunities**; it remained net negative. Filter B (1-hour volume >0.50) had mixed raw-row results and modestly better de-duplicated averages, but remained net negative. Filter C showed a positive 24-hour mean on repeated rows (+0.222%), but that result fell to **-0.012% with PF 0.992** after de-duplication, while retaining only 16.1% of candidate opportunities. No filter has sufficiently robust evidence for activation.

## 1. History and methodology

### Population

The complete stored AI decision history ran from **2026-11-01 05:57:38 UTC** through **2026-11-09 07:16:09 UTC**. It contained 233,988 decisions and 3,745 BUY decisions. BUY rows covered 31 distinct symbols.

### Forward-return calculation

- Entry: the close of the first 15-minute candle at or after the decision, no more than 30 minutes later.
- Horizons: 4 hours and 24 hours from that entry candle; the target close was accepted within a 30-minute tolerance.
- Net return: adverse slippage and fee applied on both entry and exit. Production trade rows showed weighted fees of 0.25% and slippage of approximately 0.10% on each side.
- Historical bid/ask spread is unavailable and is not included.
- Win rate is the share of paired forward returns above zero **after** modeled costs.
- Profit factor (PF) is the sum of positive net returns divided by the absolute sum of negative net returns.
- Recent decisions can lack a complete 4-hour or 24-hour candle window; paired sample counts are shown explicitly.

Because the database records repeated BUY decisions for the same symbol, row-based statistics over-weight persistent signals and highly correlated market periods. Alongside all BUY rows, the report therefore includes a robustness sample containing only the latest BUY for each symbol in each 4-hour bucket. This is a de-duplication check, not a portfolio backtest or an execution replay.

### Volume bucket boundaries

Buckets are mutually exclusive: **<0.10**, **[0.10, 0.50)**, **[0.50, 1.00]**, and **>1.00**. Filter B uses the strict condition **volume ratio >0.50**, so a value exactly 0.50 is in the `[0.50, 1.00]` descriptive bucket but does not pass Filter B.

## 2. Alignment frequency and decision characteristics

| BUY group | Raw BUY rows | Share of BUY rows | Distinct symbols | Mean confidence | Mean market strength |
|---|---:|---:|---:|---:|---:|
| Bullish 1h + bullish 1d | 1,593 | 42.5% | 8 | 67.81 | 37.60 |
| Bullish 1h + bearish 1d | 2,149 | 57.4% | 26 | 67.20 | 33.61 |
| Other / incomplete alignment | 3 | 0.1% | 1 | — | — |
| **All BUY decisions** | **3,745** | **100%** | **31** | **67.46** | **35.31** |

The aligned BUY group had slightly higher mean confidence and market strength. The history is also highly regime-dependent: bearish-daily BUY rows were concentrated on 4–6 November, while all 128 BUY rows recorded on 8 November were bullish on both timeframes. Consequently, the group comparison is confounded by time and market regime; it does not isolate a causal trend-alignment effect.

## 3. Forward performance by trend alignment

All returns below are net of the modeled fees and slippage. “Paired” is the number of BUY observations with valid candles at that horizon.

| Sample | BUY group | Decisions | Paired 4h | Mean net 4h | Win rate 4h | PF 4h | Paired 24h | Mean net 24h | Win rate 24h | PF 24h |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| All decision rows | Bullish 1h + bullish 1d | 1,593 | 1,235 | -0.666% | 31.09% | 0.529 | 1,178 | -0.155% | 42.11% | 0.941 |
| All decision rows | Bullish 1h + bearish 1d | 2,149 | 2,041 | -1.462% | 22.20% | 0.255 | 1,905 | -5.057% | 18.06% | 0.083 |
| Latest BUY / symbol / 4h | Bullish 1h + bullish 1d | 56 | 41 | -0.983% | 24.39% | 0.401 | 38 | -0.544% | 34.21% | 0.820 |
| Latest BUY / symbol / 4h | Bullish 1h + bearish 1d | 111 | 102 | -1.576% | 22.55% | 0.231 | 94 | -4.953% | 19.15% | 0.112 |

The bearish-daily group is weaker at both horizons in both samples, especially at 24 hours. The alignment does not make the bullish/bullish sample profitable: all its average returns remain negative and PF remains below 1. The raw-row win-rate/PF advantage is smaller after de-duplication, which is a warning against treating repeated decision rows as independent evidence.

## 4. 1-hour volume ratio buckets

The full history has a numeric 1-hour volume ratio on all 3,745 BUY rows. Repeated-row forward performance:

| 1h volume ratio | BUY rows | Distinct symbols | Paired 4h | Mean net 4h | Win rate 4h | PF 4h | Paired 24h | Mean net 24h | Win rate 24h | PF 24h |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <0.10 | 1,316 | 23 | 1,259 | -1.033% | 20.57% | 0.380 | 1,208 | -4.352% | 18.79% | 0.207 |
| 0.10–<0.50 | 662 | 19 | 611 | -1.197% | 29.62% | 0.454 | 542 | -2.854% | 36.53% | 0.442 |
| 0.50–1.00 | 279 | 11 | 255 | -0.883% | 34.51% | 0.289 | 234 | -2.862% | 26.50% | 0.253 |
| >1.00 | 1,488 | 18 | 1,154 | -1.343% | 26.86% | 0.225 | 1,102 | -2.134% | 32.03% | 0.292 |

De-duplicated latest-BUY-per-symbol/4-hour results:

| 1h volume ratio | Candidate rows | Paired 4h | Mean net 4h | Win rate 4h | PF 4h | Paired 24h | Mean net 24h | Win rate 24h | PF 24h |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <0.10 | 55 | 49 | -1.562% | 22.45% | 0.272 | 46 | -6.072% | 15.22% | 0.152 |
| 0.10–<0.50 | 41 | 36 | -1.846% | 22.22% | 0.238 | 31 | -3.489% | 25.81% | 0.275 |
| 0.50–1.00 | 15 | 13 | -0.734% | 30.77% | 0.306 | 11 | -1.252% | 27.27% | 0.375 |
| >1.00 | 57 | 46 | -1.057% | 21.74% | 0.310 | 45 | -1.970% | 28.89% | 0.376 |

The 0.50–1.00 bucket has the best 4-hour average and win rate in both samples, but its PF is far below 1 and its 24-hour mean is negative. The >1.00 bucket does not consistently outperform the lower buckets: its repeated-row 4-hour mean is the worst of the four, and its de-duplicated 4-hour win rate is the lowest. Higher volume alone is not a robust profitability filter.

## 5. Candidate filter simulations

Filter counts apply to **all 3,745 historical BUY rows**. De-duplicated counts are the number of latest BUY decisions per symbol per 4-hour bucket that pass the same filter. “Removed” means excluded from the respective candidate population.

| Filter | Raw BUY rows retained | Raw rows removed | De-duplicated retained | De-duplicated removed |
|---|---:|---:|---:|---:|
| A: 1d trend bullish | 1,596 (42.6%) | 2,149 (57.4%) | 57 / 168 (33.9%) | 111 / 168 (66.1%) |
| B: 1h volume ratio >0.50 | 1,767 (47.2%) | 1,978 (52.8%) | 72 / 168 (42.9%) | 96 / 168 (57.1%) |
| C: 1d bullish AND volume ratio >0.50 | 821 (21.9%) | 2,924 (78.1%) | 27 / 168 (16.1%) | 141 / 168 (83.9%) |

Filter A includes three rows whose 1-day trend was bullish but whose 1-hour trend was not bullish; the exact bullish/bullish group contains 1,593 rows.

Mean score characteristics for the same filter populations:

| Population | Mean confidence | Mean market strength |
|---|---:|---:|
| All raw BUY rows | 67.46 | 35.31 |
| Filter A raw rows | 67.81 | 37.59 |
| Filter B raw rows | 67.11 | 34.32 |
| Filter C raw rows | 67.16 | 34.87 |
| All de-duplicated candidates | 66.62 | 32.80 |
| Filter A de-duplicated | 67.13 | 35.10 |
| Filter B de-duplicated | 66.66 | 32.73 |
| Filter C de-duplicated | 67.08 | 34.48 |

### Net performance of each filter

| Sample | Population | Paired 4h | Mean net 4h | Win rate 4h | PF 4h | Paired 24h | Mean net 24h | Win rate 24h | PF 24h |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| All rows | Baseline: all BUYs | 3,279 | -1.161% | 25.56% | 0.338 | 3,086 | -3.184% | 27.22% | 0.279 |
| All rows | Filter A | 1,238 | -0.664% | 31.10% | 0.529 | 1,181 | -0.162% | 42.00% | 0.939 |
| All rows | Filter B | 1,409 | -1.259% | 28.25% | 0.234 | 1,336 | -2.262% | 31.06% | 0.284 |
| All rows | Filter C | 512 | -1.021% | 29.69% | 0.291 | 492 | +0.222% | 48.98% | 1.161 |
| De-duplicated | Baseline: latest BUY / symbol / 4h | 144 | -1.397% | 22.92% | 0.273 | 133 | -3.683% | 23.31% | 0.238 |
| De-duplicated | Filter A | 42 | -0.960% | 23.81% | 0.400 | 39 | -0.625% | 33.33% | 0.794 |
| De-duplicated | Filter B | 59 | -0.986% | 23.73% | 0.309 | 56 | -1.829% | 28.57% | 0.376 |
| De-duplicated | Filter C | 18 | -1.381% | 22.22% | 0.213 | 17 | -0.012% | 29.41% | 0.992 |

### Expected impact assessment

- **Filter A — bullish 1-day trend:** Best and most consistent improvement relative to the corresponding baseline, especially at 24 hours. It still has negative mean return and PF <1 in both samples, and it discards a majority of raw rows and two-thirds of de-duplicated opportunities.
- **Filter B — volume ratio >0.50:** In the full row sample it slightly worsens the 4-hour mean/PF while improving the 24-hour mean. The de-duplicated averages improve versus baseline but remain negative. This is mixed evidence rather than a reliable profitability gain.
- **Filter C — bullish 1-day trend plus volume >0.50:** The repeated-row 24-hour result is positive, but the comparable de-duplicated result is -0.012% with PF 0.992, only 17 paired observations across a highly reduced set. Its 4-hour result remains negative and weaker than baseline in the de-duplicated sample. The apparent 24-hour edge is not robust to de-duplication.

## 6. Opportunity-count and evidence quality

Filter C removes **78.1% of recorded BUY rows** and **83.9% of de-duplicated opportunities**, leaving only 27 opportunities across seven symbols in the de-duplicated sample. That is a substantial reduction without a stable positive net result. Filters A and B also remove more than half of opportunities, though Filter A shows the clearest relative quality improvement.

The alignment and volume distributions changed sharply across the eight-day window. For example, bullish-1h/bearish-1d BUY rows increased from 98, 89, and 35 on 1–3 November to 658, 681, and 507 on 4–6 November; there were none on 8 November. This concentration means filter outcomes are entangled with the dates and market conditions in which each filter passed.

## Conclusion and recommendation

1. **Higher-timeframe alignment is the strongest candidate filter.** Bullish-1h/bearish-1d BUYs underperformed bullish/bullish BUYs at both forward horizons, including in the de-duplicated sample. However, the aligned group has no positive average net return yet, and the sample is short and regime-clustered.
2. **Volume confirmation alone is not established.** The 0.50–1.00 bucket has some better short-horizon metrics, but all bucket averages remain negative and >1.00 is not consistently better. Filter B's gains are horizon- and sample-dependent.
3. **The combined filter is too restrictive for the evidence obtained.** It retains only 16.1% of de-duplicated candidates and has no robust positive return after de-duplication.
4. **No filter should be activated on this evidence alone.** Treat Filter A as the first hypothesis for continued paper-only monitoring; evaluate it on a later, non-overlapping period and report unique-symbol opportunities alongside raw decision rows. Do not describe the raw-row Filter C 24-hour result as an established edge.

All return results are historical forward-return proxies on stored BUY decisions, not realized trade performance or a portfolio simulation. They do not model position limits, overlapping positions, rejected entries, cash allocation, exits, or historical spread.
