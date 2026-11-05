# CryptoPulse AI Agent Roadmap

## Phase 01 - Project Setup

- [x] Project structuur en vereiste pagina's
- [x] Vercel configuratie voor statische pagina's
- [x] .env.example met veilige live-trading standaard
- [x] Node.js testing setup en projectvalidatie
- [x] Basisdocumentatie en completion report

Status: Completed (2026-10-31)

---

## Phase 02 - Authentication

- [x] Registratie met Supabase Authentication
- [x] Login en sessiebeheer
- [x] Logout
- [x] Wachtwoord resetten en bijwerken
- [x] Beveiligde pagina's en redirect voor niet-ingelogde bezoekers
- [x] Tests en documentatie

Status: Completed (2026-10-31)

---

## Phase 03 - Database

- [x] Timestamped Supabase migrations for all 16 prefixed Agent tables
- [x] Foreign keys, validation constraints, indexes, duplicate-safe trade/change keys, and Auth profile synchronization
- [x] Row Level Security policies and server-only write grants
- [x] Initial market, agent-status, and emergency-state seed data
- [x] Embedded PostgreSQL migration, RLS, ownership, seed, and constraint tests
- [x] Database, architecture, testing, README, and changelog documentation

Status: Completed (2026-10-31)

Runtime database APIs, market-data ingestion, and trading behavior remain out of scope.

---

## Phase 04 - Dashboard

- [x] Database-backed dashboard summaries for agent status, emergency state, portfolio, positions, trades, watched markets, and open-position AI status, with a global AI-decisions KPI
- [x] KPI cards with accessible explanations and portfolio history chart from actual database snapshots
- [x] Mobile-first responsive layout and empty/error states
- [x] Refresh complete dashboard data every 30 seconds and immediately on return to the foreground
- [x] Use a full-width Agent Status panel with an enlarged brain visualization and place Emergency State / Risk Control beside Open Position AI Status
- [x] Authenticated read-only API, tests, and documentation

Status: Completed

Phase 04 does not implement market scanning, AI execution, or trading. The Agent Status visualization is delivered in Phase 05 and refined in Phase 14.

---

## Phase 05 - Agent Brain

- [x] Reference-inspired, front-facing bilateral brain silhouette with an explicit center fissure, organic cortical contour, curved neural pathways, bright hotspots, and traveling energy particles in the existing Agent Status panel
- [x] Live status refresh from `AI_Crypto_Bot_Status` through an authenticated read-only API
- [x] ACTIVE, ANALYZING, IDLE, STOPPED, ERROR, and neutral UNKNOWN visualization states
- [x] 720 independently pulsing neural nodes, 2160 subtly rendered connections, and up to 48 status-driven signals that travel neuron-to-neuron and brighten only the pathways they traverse
- [x] Stable brain silhouette with animated neural activity and no continuous whole-brain rotation
- [x] Accessible fallback for visualization initialization failures; the original renderer was replaced by the native SVG circuit in Phase 14
- [x] Responsive rendering, visibility pause, disposal, and performance safeguards
- [x] Tests and documentation
- [x] Shell-free contour with same-color hemispheres, radial neuron glow, reference-inspired blue input waves and right-side circuit traces, and 80 moving green neurons during ANALYZING; status and agent logic unchanged
- [x] Slightly stronger active-neuron glow and a taller silhouette with the lower contour extended downward

Status: Completed (2026-10-31)

---

## Phase 06 - Bitvavo Integration

- [x] Expand and validate the centralized EUR market universe against Bitvavo's public market catalog
- [x] Non-destructively synchronize valid missing markets into `AI_Crypto_Bot_Watched_Markets`
- [x] Cache public Bitvavo market/ticker/candle responses for 60 seconds and preserve stored-data fallbacks
- [x] Persist validated 24-hour market snapshots and OHLCV candles in existing tables
- [x] Refresh ticker snapshots separately from candle ingestion
- [x] Incrementally refresh all six OHLCV intervals through bounded, five-market candle batches using the service-role-only latest-candle checkpoint RPC; bootstrap only missing histories and expose runtime metrics
- [x] Log invalid markets, missing data, provider failures, and refresh failures in `AI_Crypto_Bot_Scanner_Events`
- [x] Add authenticated market and market-summary APIs with dashboard integration
- [x] Expose separately authenticated market-snapshot and bounded candle-refresh endpoints for external schedulers
- [x] Add market-data, endpoint, caching, failure-mode, and dashboard integration tests
- [x] Update Phase 06 documentation and completion report

