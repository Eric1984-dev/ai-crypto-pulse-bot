# Trade Pattern and Exit Analysis

**Production observation time:** 2026-11-09 00:48 UTC  
**Evidence:** read-only queries against live production Supabase  
**Scope:** AI BUY decisions linked to paper BUY trades, resulting positions and closes, and all stored shadow-exit scenarios/events  
**Changes:** none to code, thresholds, deployment, or database contents

## Executive findings

There are five BUY entries in this sample: three have closed, and all three closed at a loss (total **-€270.58**); two remain open. There is therefore **no completed profitable BUY** to compare against. MEGA is a provisionally profitable open position (+€29.94 at the observation time), while WIN is open at -€14.28. Open P&L is not a final outcome.

The strongest entry-pattern associations in this very small sample are:

1. **Daily trend alignment:** all three closed losers had a bearish 1-day EMA trend at entry; both still-open positions had bullish 1-day trends. This is the cleanest separation, but the open losing position shows that bullish daily trend does not guarantee profit.
2. **Very low 1-hour volume ratio:** all three closed losers entered with 1-hour volume ratios from 0.00 to 0.07; both open positions were above 1.3. This is the clearest volume association in the five entries. It does not prove that low volume caused the losses or that high volume is sufficient for a good trade.
3. **Short-term overbought RSI is not a reliable standalone loss signal:** all three closed losses had 15-minute RSI above 75, but the currently profitable MEGA position also entered with 15-minute RSI above 70. WIN is currently losing despite entry RSI below 70 on 1-hour and 15-minute frames.

Within the seven shadow rules, **fixed take-profit +5% ranks first in this sample**. Applied counterfactually to the three closed positions, it would have improved aggregate modeled P&L by €114.63, although the three-position result would still be -€155.94. This is evidence for further paper testing, not proof of a generally superior exit. The other shadow rules improved the closed-position total by less or not at all.

## 1. Production trades and entry characteristics

Actual closed outcomes include the recorded simulated execution costs. Indicator values below are taken from the AI decision linked to each BUY trade, at entry. Trend strength is the engine's EMA12/EMA26 percentage spread; volume ratio is the latest candle volume relative to the preceding volume average.

| Entry | Confidence | Market strength | 1h RSI | 1h volume ratio | 1h ATR / volatility | 1h momentum | 1h trend / spread | 1d trend / spread | Outcome at observation |
|---|---:|---:|---:|---:|---|---|---|---|---:|
| WIN-EUR | 68.52 | 38.22 | 58.66 | 1.73 | 1.58% / medium | +1.52%, weakening | Bullish / +1.40% | Bullish / +7.88% | Open: -€14.28 |
| MEGA-EUR | 69.08 | 37.94 | 72.75 | 1.34 | 1.69% / medium | +5.67%, accelerating | Bullish / +1.80% | Bullish / +0.81% | Open: +€29.94 |
| ARX-EUR | 67.31 | 35.03 | 68.10 | 0.01 | 1.40% / medium | +6.06%, accelerating | Bullish / +1.39% | Bearish / -2.40% | Closed: -€56.11 |
| POL-EUR | 67.08 | 30.90 | 67.41 | 0.07 | 1.15% / medium | +3.33%, accelerating | Bullish / +1.51% | Bearish / -2.49% | Closed: -€65.74 |
| SXT-EUR | 67.51 | 37.32 | 72.90 | 0.00 | 1.08% / medium | +3.48%, accelerating | Bullish / +1.09% | Bearish / -1.51% | Closed: -€148.72 |

The three closed entries were opened on 4 November; WIN was opened on 2 November. ARX and POL were opened in the same paper-trading run, so the three losses are not independent samples and may share the same market regime.

### Factor ranges by current outcome group

| Factor at entry | Three closed losers | Open profitable: MEGA | Open losing: WIN | Interpretation |
|---|---|---|---|---|
| Confidence | 67.08–67.51 (median 67.31) | 69.08 | 68.52 | Slightly higher for the open positions, but the groups overlap in practical meaning; too few observations to infer predictive value. |
| Market strength | 30.90–37.32 (median 35.03) | 37.94 | 38.22 | No clear separation; the open loser has the highest value. |
| 1h RSI | 67.41–72.90 (median 68.10) | 72.75 | 58.66 | RSI >70 appears in one closed loser and the open winner; the open loser is below 70. Not a reliable standalone rule. |
| 15m RSI | 75.78–80.77 (median 78.88) | 71.21 | 69.27 | All closed losers were high, but MEGA is also above 70 and remains open/profitable. |
| 1h volume ratio | 0.00–0.07 (median 0.01) | 1.34 | 1.73 | Strongest volume separation: all three closed losers were exceptionally low-volume; neither open position was. |
| 15m volume ratio | 0.03–0.30 (median 0.09) | 0.76 | 0.02 | Supports a weak-volume hypothesis, but the open loser is also very low on this interval. |
| 1h ATR / volatility | 1.08–1.40% / all medium | 1.69% / medium | 1.58% / medium | No category separation. |
| 1h momentum | +3.33% to +6.06%, all accelerating | +5.67%, accelerating | +1.52%, weakening | Positive accelerating momentum did not prevent the three realized losses; the open positions are still unresolved. |
| 1h trend spread | +1.09% to +1.51%, all bullish | +1.80%, bullish | +1.40%, bullish | The entry timeframe itself does not separate losses from open outcomes. |
| 1d trend spread | -2.49% to -1.51%, all bearish | +0.81%, bullish | +7.88%, bullish | Clearest trend-alignment split for closed versus open positions; not a profit guarantee. |

