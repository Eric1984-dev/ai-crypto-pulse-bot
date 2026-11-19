# Risk Management

## Phase 08 status

The limits below are enforced by the Raspberry Pi paper-trading service before any simulated entry. Browser clients cannot write trades, positions, balances, or snapshots. The executor uses stored AI decisions and stored market data only.

### Paper Trading Research Update

Date: 2026-11-16

The AI analysis engine now subtracts 20 points from both Market Strength and confidence when the 1h and 1d trends do not establish the same non-sideways direction. Its existing ATR-based average volatility penalty is capped at five confidence points. These adjustments change signal scoring only; they do not relax the executor's requirement for explicit timeframe alignment.

The AI confidence floor remains 65 and the paper executor BUY threshold remains 70. Position sizing, the nine-position limit, cooldown, drawdown controls, emergency stop, fees, slippage, and exit rules are unchanged. No live-trading code or setting is changed.

The preceding user-provided ~24-hour replay reported 5 BUY/3 SELL executions across two markets, realized P&L of -€2.65 and maximum drawdown of 0.887%, compared with 2 BUY/1 SELL across one market, -€10.48 realized P&L and 1.017% maximum drawdown under the prior configuration. This short replay is not independently reproduced here and is not evidence of future profitability. A fresh stateful replay and monitored paper-only evaluation are required before drawing conclusions.

### Experiment: Volume + Positive Momentum Entry Filter

The paper AI engine applies two additional BUY-selection conditions after the existing signal and confidence rules: 1d momentum must be > 0, and the existing 1h volume confirmation score `clamp(hourlyVolumeRatio - 0.5, 0, 1)` must be >= 0.25. A failed candidate is persisted as HOLD with `LOW_DAILY_MOMENTUM` and/or `LOW_VOLUME_SCORE` in its AI-decision reason. This uses the existing decision history; it does not add execution-audit reason codes or change the paper executor, schema, confidence model, alignment, or risk controls.

The hypothesis is that BUY signals with positive daily momentum and sufficient hourly volume have better trade quality than the previous selection. It is based on an in-sample set of 14 closed trades: the combined filter retained six (five wins, one loss), with 83.3% winrate, +€2.07 expectancy and +€12.43 net P&L, versus 50.0% and -€2.95 expectancy for the full set. This tiny, concentrated sample may reflect chance and does not establish future performance.

Monitor executed BUY count, filtered candidate count by reason, winrate, expectancy, profit factor, average win/loss, and maximum drawdown. Success criteria are higher winrate than 50%, expectancy better than -€2.95, higher profit factor, and no material drawdown deterioration, assessed on new paper-trading observations. Do not treat the historical filtered subset as validation; the two currently open positions and subsequent trades must be tracked separately.

Implementation details and validation status are recorded in the [experiment report](reports/VOLUME_POSITIVE_MOMENTUM_ENTRY_FILTER_EXPERIMENT.md). The repository update is not deployed to the Pi yet.

## Trading Mode

Current Mode:

PAPER ACTIVE

---

## Position Limits

Maximum entry notional: 10% of the current portfolio value. The fee is charged in addition to the capped notional.

Maximum Open Positions:

9

---

## Confidence Threshold

Minimum entry confidence in the Raspberry Pi paper executor: 70. Values below 70 are rejected; 70 is accepted. A valid SELL may reduce exposure without the entry threshold.

The 67-confidence experiment migration applies to the historical SQL paper executor, not the current Raspberry Pi service. It does not change the active Pi threshold or its AI decision generation, Analytics, or other risk controls.

---

## Cooldown

Minimum per-market entry cooldown: 15 minutes after any paper trade for that market. SELL exits are not blocked by the entry cooldown.

---

## Simulated Trading Costs

- Fee: 0.25% of simulated execution notional, charged on both entry and exit.
- Slippage: 0.10% adverse to the stored market price, applied to both entry and exit.
- BUY cost basis includes entry fees and simulated slippage. SELL realized P&L subtracts that basis, exit fees, and exit slippage.

---

## Daily Risk Controls

Daily drawdown limit: 5% from the most recent stored portfolio snapshot before the current UTC day (or starting balance if no prior snapshot exists). New entries are blocked at or beyond this limit.

---

## Portfolio Risk Controls

Maximum portfolio drawdown: 15% from the portfolio's stored peak value (at least its starting balance). New entries are blocked at or beyond this limit.

---

## Emergency Controls

Emergency stop level: 20% drawdown from the stored portfolio peak.

When triggered:

- No new positions
- Agent Status = STOPPED
- A new `EMERGENCY_STOP` row is appended to `AI_Crypto_Bot_Emergency_State`.
- The dashboard reads and displays the persisted emergency state.

