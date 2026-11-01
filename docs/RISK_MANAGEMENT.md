# Risk Management

## Phase 08 status

The limits below are enforced by the server-side paper-trading database functions before any simulated entry. Browser clients cannot write trades, positions, balances, or snapshots. The executor uses stored AI decisions and stored market data only.

## Trading Mode

Current Mode:

PAPER ACTIVE

---

## Position Limits

Maximum entry notional: 10% of the current portfolio value. The fee is charged in addition to the capped notional.

Maximum Open Positions:

5

---

## Confidence Threshold

Minimum entry confidence: 70. This threshold applies to BUY entries; a valid SELL may reduce exposure without the entry threshold.

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
- BUY and SELL execution use the database value from `AI_Crypto_Bot_Market_Data`; the executor never fetches exchange prices itself.
- A portfolio cannot exceed five open positions or hold multiple open positions for the same market through the executor.
- Buys are rejected when any open position lacks a fresh market snapshot, when the available balance cannot cover notional plus fees, or when an emergency/pause is active.
- Trades are linked to the source AI decision and use a unique deterministic idempotency key. A retried decision cannot create another trade.
- HOLD and WAIT decisions never create trades. SELL closes existing positions only; it cannot open a short position.
- Risk checks, balance updates, position changes, trade insertion, and snapshot writes run under database transaction and row-lock protection.

---

## Risk Manager Authority

The Risk Manager always has final authority. No paper-trading control enables or routes to live trading; `ENABLE_LIVE_TRADING=false` remains the required environment default.

The AI Agent may not bypass risk controls.