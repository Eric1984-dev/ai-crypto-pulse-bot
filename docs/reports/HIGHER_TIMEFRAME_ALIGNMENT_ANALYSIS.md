# Higher Timeframe Alignment Analysis

**Live production data queried:** 2026-11-09 07:08 UTC  
**Scope:** every production paper BUY entry with its linked entry decision, position, close trade if present, and 15-minute candle path  
**Read-only:** no code, thresholds, database contents, or deployment were changed

## Executive conclusion

All five BUY entries had a bullish 1-hour trend. Three were entered while the 1-day trend was bearish; all three have since closed at a loss. The two entries with bullish 1-hour and bullish 1-day trends remain open: one is currently profitable and one is currently losing.

The three bullish-1h / bearish-1d entries realized a combined **-€270.58**, a **0% realized win rate**, **-9.213% average net return per position**, and **0.00 profit factor**. Their cumulative realized-P&L drawdown was €270.58. By contrast, the bullish/bullish group has no closed trades, so its realized win rate, average realized return, profit factor, and realized drawdown are **not measurable**. Its two positions are currently marked at a combined **+€18.82** (+0.976% average mark-to-entry return); this is unrealized, not a realized performance result.

The evidence is consistent with bearish-daily entries underperforming in this sample, but it does **not** establish systematic underperformance: there are only three closed bearish-daily entries, no closed aligned entries, and the two aligned positions are still open. Requiring bullish alignment would have excluded all three observed closed losses, but a valid win-rate or profit-factor improvement cannot be claimed from zero closed aligned trades.

## 1. Cohort definition and return method

The database contains five BUY trades. Each was joined to its source AI decision using the stored decision ID and to its position by symbol and entry time. Trend direction is read from the 1-hour and 1-day trend fields recorded in the entry decision.

- Closed-position net return = realized net P&L divided by position amount × stored entry cost basis.
- Open-position return is shown separately as current mark-to-market P&L divided by the same basis.
- Win rate and profit factor use **closed trades only**. Open positions are not counted as wins or losses.
- Drawdown is reported two ways: (1) cumulative realized P&L for the closed entry cohort, and (2) per-position maximum adverse excursion (MAE) from 15-minute candle lows relative to entry cost basis. MAE is not portfolio-equity drawdown.

All five entries were bullish on 1 hour. Thus the relevant comparison is exactly:

- **Bullish 1h + bullish 1d:** 2 entries, both still open.
- **Bullish 1h + bearish 1d:** 3 entries, all closed.

## 2. All BUY entries

| Symbol | Entry time (UTC) | 1h trend | 1d trend | 1d EMA spread | Status | Net P&L / current mark | Net return |
|---|---|---|---|---:|---|---:|---:|
| WIN-EUR | 2026-11-02 14:13 | Bullish | Bullish | +7.88% | Open | -€13.38 | -1.339% unrealized |
| ARX-EUR | 2026-11-04 11:03 | Bullish | Bearish | -2.40% | Closed | -€56.11 | -5.733% realized |
| MEGA-EUR | 2026-11-04 11:03 | Bullish | Bullish | +0.81% | Open | +€32.20 | +3.291% unrealized |
| POL-EUR | 2026-11-04 11:03 | Bullish | Bearish | -2.49% | Closed | -€65.74 | -6.722% realized |
| SXT-EUR | 2026-11-04 14:48 | Bullish | Bearish | -1.51% | Closed | -€148.72 | -15.186% realized |

Open P&L was last updated at 2026-11-09 07:08 UTC. WIN and MEGA are pending outcomes.

## 3. Performance by 1-day trend and alignment

| Entry alignment | Entries | Closed | Closed wins / losses | Realized win rate | Average realized return | Profit factor | Closed net P&L | Open mark-to-market |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Bullish 1h + bearish 1d | 3 | 3 | 0 / 3 | 0% | -9.213% | 0.00 | -€270.58 | — |
| Bullish 1h + bullish 1d | 2 | 0 | No closed trades | N/A | N/A | N/A | N/A | +€18.82 total; +0.976% average return |

The bearish-1d cohort's three closed returns were -5.733%, -6.722%, and -15.186%. With all three realized losses occurring in sequence and no realized gains in that cohort, cumulative realized P&L declined from €0 to -€270.58; this is a **€270.58 closed-cohort drawdown**, not the whole-portfolio drawdown.

The aligned cohort currently consists of one open loser (-€13.38) and one open winner (+€32.20). Its current combined positive mark does not establish a realized win rate or profit factor.

### Per-position adverse excursion

The 15-minute candle path from entry through actual exit (or through the latest observation for open positions) gives:

| Alignment | Positions | Mean MAE | Worst MAE |
|---|---:|---:|---:|
| Bullish 1h + bearish 1d | 3 closed | -9.380% | -15.014% (SXT) |
| Bullish 1h + bullish 1d | 2 open | -8.610% | -8.895% (MEGA) |

These are adverse price excursions from entry basis, not account-level or strategy-level equity drawdowns. The open positions' excursions are incomplete through the observation time.

## 4. Would requiring bullish alignment have improved results?

**Observed sample:** It would have rejected ARX, POL, and SXT. Those three entries later realized -€270.58 in total. It would have kept WIN and MEGA, whose current combined unrealized P&L is +€18.82.

**What can be concluded:** The filter would have avoided the three recorded closed losses in this five-entry sample. The closed bearish-daily cohort's realized performance was poor.

**What cannot be concluded:** There is no closed trade in the bullish/bullish cohort. It is not valid to call its win rate 100%, compare realized profit factors, or claim a durable improvement. The current open positions could later close at different outcomes. A historical filter replay also cannot account for what trades might have filled instead, changes in available position slots, or subsequent risk checks.

Therefore, bullish 1h + bullish 1d alignment is a **promising paper-only hypothesis**, not a proven profitable entry requirement.

## 5. Production-data limitations

- The complete BUY-entry sample contains only five positions: three closed losses and two open positions.
- All three bearish-daily observations are losses, but they are clustered in time and are not independent market-regime trials.
- There are no realized bullish-daily outcomes yet, so the direct realized comparison is one-sided.
- A bearish-entry cohort drawdown can be measured from its realized trade sequence; a comparable realized aligned-cohort drawdown cannot be measured before its positions close.
- The position MAE calculation uses 15-minute candle lows; it does not reconstruct exchange fills or portfolio-level mark-to-market equity at every intrabar point.

## Verdict

**Yes, entries against the 1-day trend materially underperformed in the observed closed sample:** all three closed bearish-1d entries lost, averaging -9.213%, with PF 0.00. The bullish/bullish entries are both still open, so the data does not yet prove systematic underperformance or a realized improvement from requiring alignment.

Keep the alignment idea as a paper-only candidate and re-evaluate after aligned positions have closed and additional entries provide a less time-clustered comparison. No threshold change is supported by this evidence alone.

## Evidence source

Read-only production queries against `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Positions`, and `AI_Crypto_Bot_Candles` (15-minute interval), queried 2026-11-09 UTC.
