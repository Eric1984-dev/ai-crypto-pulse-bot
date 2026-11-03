# Open Position AI Status Refinement Report

## Outcome

Refined the existing Dashboard position-status cards to show:

- Symbol and latest decision
- Human-readable Market View
- Short AI Commentary derived from the decision and Market View
- Current unrealized EUR P&L and return percentage
- Decision update time

Raw confidence and Market Strength values are not displayed in these cards. They remain available in the existing dashboard data for internal consumers.

## Presentation rules

Commentary follows the latest decision:

- **BUY:** Bullish trend detected. AI currently favors upward continuation.
- **SELL:** Bearish trend detected. Downside risk currently outweighs upside potential.
- **WAIT:** Insufficient or unreliable data. AI is waiting for better market conditions.
- **HOLD:** Commentary reflects whether the Market View is bullish, neutral, bearish, or unavailable.

P&L percentage is calculated as:

```text
(unrealized P&L / (entry price × position amount)) × 100
```

EUR amounts and percentages use the existing signed `en-GB` formatters with two decimal places. The existing position-metrics helper performs the calculation; no AI or trading calculation was changed.

## Scope and compatibility

- Reused the existing dashboard-data API; no endpoint, Vercel Function, or database change was added.
- Preserved AI decisions and confidence calculations, paper trading, risk management, Dashboard polling, and Realtime refresh.
- Kept the responsive card layout and removed confidence/strength labels and values from visible card content.

## Validation

- Focused Dashboard tests: **29 passed, 0 failed**.
- `npm.cmd test`: **260 passed, 0 failed**.
- `npm.cmd run build`: **passed**; static project and database migration validation succeeded.
- `git diff --check`: **passed**.

No production deployment or live Supabase smoke test was performed.