### RSI, volume, volatility, and trend by timeframe

- **RSI >70:** At 1 hour, only SXT among the three closed losers exceeded 70; MEGA also exceeded 70 and is currently profitable. At 15 minutes, all three closed losers were above 75, but MEGA was 71.21. Thus RSI >70 may be a context signal, especially alongside other weak-entry conditions, but the production sample does not support a hard RSI ceiling.
- **Low volume:** The 1-hour ratios of 0.00–0.07 for all three closed losers stand out. At 5 minutes, ARX/POL/SXT were 0.04/0.48/0.46, while WIN was also 0.04 and is currently losing. At 15 minutes, WIN was 0.02. Low volume is therefore strongly associated with the *closed losing cohort* at 1 hour, but not sufficient to classify every open trade.
- **High volume:** Both open positions had 1-hour ratios above 1.3, but WIN is currently losing. Higher volume may be useful as confirmation; it is not sufficient evidence of a good entry.
- **Volatility:** All five positions had medium 1-hour ATR volatility (1.08–1.69%). All five had high 4-hour and 1-day volatility. These ranges do not distinguish the outcomes in this sample.
- **Trend and momentum:** All five entries had bullish 1-hour trends and positive 1-hour momentum. All three closed losers nevertheless had bearish 1-day trends. This timeframe disagreement is a more useful investigation target than 1-hour bullishness alone.

## 2. Factors most associated with losses and open profit

Ranked by the observed separation, not by statistical significance:

1. **Bearish 1-day trend at entry — strongest observed loss association.** It appears in all three closed losers and neither open position. Because the open losing position is still unresolved, this compares closed losses against open status—not completed winners against completed losers.
2. **Near-zero 1-hour volume ratio — strongest observed volume association.** It appears in all three closed losers and neither open position. The open losing position's high 1-hour volume ratio demonstrates that volume confirmation alone is not protective.
3. **Very high 5m/15m RSI — possible entry-timing association.** It appears in the closed-loss group, but MEGA also entered with elevated 15-minute RSI and is currently profitable. RSI >70 alone is not supported as harmful.
4. **Confidence, market strength, and 1-hour trend strength — weak separation.** The actual values overlap; all five entries met confidence and strength gates, and all five had bullish 1-hour trends.
5. **1-hour volatility — no observed separation.** Every entry was in the medium volatility class.

The evidence supports testing the **combination** of higher-timeframe trend alignment and 1-hour volume confirmation. It does not support changing thresholds or treating any one feature as causal.

## 3. Shadow Exit Scenarios

All **35 scenarios** (five positions × seven rules) were present and reported `FRESH` data quality. The event table contained **67 events**: 35 tracking-start events, 21 actual-position-closed events (seven per closed position), six trailing-stop-armed events, and five hypothetical-trigger events. No shadow-event error codes were recorded.

### Closed-position counterfactuals

For each rule, the three closed positions are compared with the actual realized total of **-€270.58**. If a hypothetical rule did not trigger before the actual close, the counterfactual retains the actual result for that position.

| Shadow rule | Scenarios | Triggers overall | Triggers on closed positions | Counterfactual total on 3 closed positions | Difference vs actual | Rank |
|---|---:|---:|---:|---:|---:|---:|
| Fixed TP +5% | 5 | 2 | 1 | -€155.94 | **+€114.63** | 1 |
| Trailing stop, arm +5%, retrace 5% | 5 | 2 | 1 | -€210.68 | **+€59.90** | 2 |
| Trailing stop, arm +5%, retrace 10% | 5 | 1 | 1 | -€241.91 | **+€28.67** | 3 |
| Fixed TP +10% | 5 | 0 | 0 | -€270.58 | €0.00 | 4 (tie) |
| Fixed TP +15% | 5 | 0 | 0 | -€270.58 | €0.00 | 4 (tie) |
| Fixed TP +20% | 5 | 0 | 0 | -€270.58 | €0.00 | 4 (tie) |
| Trailing stop, arm +5%, retrace 15% | 5 | 0 | 0 | -€270.58 | €0.00 | 4 (tie) |