Status: Completed

---

## Phase 07 - AI Engine

- [x] Deterministic EMA, RSI, MACD, momentum, volume, and volatility analysis across supported candle intervals
- [x] Read the latest 150 candles per market and interval through a bounded service-role RPC, with no global PostgREST row cap or pagination
- [x] Enforce enabled EUR-market membership in SQL and reject incomplete exact-count PostgREST responses
- [ ] Confirm the intended production project's identity and `max_rows >= 600` before migration or deployment
- [x] Exclude intervals whose latest candle exceeds its freshness limit; return `WAIT` with `STALE_CANDLE_DATA` when fewer than two sufficiently populated fresh intervals remain
- [x] Confidence-weighted BUY, SELL, HOLD, and WAIT decisions from real watched-market snapshots and candles
- [x] Persist decisions and status transitions through existing `AI_Crypto_Bot_*` tables only
- [x] Graceful handling for missing, stale, partial, and invalid market data
- [x] Scheduler-authenticated analysis API, dashboard visibility, tests, documentation, and completion report

Status: Completed

The AI Engine is analysis-only. It does not create trades or mutate portfolios; Phase 08 consumes its stored decisions through a separate risk-managed executor.

---

## Phase 08 - Paper Trading

- [x] Gesimuleerd startportfolio van €10.000 per profiel en portfolio-snapshots
- [x] Paper Buy en Paper Sell op basis van opgeslagen AI-beslissingen en verse marktdata
- [x] Transactionele risk manager met positie-, confidence-, cooldown- en drawdownlimieten
- [x] Fee-, slippage-, P&L-, waarderings- en win-rateberekeningen
- [x] Idempotente scheduler-API en auditlink tussen trade en AI-beslissing
- [x] Dashboard- en portfoliopagina gekoppeld aan echte RLS-afgeschermde gegevens
- [x] Afzonderlijke beschermde Admin-pagina voor Admin-only AI-analyse en paper-tradinguitvoering met behoud van bestaande veiligheidscontroles
- [x] Database-, API-, UI-, risicoregressietests en documentatie

Status: Completed

Phase 08 gebruikt uitsluitend paper trading; Phase 09 is niet gestart. De code gebruikt geen private exchange-endpoints, exchange-accounts of echte orders.

---

## Phase 09 - Market Scanner

- [x] Top Gainers and Top Losers over 24h, 7d, and 30d
- [x] Highest Volume and Strongest Momentum rankings
- [x] AI Opportunities from the latest stored decisions, including symbol, confidence, decision, and reason
- [x] Rank enabled watched markets using stored snapshots and OHLCV candles
- [x] Reuse `/api/market-summary` for scanner rankings and the full prioritized watched-market list; keep the Dashboard Tracked Markets KPI without duplicating the list
- [x] Dedicated responsive scanner page, refresh behavior, tests, documentation, and completion report
- [x] Production-safe market-summary storage failure logs identify query, table, operation, page/range, HTTP status, Supabase code, and failure category without changing the public response
- [x] Treat PostgREST `416/PGRST103` on a subsequent generated scanner page as end-of-pagination while preserving fetched rows

Status: Completed

Ranking is read-only and uses stored market data and AI decisions. It does not generate decisions or execute trades.

---

## Phase 10 - Trade History

- [x] Paginated paper-trade history sourced from stored `AI_Crypto_Bot_Trades`
- [x] Server-side market search, action and time filters, allowlisted sorting, and exact counts
- [x] Winning/losing counts, average profit/loss, and best/worst realized SELL P&L from an RLS-scoped database aggregate
- [x] Responsive trade table, empty/error states, and dashboard link to complete history
- [x] Search, filtering, sorting, pagination, empty/large dataset, rendering, aggregate, and RLS regression tests
- [x] API, database, README, changelog, roadmap, and completion-report documentation

