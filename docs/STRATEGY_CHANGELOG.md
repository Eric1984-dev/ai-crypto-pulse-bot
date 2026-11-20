# Strategy Changelog

Alle wijzigingen aan strategieën moeten hier worden geregistreerd.

---

### Experiment: Volume + Positive Momentum Entry Filter

### Strategy / Version

Deterministic Technical Analysis V2 — `2.1.0` (paper-only entry-selection experiment)

### Change Date

2026-11-19

### Changes

- Keep every existing BUY condition and require 1d momentum > 0.
- Require the existing 1h volume confirmation score `clamp(hourlyVolumeRatio - 0.5, 0, 1)` to be >= 0.25.
- Convert an otherwise qualifying BUY to HOLD when either filter fails and store `LOW_DAILY_MOMENTUM` and/or `LOW_VOLUME_SCORE` in the AI decision reason for later measurement.
- Do not change confidence scoring or threshold, EMA/trend/alignment/RSI calculations, the paper executor, risk controls, exits, scheduler, or database schema.
- Clarification: daily/hourly alignment is not a hard condition for generating the AI BUY decision; it contributes to Market Strength and confidence. The paper executor separately requires explicit alignment before it opens a position.

### Reason and Hypothesis

The analysis of 14 closed trades found 7 winners and 7 losers, a 50.0% winrate, +€4.15 average win, -€10.06 average loss, and -€2.95 expectancy. All four executed trades with 1d momentum <= 0 were losses. Higher hourly volume-score groups performed better descriptively. Applying both fixed filters to the same in-sample trades retained 6 closed trades (5 wins, 1 loss), with 83.3% winrate, +€2.07 expectancy and +€12.43 total net P&L. The experiment tests whether these signals generalize; the six-trade subset is small and is not validation evidence.

### Monitoring and Success Criteria

Track executed BUYs, each filter's rejected candidate count, winrate, expectancy, profit factor, average winner, average loser, and max drawdown. Compare new prospective paper results with the historical 50.0% winrate and -€2.95 expectancy; success also requires higher profit factor and no material drawdown deterioration.

### Results

Prospective performance remains unproven. The operator reports deploying V2.1.0 to the Pi, and production decision rows tagged `2.1.0` were observed in the database. The running binary/build identity has not been independently verified in this documentation update.

Implementation and validation details: [Volume + Positive Momentum Entry Filter Experiment](reports/VOLUME_POSITIVE_MOMENTUM_ENTRY_FILTER_EXPERIMENT.md). Broader findings and limitations are in the [November 2026 strategy architecture findings](reports/STRATEGY_ARCHITECTURE_FINDINGS_2026-11.md).

---

### Strategy

V2 Daily-EMA-led paper strategy — misalignment and volatility research adjustment

### Version

Engine identifier remains `2.0.0`; this is a paper-only research adjustment.

### Change Date

2026-11-16

### Changes

- Subtract 20 points from Market Strength and confidence when the 1h and 1d trends do not establish the same non-sideways direction.
- Preserve the existing ATR-based volatility classification and average calculation, capped at five confidence points.
- Keep the AI signal floor at 65, paper executor BUY threshold at 70, and all execution/risk rules unchanged.

### Reason

The preceding signal analysis found frequent timeframe-disagreement noise and a volatility penalty that could disproportionately suppress some markets. A user-provided ~24-hour stateful replay indicated more paper trades and traded markets with lower realized loss and drawdown under the proposed settings. That replay is limited historical evidence, not a profitability claim.

### Expected Impact

- Reduce the directional strength and confidence of misaligned signals.
- Limit the maximum average volatility deduction to five points while retaining ATR-based classification.
- Keep the executor's explicit alignment gate and all position, cooldown, sizing, drawdown, emergency, and exit protections. This execution-time alignment check is separate from AI BUY generation, where alignment affects score/confidence but is not a hard gate.

### Results

The reported replay comparison was 2 BUY / 1 SELL across one market (CAP-EUR), realized P&L -€10.48 and max drawdown 1.017% for the prior configuration, versus 5 BUY / 3 SELL across two markets (CAP-EUR and MEGA-EUR), realized P&L -€2.65 and max drawdown 0.887% for the proposed configuration. These user-provided figures have not been independently reproduced against this implementation. Re-evaluate with a fresh stateful replay; track executed trades, unique markets, realized P&L, maximum drawdown, rejected-signal reasons, and volatility/misalignment distributions.

---

## Template

### Strategy

Naam strategie

### Version

v1.0

### Change Date

YYYY-MM-DD

### Changes

- wijziging 1
- wijziging 2

### Reason

Waarom werd de wijziging gedaan.

### Expected Impact

Verwachte verbetering.

### Results

Wordt na evaluatie ingevuld.