Existing positions remain visible and can still be closed by a fresh, stored SELL decision. The AI analysis endpoint also observes `STOPPED` and does not create new decisions until an operator resets the status.

## Input and execution safeguards

- Only the newest stored decision for an enabled market is considered.
- Decisions and market snapshots older than 15 minutes, more than one minute in the future, missing, or invalid are rejected; no position is opened.
- Candle timestamps represent interval start times. Ingestion stores only aligned, fully closed candles; AI analysis also excludes any incomplete legacy candle and records stale, missing, and incomplete interval diagnostics.
- BUY and SELL execution use the database value from `AI_Crypto_Bot_Market_Data`; the executor never fetches exchange prices itself.
- A portfolio cannot exceed nine open positions or hold multiple open positions for the same market through the executor.
- Buys are rejected when any open position lacks a fresh market snapshot, when the available balance cannot cover notional plus fees, or when an emergency/pause is active.
- Trades are linked to the source AI decision and use a unique deterministic idempotency key. A retried decision cannot create another trade.
- HOLD and WAIT decisions never create trades. SELL closes existing positions only; it cannot open a short position.
- Risk checks, balance updates, position changes, trade insertion, and snapshot writes run under database transaction and row-lock protection.
- Portfolio snapshot chronology uses `snapshot_order` to order snapshots that share a timestamp. The additive migration proposal [`phase-8.13-portfolio-snapshot-order.sql`](../raspberry-pi/migrations/phase-8.13-portfolio-snapshot-order.sql) must be reviewed and applied by the operator before deploying code that requires this column. The original execution order of historical same-timestamp rows cannot be recovered.

## Position Exits

The paper executor retains fresh AI-SELL exits and applies two position-aware stop rules:

- Every open position has a stop that targets a maximum modeled net loss of 5% of its fee/slippage-inclusive entry cost basis. The threshold accounts for the modeled 0.10% exit slippage and 0.25% exit fee.
- The rule arms once the observed high-water mark could realize at least €3 net after the fee-inclusive entry cost basis, 0.10% exit slippage, and 0.25% exit fee.
- The stop is the greater of that +€3 net floor and the high-water mark minus 1.5 × ATR from 15 consecutive, closed 5-minute candles. The stop only ratchets upward.
- A fresh stored market mark at or below the active stop closes the position as a paper SELL. The trade uses `execution_reason = MAX_POSITION_LOSS_EXIT` or `ATR_TRAILING_EXIT` and has no AI-decision link, so it remains visible in actual trade P&L without being counted as an AI SELL decision.
- High-water is the highest fresh market mark observed during paper cycles, not a tick-level or intrabar candle high. Missing, stale, incomplete, misaligned, gapped, or zero-range candles cannot create or advance the ATR trail; the maximum-loss stop remains active independently.
- There is no fixed take-profit. The 5% loss threshold is a modeled trigger, not a guaranteed realized-loss ceiling: the executor checks fresh stored marks on paper cycles, and market gaps or execution beyond the modeled slippage/fee assumptions can result in a larger loss. Existing positions already beyond the threshold can close on their first evaluation under the new policy.

The 1.5 × ATR multiplier, €3 net floor, and 5% modeled net-loss threshold are a PAPER risk configuration, not statistically validated profitability settings. The previous shadow rule grid is no longer evaluated during paper-trading cycles; its stored records remain historical/read-only. Before starting a runtime that uses the updated exit and entry rules, the operator must review and apply the additive [Phase 8.14 migration](../raspberry-pi/migrations/phase-8.14-position-aware-trailing-exits.sql) and [Phase 8.17 migration](../raspberry-pi/migrations/phase-8.17-paper-entry-alignment-and-loss-stop.sql), after the audit-table migrations. Existing high-water values are seeded from stored entry/current prices; prior unrecorded peaks cannot be reconstructed. This workspace has not applied these migrations to the Pi database.

---

## Risk Manager Authority

The Risk Manager always has final authority. No paper-trading control enables or routes to live trading; `ENABLE_LIVE_TRADING=false` remains the required environment default.

The AI Agent may not bypass risk controls.

## Shadow Exit Scenarios

The dashboard's Shadow Exit Scenarios are prospective simulations, not risk controls or executable orders. Their experimental take-profit/trailing-stop rules cannot invoke the AI SELL path or paper-trading executor and do not change positions, actual trades, balances, risk checks, or portfolio metrics. They use only fresh stored market marks; stale or invalid marks cannot trigger a scenario. The observed mark-based fill estimate applies the configured 0.10% adverse slippage and 0.25% exit fee, but historical bid/ask spread is unavailable and the estimate is not a guaranteed fill. No shadow candidate is selected or recommended from these outcomes.