Status: Completed

---

## Phase 11 - Realtime

- [x] Reuse the authenticated Supabase client for dashboard, portfolio, trade-history, and scanner subscriptions
- [x] Refresh through existing authenticated APIs; retain polling fallback and add no Vercel Functions
- [x] Configure only required tables in the Supabase Realtime publication
- [x] Handle reconnects, offline/online transitions, tab visibility, multiple tabs, and subscription cleanup
- [x] Add regression tests and update API, database, architecture, testing, README, changelog, and completion-report documentation
- [ ] Apply and verify the publication migration in the production Supabase project; smoke-test reconnect and offline recovery

Status: Implementation complete; production validation pending.

---

## Phase 12 - Platform Testing

- [x] Run full automated tests and static/database build validation
- [x] Review implementation and local runtime/test evidence for all nine system components
- [x] Classify known production findings, risks, limitations, and unresolved checks
- [x] Generate the Phase 12 system validation report and update testing/changelog documentation

Status: Validation audit complete; production readiness WARNING (50%). Hosted production checks remain open. Phase 13 Analytics followed this audit; Phase 14 has not started.

---

## Phase 13 - Analytics & Strategy Insights

- [x] Add a protected Analytics page, separate from Dashboard, Scanner, Portfolio, and Trade History
- [x] Calculate trade win/loss rates, averages, profit factor, realized/unrealized/total P&L, drawdown, best/worst trades, hold time, and open/closed positions from existing tables
- [x] Attribute stored AI decision outcomes by confidence range, action, strategy, and symbol, with unscored decisions identified
- [x] Display portfolio growth, equity curve, daily/weekly/monthly performance, and drawdown history
- [x] Add Analytics Summary, Trade Analytics, Portfolio Analytics, and AI Analytics CSV exports to the existing Exports page and authenticated dashboard-data function
- [x] Paginate existing data reads, bound rendered time series, and test empty and large datasets
- [x] Bound historical Analytics to selectable rolling 30-, 90-, and 365-day ranges (default 30 days), while retaining current position and account metrics
- [x] Prefetch no more than four 500-row pages per source, validate exact RLS-visible counts, and log exact dataset/query/status/Supabase error diagnostics on failures; include diagnostics in development responses only
- [x] Treat HTTP 416/PGRST103 on a subsequent Analytics source page as end-of-results, preserve earlier pages, and ignore later prefetched ranges; keep first-page and other errors fail-closed
- [x] Add pagination regressions for 0, 1, 723, 999, 1000, 1001, and 19,380 AI decisions
- [x] Add a portfolio-snapshot regression for a later-range 416 and verify a first-page 416 still fails
- [x] Validate 100,001 AI decisions, 100,001 snapshots, and 10,001 trades without loading full source histories into browser memory
- [x] Add analytics calculations, API, UI, export, performance, testing, and function-count documentation

Status: A subsequent `416/PGRST103` range now terminates pagination for every Analytics source, including portfolio snapshots; earlier pages are retained and later prefetched pages are ignored. First-page errors and other failure codes still fail closed. AI-decision boundary and snapshot regressions cover the behavior. The four Analytics CSV reports each have an independent date range. Full test/build and function-count results are recorded in [the pagination fix report](docs/reports/ANALYTICS_PAGINATION_FIX_REPORT.md). Production resolution remains pending deployment and smoke testing. No new database objects or Vercel Functions were added; Phase 14 UI polish is in progress.

---

## Phase 14 - Final Polish

