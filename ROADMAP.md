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

- [x] Database-backed dashboard summaries for agent status, emergency state, portfolio, positions, trades, watched markets, and AI decisions
- [x] KPI cards with accessible explanations and portfolio history chart from actual database snapshots
- [x] Mobile-first responsive layout and empty/error states
- [x] Refresh complete dashboard data every 30 seconds and immediately on return to the foreground
- [x] Use a full-width Agent Status panel with an enlarged brain visualization and move Emergency State / Risk Control to the bottom of the dashboard
- [x] Authenticated read-only API, tests, and documentation

Status: Completed

Phase 04 does not implement market scanning, AI execution, or trading. The Agent Brain visualization is delivered in Phase 05.

---

## Phase 05 - Agent Brain

- [x] Reference-inspired, front-facing bilateral brain silhouette with an explicit center fissure, organic cortical contour, curved neural pathways, bright hotspots, and traveling energy particles in the existing Agent Status panel
- [x] Live status refresh from `AI_Crypto_Bot_Status` through an authenticated read-only API
- [x] ACTIVE, ANALYZING, IDLE, STOPPED, ERROR, and neutral UNKNOWN visualization states
- [x] 720 independently pulsing neural nodes, 2160 subtly rendered connections, and up to 48 status-driven signals that travel neuron-to-neuron and brighten only the pathways they traverse
- [x] Stable brain silhouette with animated neural activity and no continuous whole-brain rotation
- [x] Renderer-aware fallback only for unavailable WebGL or failed Three.js initialization
- [x] Responsive rendering, visibility pause, disposal, and performance safeguards
- [x] Tests and documentation
- [x] Shell-free contour with same-color hemispheres, radial neuron glow, reference-inspired blue input waves and right-side circuit traces, and 52 green neuron accents during ANALYZING; status and agent logic unchanged
- [x] Slightly stronger active-neuron glow and a taller silhouette with the lower contour extended downward

Status: Completed (2026-10-31)

---

## Phase 06 - Bitvavo Integration

- [x] Expand and validate the centralized EUR market universe against Bitvavo's public market catalog
- [x] Non-destructively synchronize valid missing markets into `AI_Crypto_Bot_Watched_Markets`
- [x] Cache public Bitvavo market/ticker/candle responses for 60 seconds and preserve stored-data fallbacks
- [x] Persist validated 24-hour market snapshots and OHLCV candles in existing tables
- [x] Refresh ticker snapshots separately from candle ingestion
- [x] Incrementally refresh all six OHLCV intervals through bounded, five-market candle batches using each market/interval's latest stored candle; bootstrap only missing histories and expose runtime metrics
- [x] Log invalid markets, missing data, provider failures, and refresh failures in `AI_Crypto_Bot_Scanner_Events`
- [x] Add authenticated market and market-summary APIs with dashboard integration
- [x] Expose separately authenticated market-snapshot and bounded candle-refresh endpoints for external schedulers
- [x] Add market-data, endpoint, caching, failure-mode, and dashboard integration tests
- [x] Update Phase 06 documentation and completion report

Status: Completed

---

## Phase 07 - AI Engine

- [x] Deterministic EMA, RSI, MACD, momentum, volume, and volatility analysis across supported candle intervals
- [x] Retrieve each supported candle interval independently so PostgREST row caps cannot exclude later intervals
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
- [x] Reuse `/api/market-summary` for scanner rankings and dashboard tracked-market details; add no Vercel Function or database schema
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
- [x] Validate 100,001 AI decisions, 100,001 snapshots, and 10,001 trades without loading full source histories into browser memory
- [x] Add analytics calculations, API, UI, export, performance, testing, and function-count documentation

Status: Analytics production-loading fix is implemented and locally validated. A production log identifies `AI_Crypto_Bot_AI_Decisions`, query `analytics.ai-decisions`, page 3 (`1000-1499`), HTTP 416, and `PGRST103`; the Supabase message/details were not present in that log. Temporary instrumentation now captures the exact query and error details. No new database objects or Vercel Functions were added; Phase 14 has not started.

---

## Phase 14 - Final Polish

- UX
- Performance
- Accessibility

---

# Future Phases

## Phase 15 - Backtesting Engine

- Historical Simulation
- Strategy Evaluation

---

## Phase 16 - Strategy Optimization

- Strategy Ranking
- Strategy Comparison

---

## Phase 17 - Autonomous Agent Enhancement

- Self Optimization
- Autonomous Learning

---

## Phase 18 - Live Trading Preparation

- Additional Risk Controls
- Audit Logging
- Kill Switch

---

## Phase 19 - Live Trading Infrastructure

- Order Layer
- Exchange Validation

---

## Phase 20 - Live Trading Activation

- Controlled Rollout
- Production Validation