The +5% fixed target improved the closed-sample result only because it triggered on ARX. POL and SXT still closed at their actual losses under every tested rule. Even the best rule leaves a net loss across the three closed positions.

### Trigger details and open position status

| Symbol | Rule | Trigger time (UTC) | Modeled net P&L | Actual/current comparison |
|---|---|---|---:|---|
| ARX-EUR | Fixed TP +5% | 5 Nov 14:40 | +€58.52 | Actual close later: -€56.11; modeled difference +€114.63 |
| ARX-EUR | Trailing 5% | 5 Nov 15:10 | +€3.79 | Actual close later: -€56.11; modeled difference +€59.90 |
| ARX-EUR | Trailing 10% | 7 Nov 14:10 | -€27.44 | Actual close later: -€56.11; modeled difference +€28.67 |
| MEGA-EUR | Fixed TP +5% | 7 Nov 17:50 | +€51.57 | Position remained open at +€29.94 at observation time |
| MEGA-EUR | Trailing 5% | 8 Nov 21:55 | +€7.77 | Position remained open at +€29.94 at observation time |

The open-position comparisons are not realized-outcome comparisons: MEGA's fixed-target modeled exit is €21.63 above its current mark-to-market P&L, while the trailing-5% modeled exit is below it. The position could move after either hypothetical trigger. These estimates use observed last-price marks and modeled costs; they are not guaranteed executable fills or spread-adjusted results.

**Does a superior exit already exist in the shadow framework?** The +5% fixed take-profit is the leading candidate in the current data. Its rank is driven by one closed position, and its total closed-position counterfactual remains negative. It should remain a shadow hypothesis until it performs across more closed positions and market conditions.

## 4. Evidence-based improvement proposals

| Proposal | Supporting evidence | Expected benefit | Main risk |
|---|---|---|---|
| Test a higher-timeframe alignment feature, especially 1-day trend direction/spread, in paper-only shadow comparisons. | All three closed losers entered against a bearish 1-day trend; both open entries had bullish 1-day trends. | Could identify countertrend entries that 1-hour bullish signals miss. | N=3 closed losses; a trend filter could reject profitable reversals. |
| Test low 1-hour volume ratio as a warning/confirmation feature, combined with trend context. | All closed losers had 1-hour ratios ≤0.07; both open positions were >1.3. | Could reduce weak-participation entries. | WIN is losing despite high volume; effects may be market- or asset-specific. |
| Do not block entries solely because RSI exceeds 70. | MEGA was above 70 on 1h and 15m and is currently profitable; WIN is losing below 70. | Avoids an unsupported hard cutoff and potential missed winners. | Elevated short-interval RSI may still contribute when combined with weak volume or bearish daily trend. |
| Keep fixed TP +5% and trailing exits in shadow evaluation; compare them against actual exits as more positions close. | Fixed TP +5% leads the 3-closed-position comparison by €114.63; trailing 5% and 10% also improved ARX's result. | Builds evidence for exit timing without changing actual trading. | Current ranking is dominated by ARX; observed-mark fills omit historical spread and execution uncertainty. |

## 5. Limitations

- The sample is only **five entries**, with **three closed losses, zero closed winners, one open winner, and one open loser**.
- The two open positions are censored observations; their labels can change.
- Three losing entries clustered on 4 November and may reflect a shared market move rather than three independent tests.
- Entry indicators are the stored values paired with each AI decision; this is not a broad historical re-creation across all BUY decisions.
- Indicator association is not causation. The report does not estimate statistical significance or claim that a threshold change would improve future returns.
- Shadow outcomes use stored last-price marks and configured simulated costs. They do not model historical spread or guarantee real fills.

## Conclusion

The best supported entry hypotheses are **daily trend alignment** and **very low 1-hour volume participation**, particularly when they occur together. RSI >70 is not harmful enough in this sample to justify a standalone block; high volume is not enough to guarantee a profitable position; confidence, market strength, and 1-hour volatility do not distinguish the groups reliably.

The shadow framework's **fixed TP +5%** is the strongest exit candidate observed, followed by trailing stops at 5% and 10%. The evidence is limited to one triggered closed position per successful rule, and the best aggregate result remains negative. Treat these as paper-only candidates for continued observation, not production changes.

## Evidence sources

- Live production Supabase rows: `AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Shadow_Exit_Scenarios`, and `AI_Crypto_Bot_Shadow_Exit_Events`; queried read-only on 9 November 2026 UTC.
- Indicator definitions and decision-timeframe scoring: [lib/ai-engine.mjs](../../lib/ai-engine.mjs).
- Paper-trading and shadow-evaluation call flow: [lib/paper-trading.mjs](../../lib/paper-trading.mjs) and [lib/shadow-exits.mjs](../../lib/shadow-exits.mjs).