- [x] Use the frame-free green circuit-board artwork as the compact Agent Status visual and overlay status-driven glowing neuron signals along its routes
- [x] Map signal density, color, and speed to live agent status; keep STOPPED/UNKNOWN static and respect reduced-motion preferences
- [x] Collapse dashboard summary metrics after Win Rate by default
- [x] Collapse Dashboard Portfolio, Activity, and Agent log panels by default; show the full watched-market list on Market Scanner
- [x] Show two complete items in Open Positions, Activity, and Position Monitoring, with scrolling for additional items
- [x] Reduce whitespace above the Dashboard Overview and show list counts inline with their panel titles
- [x] Collapse Trade History search and filters by default; add a bounded, sticky-header scrolling table
- [x] Reset internal navigation destinations to the top on mobile without changing browser back/forward scroll restoration
- [x] Add standalone home-screen app metadata; document that Safari/in-app browser chrome is controlled by iOS
- [x] Replace the C brand mark with the Bitcoin-in-hands app icon on a dark blue background and make the AI Crypto Bot brand link to Dashboard on every page
- [x] Restore the original green theme across page surfaces, chart accents, browser chrome, and status-driven circuit colors while preserving the existing layout
- [x] Use a neutral charcoal page background with dark slate surfaces and blue accents; color positive/negative financial values without changing labels or trading behavior
- [x] Add subtle blue glow to panels, app icon, and Agent Status chip; surface only persisted run timestamps and identify on-demand views accurately
- [x] Show persisted run times in a green dashboard activity strip, keep Analytics/Market Scan on-demand, and use a yellow PAPER MODE badge
- [x] Remove redundant PAPER ACTIVE banners and footer notices from app pages
- [x] Add blue menu-item hover glow, close navigation on outside click, and keep it above sticky Analytics table headings
- [x] Recolor the Agent Status circuit and active signals blue while retaining red error and static gray stopped/unknown states
- [x] Use blue AI-brain artwork inspired by the supplied reference beneath the route-masked moving neuron signals
- [x] Keep the circuit artwork frame-free; fill the available mobile width, cap desktop width at 440px, and preserve fading neuron motion along visible traces
- [x] Strengthen the chip-edge glow during ANALYZING
- [x] Align all 32 distinct neuron routes and 24 pulsing pads to visible artwork traces; fade signal paths just inside the artwork edges
- [x] Keep each neuron masked to its assigned trace segment so it cannot jump to a neighboring lane at crossings
- [x] Extend neuron paths to trace endpoints, delay fading until near arrival, and illuminate terminal pads in sync
- [x] Pulse intermediate circular pads during ANALYZING
- [x] Subdue the static circuit glow and strengthen neuron halos so status activity remains easy to distinguish
- [x] Add a subtle always-on chip glow and substantially stronger neuron halos while preserving status colors and reduced-motion behavior
- [x] Show current market prices and unrealized returns for open trades; show entry/exit prices and realized return percentages for closed trades
- [x] Improve Dashboard Recent Trades with position status and EUR P&L details; compact large quantities and preserve precision for micro-priced assets
- [x] Refine Open Position AI Status with decision-aware commentary, signed EUR/percentage P&L, and hidden raw confidence/strength values
- [x] Audit all 12 pages at 320px, 768px, and 1280px in Chromium; remove the global minimum width that caused horizontal overflow at 320px
- [x] Add accessible captions and explicit column-header scopes to all Analytics tables
- [x] Separate core data exports from Analytics and Recommendation reports; group Trade and Position exports together
- [x] Synchronize Dashboard, Portfolio, and Trade History refreshes across tabs and polling intervals without changing P&L calculations
- [x] Use the shared blue accent for market symbols across Dashboard, Portfolio, Trade History, Market Scanner, and Analytics
- [x] Use gray legend swatches in the Dashboard portfolio chart without changing dataset line colors
- [x] Use neutral gray Dashboard KPI info icons while retaining a visible blue keyboard-focus indicator
- [x] Color BUY actions green and SELL actions red across trade, scanner, and Analytics displays
- [x] Highlight fee labels and amounts with the existing yellow warning tone across trade views
- [x] Show positive P&L in green and negative P&L in red across position and trade summaries
- [x] Add a small visual gap between the AI Brain and live backend status
- [ ] Complete the full Lighthouse and production release checklist
- [ ] Verify on physical iPhone, Android, and desktop devices and validate Chrome, Edge, and Safari

Status: Local interface refinements, responsive viewport checks, accessibility fixes, 240 automated tests, and static/database build validation pass. Phase 14 remains in progress pending Lighthouse, hosted production smoke tests, supported-browser checks, and physical-device verification. See [the final release report](docs/reports/FINAL_RELEASE_REPORT.md). Phase 15 AI Recommendations follows this phase; no Phase 16 work has started.

---

# Future Phases

## Phase 15 - AI Recommendations

- [x] Generate advisory-only recommendations from existing Analytics outcomes
- [x] Support 30-, 90-, and 365-day ranges with evidence-based confidence levels
- [x] Add a protected recommendations page with automatic Realtime and polling refresh
- [x] Reuse the authenticated dashboard-data and Analytics CSV export infrastructure
- [x] Keep recommendation history ephemeral; history CSVs recompute from existing data
- [x] Add recommendation, export, UI, authentication, and Realtime regression tests
- [x] Update project instructions and documentation; verify the existing 12-function limit
- [ ] Complete hosted production smoke testing

Status: Implementation is complete. `npm.cmd test` passed 227 tests, `npm.cmd run build` passed static/database validation, and the API remains at 12 functions. Production deployment and hosted Supabase/Realtime checks remain unverified. Phase 16 has not started. See [the Phase 15 AI Recommendations report](docs/reports/PHASE_15_AI_RECOMMENDATIONS_REPORT.md).

---

## Phase 16 - Strategy Simulation

Status:
Planned

Goal:

Simulate and compare strategy changes using historical paper-trading and Analytics data.

The simulator evaluates hypothetical changes without modifying the active strategy.

Features:

- Historical Simulation
- Strategy Evaluation
- Parameter Comparison
- Confidence Threshold Simulation
- Symbol Selection Simulation
- Portfolio Allocation Simulation
- Risk Profile Comparison

Rules:

- Simulation only
- No strategy changes
- No portfolio changes
- No automatic optimization
- No trade execution

Reuse:

- Analytics
- AI Recommendations
- Existing Portfolio Data
- Existing Trade History

The simulator must support:

- 30-day analysis
- 90-day analysis
- 365-day analysis

Output:

- Current Strategy Performance
- Simulated Strategy Performance
- Estimated Improvement
- Estimated Risk

Constraints:

- No unnecessary API endpoints
- No additional Vercel Functions
- Must remain within the 12-function Hobby limit

---

## Phase 17 - Strategy Optimization

- Strategy Ranking
- Strategy Comparison

---

## Phase 18 - Autonomous Agent Enhancement

- Self Optimization
- Autonomous Learning

---

## Future Enhancement - Position Management & Exit Strategy

Status:
Shadow evaluation implemented; position-level exits remain disabled.

Priority:
Evaluate after sufficient paper-trading history is available.

Rationale:

The current Paper Trading Engine closes positions only when a valid SELL signal is generated by the AI Engine.

The actual paper-trading executor currently does not support:

- Stop Loss
- Take Profit
- Trailing Stop
- Break-even Protection
- Partial Position Exits

As a result, profitable positions may return to break-even or losses before a SELL signal occurs.

This behavior is currently expected and matches the implemented Phase 08 design. A separate prospective shadow evaluator now records experimental scenarios for open positions, but it does not execute exits or change the current strategy.

The pre-registered shadow-only candidate grid is:

- Fixed take-profit: +5%, +10%, +15%, and +20%.
- Trailing stop: arm at +5%, then trigger after a 5%, 10%, or 15% fall from the observed high-water mark.

These scenarios use fresh observed market marks, not candle highs/lows, and are not validated backtest results or recommendations. Historical candle gaps documented in the audit reports prevent treating prior simulations as sufficient evidence for activating an exit rule.

Future evaluation should use:

- Analytics
- AI Recommendations
- Strategy Simulation

before introducing additional exit mechanisms.

No actual exit-rule implementation is currently planned.

Review after:

- 100+ closed trades
- Sufficient Analytics history
- Sufficient Recommendation history

Potential Future Features:

- Stop Loss
- Take Profit
- Trailing Stop
- Break-even Protection
- Partial Exits

Important:

Do not implement based on assumptions.

Use actual Analytics and Recommendation evidence before introducing new exit mechanisms.

Any future position-management system must:

- Respect existing risk controls
- Preserve Paper Trading safety
- Remain configurable
- Be validated through Analytics before deployment

## Future Enhancement - Low Price Asset Indicator Precision

Evaluate indicator precision for very low-priced assets.

Potential issue:

MACD histogram values may be rounded away for assets trading at very small prices.

Examples:

- BEAM-EUR
- SHIB-like assets
- Other micro-priced assets

Review:

- MACD precision
- Indicator normalization
- Decision quality impact

Use Analytics and AI Recommendations before implementing changes.

## Future Enhancement - Paper Trading Execution Audit

Status:
Backlog

Priority:
Medium

Rationale:

The current Paper Trading Engine records executed trades but does not preserve detailed execution outcomes for decisions that were evaluated but not executed.

As a result, it is difficult to determine why eligible BUY or SELL decisions did not result in trades.

Examples:

- POSITION_ALREADY_OPEN
- COOLDOWN
- INSUFFICIENT_FUNDS
- STALE_DECISION
- STALE_MARKET_DATA
- MAX_OPEN_POSITIONS
- MARKET_DISABLED
- EMERGENCY_STOP
- DRAWDOWN_PROTECTION

Future analytics, recommendations, simulations, and optimization phases would benefit from visibility into these outcomes.

---



Goals

Provide visibility into:

- Executed Decisions
- Rejected Decisions
- Skipped Decisions
- Duplicate Decisions

Track:

- Decision Timestamp
- Symbol
- Decision
- Confidence
- Execution Result
- Rejection Reason
- Evaluation Timestamp

---

Potential Uses

- Analytics
- AI Recommendations
- Strategy Simulation
- Strategy Optimization
- Production Diagnostics

---

Important

Execution auditing must not change trading behavior.

Its purpose is observability only.

Implement only when operational insight becomes more valuable than the additional storage and complexity.

## Future Enhancement - Data Retention & Archiving

Status:
Backlog

Priority:
Low

Rationale:

Historical data is growing continuously.

Current storage is primarily consumed by:

- AI_Crypto_Bot_Candles
- AI_Crypto_Bot_AI_Decisions

As market coverage and history increase, storage requirements will continue to grow.

Future phases should introduce evidence-based retention and archiving policies without impacting Analytics, Recommendations, Strategy Simulation, or Backtesting.

Goals:

- Preserve required analytical history
- Reduce unnecessary long-term storage growth
- Maintain reproducible simulations
- Maintain historical performance analysis

Areas for evaluation:

### AI Decisions

Review retention periods:

- 30 days
- 90 days
- 365 days
- Archive beyond retention period

### Candle Data

Review retention by interval:

- 1m candles
- 5m candles
- 15m candles
- 1h candles
- 4h candles
- 1d candles

Potential future policy:

- Retain recent lower-timeframe data
- Retain longer-term higher-timeframe data
- Archive historical raw candle data

Requirements:

- No data deletion without documented retention policy
- Must not break Analytics
- Must not break Recommendations
- Must not break Strategy Simulation
- Must not break Backtesting

Important:

No implementation is currently planned.

Re-evaluate when database size exceeds 75% of allocated capacity.
or

AI_Crypto_Bot_AI_Decisions exceeds 1 million rows.

## Strategy Experiment - Confidence Threshold

Status:
Active Paper-Trading Experiment

Change:

Minimum Confidence
70 -> 67

Objective:

Increase trade volume and collect additional Analytics data.

Environment:

Paper Trading only.

Review after:

- 25 closed trades
or
- 50 closed trades

Evaluation Metrics:

- Trade Count
- Win Rate
- Profit Factor
- Portfolio Growth
- Drawdown
- Average Trade Return

Possible Outcomes:

- Keep 67
- Return to 70
- Further optimize based on Analytics evidence

## Phase 19 - Live Trading Preparation

- Additional Risk Controls
- Audit Logging
- Kill Switch

---

## Phase 20 - Live Trading Infrastructure

- Order Layer
- Exchange Validation

---

## Phase 21 - Live Trading Activation

- Controlled Rollout
- Production Validation