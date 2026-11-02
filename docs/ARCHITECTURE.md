# Architecture

## Current Implementation: Phase 11

The project is a static HTML/CSS/JavaScript application hosted on Vercel. Phase 02 implements Supabase Authentication with server-side Vercel functions for configuration, session-cookie validation, and protected page delivery. Phase 03 adds the Supabase PostgreSQL schema, migrations, seed data, and RLS policies. Phase 07 adds a server-side deterministic analysis engine using the existing Phase 06 market data.

Implemented components:

- Static pages
- Shared stylesheets
- Shared JavaScript
- Project validation tooling
- Environment template
- Supabase Registration, Login, Logout, and password recovery
- Persistent Supabase client sessions
- HttpOnly session cookie for Vercel protected-page rewrites
- Authentication tests
- Timestamped Supabase migrations for all 16 prefixed application tables
- Foreign keys, validation constraints, and query indexes
- Auth profile provisioning and email synchronization
- RLS policies and role grants for user-owned, global, and server-managed data
- Central default market configuration and initial database seeds
- Embedded PostgreSQL migration and RLS integration tests
- Authenticated read-only dashboard API that forwards the caller's JWT to Supabase so RLS remains authoritative
- Database-backed dashboard summaries, recent activity, and snapshot chart with safe empty/error states
- Visibility-aware dashboard polling every 30 seconds, with a foreground refresh and duplicate-load protection
- Responsive SVG Agent Status circuit visualization driven by the live database status, with reduced-motion support and no WebGL dependency
- Authenticated public-market API using Bitvavo's market catalog, 24-hour tickers, and supported OHLCV candles
- Read-only Market Scanner rankings for active watched markets, using fresh snapshots, stored daily/hourly candles, and latest stored AI decisions
- 24h/7d/30d gainers, losers, estimated EUR volume, momentum, and AI opportunities; bounded ranking results and range-paginated PostgREST reads
- Responsive dedicated scanner page using the existing authenticated `/api/market-summary` endpoint; the dashboard keeps tracked-market details without duplicating scanner rankings
- Non-destructive watched-market validation/synchronization and 60-second in-memory provider caching
- Server-side ticker/candle persistence and scanner-event error logging using the existing RLS-protected tables
- Separate scheduler-protected market-snapshot and bounded candle-refresh endpoints, plus AI analysis; candle work handles one interval and at most five markets per invocation, with external schedulers supported without a Vercel Cron route
- Deterministic EMA, RSI, MACD, momentum, volume, and volatility analysis with confidence-scored decisions persisted to existing decision history
- Independent bounded PostgREST candle reads for every supported interval, preventing global row caps from excluding later timeframes
- Safe WAIT/HOLD outcomes for missing, stale, partial, or invalid analysis data; no writes to portfolio, position, or trade tables
- Scheduler-protected Phase 08 paper-trading endpoint backed by service-role-only PostgreSQL functions
- Stored-decision trade audit links, deterministic idempotency, transaction/advisory locks, and real portfolio snapshots
- €10,000 simulated portfolio provisioning for existing/new profiles without existing portfolios
- Database-enforced position sizing, confidence, cooldown, funds, drawdown, and emergency-stop controls
- Dashboard realized/unrealized P&L summaries and an authenticated portfolio view sourced from persisted rows
- Shared Supabase Realtime manager using the existing authenticated anon-key client, with one deduplicated channel per page surface and only that surface's required tables
- Debounced Realtime events trigger the existing authenticated dashboard, portfolio, scanner, and trade-history APIs; event payloads are ignored
- Supabase reconnect status, browser online/offline and visibility handling, user-visible connection state, and subscription/timer/listener cleanup; existing polling remains the recovery fallback
- Versioned publication migration and automated coverage for change bursts, reconnects, offline recovery, multiple tabs, hidden pages, and cleanup

The presentation layer never receives a service-role key. The public anon key and URL are read from server environment variables and provided to the browser for Supabase Auth. Protected HTML is returned only after the Vercel function validates the session with Supabase Auth.

The following capabilities are not implemented:

- Backtesting
- Strategy Optimization
- Live Trading

Current platform status:

PAPER ACTIVE

Phases 01–10 are complete. Phase 11 implementation and local validation are complete; production migration and live Realtime smoke validation remain pending. Phase 12 has not started. The scanner only ranks stored data; it neither generates AI decisions nor executes trades. The AI Engine remains analysis-only; the separate paper executor applies the Risk Manager to stored decisions.

## Realtime Update Flow

After Auth initializes, the page shares the existing Supabase JS client with the Realtime manager. Dashboard, portfolio, history, and scanner surfaces each subscribe only to their data dependencies; portfolio and history refresh on market-price changes, and scanner candle events are filtered to `1h` and `1d`. The manager ignores row payloads and debounces event bursts for 250 ms before refreshing through the existing authenticated APIs. Data invalidations are also broadcast to other open tabs, and Dashboard, Portfolio, and Trade History align their 30-second fallback polling to the same wall-clock boundaries. Realtime errors and offline periods do not disable visible-tab polling. The client library reconnects the channel; the browser's online and visibility events trigger a catch-up refresh. Each tab owns an independent client/channel, and page disposal removes listeners, pending timers, and the channel. The refresh changes only when existing data is fetched; P&L calculations and API/database structure are unchanged.

---

# Design Principles

CryptoPulse follows:

- Modular Architecture
- Separation of Concerns
- Security First
- Paper Trading First
- Future Live Trading Support
- Test Driven Validation
- Reproducible Calculations
- Database Migration Discipline

---

# System Overview

CryptoPulse is designed as an autonomous multi-layer trading platform.

Primary flow:

Market Data
↓
Market Scanner
↓
AI Engine
↓
Risk Manager
↓
Paper Trading Engine
↓
Portfolio Update
↓
Performance Analysis
↓
Strategy Evaluation

---

# System Layers

## Presentation Layer

Pages:

- index.html
- dashboard.html
- portfolio.html
- scanner.html
- history.html
- settings.html

Responsibilities:

- User Interface
- Visualizations
- Agent Status circuit visualization
- Portfolio Display
- Market Display
- User Settings
- Authentication Interface

The Presentation Layer may never directly access the database.

All data access must occur through approved application services and APIs.

---

## Agent Layer

Responsibilities:

- Market Analysis
- Signal Generation
- Strategy Evaluation
- Strategy Comparison
- Strategy Optimization
- AI Decision Tracking

Modules:

- AI Engine
- Market Scanner
- Strategy Manager
- Performance Analyzer

Outputs:

- BUY
- SELL
- HOLD
- WAIT

The Agent Layer may not bypass the Risk Layer.

---

## Risk Layer

Responsibilities:

- Position Limits
- Portfolio Limits
- Drawdown Controls
- Cooldown Controls
- Confidence Validation
- Emergency Controls

Modules:

- Risk Manager

Risk Manager is the final authority before trade execution.

The AI Engine may never bypass this layer.

---

## Execution Layer

Responsibilities:

- Paper Buy
- Paper Sell
- Position Management
- Portfolio Updates
- Trade Logging

Modules:

- Paper Trading Engine

Current project stage:

PAPER ACTIVE

Future live trading support must remain disabled.

---

## Data Layer

Database:

Supabase PostgreSQL

Responsibilities:

- Authentication Storage
- User Profile Storage
- Portfolio Storage
- Trade Storage
- Strategy Storage
- Market Data Storage
- Historical Data Storage
- Logging

Key Tables:

- AI_Crypto_Bot_Profiles
- AI_Crypto_Bot_Portfolios
- AI_Crypto_Bot_Positions
- AI_Crypto_Bot_Trades
- AI_Crypto_Bot_AI_Decisions
- AI_Crypto_Bot_Status
- AI_Crypto_Bot_Watched_Markets
- AI_Crypto_Bot_Market_Data
- AI_Crypto_Bot_Candles
- AI_Crypto_Bot_Strategies
- AI_Crypto_Bot_Strategy_Changes
- AI_Crypto_Bot_Strategy_Performance
- AI_Crypto_Bot_Backtests
- AI_Crypto_Bot_Portfolio_Snapshots
- AI_Crypto_Bot_Scanner_Events
- AI_Crypto_Bot_Emergency_State

All tables must use the:

AI_Crypto_Bot_

prefix.

The schema is managed only by timestamped files in `supabase/migrations/`. All application tables enable RLS. Authenticated users have read-only access filtered by ownership where applicable; server-side services perform writes. Supabase `service_role` credentials must remain server-only.

---

# Market Universe Management

Default Market Source:

config/markets.js

Purpose:

- Initial deployment
- Initial seeding
- Fallback defaults

Runtime Source Of Truth:

AI_Crypto_Bot_Watched_Markets

The following components must use:

AI_Crypto_Bot_Watched_Markets

- Market Scanner
- AI Engine
- Paper Trading Engine
- Dashboard Metrics
- Strategy Evaluation
- Backtesting

Markets may be:

- Enabled
- Disabled
- Prioritized

without modifying application code.

---

# Phase 06 Market Data Flow

Scheduled candle work batch-reads latest timestamps for each supported interval, skips pairs without a completed new candle, then fetches only the range from the latest stored candle. One overlapping candle is upserted to finalize mutable values; a pair with no history receives a bounded 500-candle bootstrap. Refresh-duration and records-processed metrics are returned by the endpoint and written to function logs.

External scheduler / Vercel Cron where available / authenticated market request
↓
Market Data Service
↓
Public Bitvavo markets, tickers, or candles
↓
Validation and 60-second cache
↓
Existing watched-market, market-data, candle, and scanner-event tables
↓
Authenticated dashboard summary / market response

The service validates markets before adding missing watched-market rows and never overwrites existing user-configured enabled/priority values. Caller JWTs are used for authenticated reads; scheduled refresh and persistence use the server-only Supabase service role. Bitvavo access is public only. Signal generation, scanner decisions, AI, and trading are not part of this phase.

Historical market data is shared across:

- AI Analysis
- Backtesting
- Strategy Evaluation
- Portfolio Valuation

---

# Phase 07 AI Decision Flow

Watched Markets
↓
Stored Market Snapshots and Candles
↓
Deterministic Indicators and Confidence Model
↓
AI_Crypto_Bot_AI_Decisions
↓
Existing Dashboard Recent AI Decisions

Every AI decision must be recorded in:

AI_Crypto_Bot_AI_Decisions

Stored data:

- Market
- Timestamp
- Indicators
- Confidence
- Strategy
- Reason
- Decision

Phase 07 ends at decision persistence and dashboard display. The AI Engine never writes portfolio, position, or trade records; Phase 08 consumes its stored decisions through a separate risk-managed executor.

---

# Phase 08 Paper Trading Flow

Stored AI Decisions + Stored Market Snapshots
↓
Scheduler-authenticated `/api/paper-trading`
↓
Database advisory lock and per-portfolio row lock
↓
Freshness, confidence, position, cooldown, balance, drawdown, and emergency checks
↓
Simulated BUY/SELL with stored fees, slippage, and source decision ID
↓
Position, trade, portfolio balance/value, and snapshot writes in one transaction

BUY opens long positions only; SELL closes existing positions; HOLD and WAIT do not trade. The executor does not contact Bitvavo or any exchange and cannot place a real order. The service role is used only server-side. The database migration grants the scheduler RPC to `service_role` and revokes execution of its internal helpers from browser roles.

Each user profile without a portfolio is provisioned with a €10,000 simulated balance and an initial stored snapshot. Buy notional is capped at 10% of current portfolio value, with no more than five open positions and a 15-minute per-market entry cooldown. New entries stop at 5% daily drawdown or 15% peak drawdown; 20% peak drawdown appends `EMERGENCY_STOP` and sets Agent Status to `STOPPED`. Fresh SELL decisions may close positions during a pause to reduce exposure.

---

# Trading Flow

Market Data
↓
AI Engine
↓
Risk Manager
↓
Paper Trading Engine
↓
Portfolio Update
↓
Performance Tracking

The following costs must be included:

- Fees
- Slippage

Results must remain reproducible.

---

# Portfolio Management

Portfolio calculations must track:

- Available Balance
- Portfolio Value
- Open Positions
- Closed Positions
- Total PnL
- Daily PnL
- Fees
- Drawdown

Portfolio history must be retained.

Snapshots stored in:

AI_Crypto_Bot_Portfolio_Snapshots

---

# Strategy Architecture

Supported Strategy Types:

- Momentum
- Trend Following
- Breakout
- Mean Reversion

All strategies must be:

- Versioned
- Testable
- Comparable
- Auditable

Strategy Storage:

- AI_Crypto_Bot_Strategies
- AI_Crypto_Bot_Strategy_Changes
- AI_Crypto_Bot_Strategy_Performance
- AI_Crypto_Bot_Backtests

---

# Backtesting Architecture

Backtesting is introduced in future phases.

Requirements:

- Historical replay
- Strategy comparison
- Reproducible results
- Fee simulation
- Slippage simulation

Backtesting results must remain separate from paper trading results.

The platform must prevent:

- Lookahead Bias
- Data Leakage

---

# Agent Status Visualization

Data Source:

AI_Crypto_Bot_Status

Supported States:

- ACTIVE
- ANALYZING
- IDLE
- STOPPED
- ERROR

The circuit visualization must reflect actual backend state.

Opening a dashboard page must never activate circuit signals independently of the stored status.

The visual uses the green circuit-board artwork without an outer frame as a static image inside an inline SVG. Its chip shape, trace layout, and dimensions are unchanged; the board image is rendered at 45% opacity to reduce its baked-in glow and is bounded by 90vh. The chip outline retains a subtle static green glow in every state, with a brighter overlay during `ANALYZING`. Status-driven signals start at chip pins, move along trace-aligned routes in four directions, and fade near their route ends. Enlarged signal cores and stronger green halos distinguish moving neurons from the dimmed traces; all neuron halos are substantially brighter, with the strongest green glow during `ANALYZING` and a separate red halo for `ERROR`. A luminance mask derived from the artwork keeps signals visible only on circuit traces. Activity is mapped from database status: moderate green flow (ACTIVE), brighter, faster, and denser green flow (ANALYZING), a few dim green signals (IDLE), red warning signals (ERROR), and a static board for STOPPED or missing/invalid `UNKNOWN` status. `prefers-reduced-motion` also hides moving signals while preserving the static board and accessible status label. The dashboard cannot activate or control the agent; it only visualizes the current status.

The SVG is rendered once and switches activity groups when the existing 15-second status polling or realtime refresh updates its state. This avoids an animation-frame loop, GPU resource allocation, and WebGL or device-pixel-ratio requirements. The markup is cleared when the dashboard controller is disposed.

---

# Emergency State Model

Emergency state is separate from Agent Status.

Emergency State Storage:

AI_Crypto_Bot_Emergency_State

Supported Values:

- NORMAL
- PAUSED
- EMERGENCY_STOP

The circuit visualization must visually indicate emergency conditions.

Emergency controls may:

- Pause Trading
- Disable Strategies
- Disable Markets
- Trigger Emergency Stop

---

# Scheduling Architecture

Scheduled Jobs:

- Market Scanning
- AI Analysis
- Portfolio Updates
- Strategy Evaluation
- Strategy Optimization

Execution Platform:

- External scheduler such as cron-job.org
- Vercel Cron where the deployment plan supports the required schedule
- Scheduled Functions

Requirements:

- Idempotent
- Retry Safe
- Duplicate Safe

Duplicate executions may never create:

- Duplicate Trades
- Duplicate Strategy Changes
- Duplicate Optimizations

See:

docs/SCHEDULING.md

---

# Authentication Architecture

Phase 02 uses Supabase Authentication for registration, password login, logout, recovery email, and password updates. The Supabase JS client persists and refreshes the browser session. An authenticated access token is verified by `/api/auth-session` and stored only in a short-lived HttpOnly cookie for protected-page requests.

Protected Vercel rewrites validate that cookie with Supabase Auth before returning page HTML; invalid or missing sessions are redirected to login. The anon key is public by design. Phase 04's `/api/dashboard-data` endpoint reads the cookie, validates its access token with Supabase Auth, then makes read-only PostgREST requests using the anon key and the same user JWT. Supabase RLS remains authoritative for user-owned rows. The HttpOnly cookie itself is not a database authorization token.

Admin Actions live on a separate protected `admin.html` page. The existing `/api/admin-actions` endpoint verifies the authenticated user against the server-only `ADMIN_USER_IDS` allowlist; the Admin navigation link and page actions remain hidden until that authorization succeeds. The existing endpoint and server-side authorization are reused.

Phase 05's `/api/agent-status` endpoint independently verifies the same cookie and reads only `AI_Crypto_Bot_Status.status` with the user's JWT. The dashboard polls this endpoint every 15 seconds while visible; it pauses polling when hidden and renders no frontend-selected status. Missing or invalid status becomes `UNKNOWN`.

Database data access controls include:

- Row Level Security
- Per-table read policies and ownership checks
- Server-only writes for balances, trades, positions, agent state, and market data
- Explicit ownership validation in future privileged server APIs

The service-role key bypasses RLS and must never be exposed to the presentation layer. Dashboard data is fetched from the API only; browser code must not access Supabase tables directly.

---

# API Architecture

Application API endpoints are implemented through:

Vercel Functions

Examples:

- /api/dashboard-data
- /api/status
- /api/market
- /api/portfolio
- /api/trades
- /api/scan
- /api/analyze
- /api/paper-trading

`GET /api/dashboard-data` is an authenticated, read-only endpoint for the dashboard and portfolio view. It returns current agent and emergency states, RLS-filtered portfolio summaries and counts, recent records, and up to 100 real portfolio snapshots. The portfolio chart renders only persisted snapshots; no synthetic history is generated. Portfolio totals are sums across the authenticated user's visible portfolios. Daily P&L is realized SELL P&L since 00:00 UTC; realized/unrealized totals are `null` when their bounded source queries are incomplete. Win rate is the share of profitable SELL trades across visible trade history.

Database timestamp instants and API values remain UTC. Browser views use the shared `formatTimestamp` utility to display timestamps in `Europe/Brussels`; the IANA timezone rules apply daylight-saving changes automatically. Formatting is presentation-only and does not alter requests, database values, or UTC-based calculations.

`GET /api/agent-status` is an authenticated read-only endpoint for the Agent Status visualization. It reads a single status row and returns a supported status or `null` when no valid row exists. It uses the public anon key plus the verified user's JWT and never writes to the database.

The dashboard API uses only the Supabase anon key and the request user's verified access token. It never uses the service-role key and cannot write to the database. User-visible empty values are represented as `null` or empty collections; read failures return explicit errors rather than mock values.

Future API contracts must document:

- Authentication Rules
- Validation Rules
- Error Responses
- Rate Limiting

must be documented before production use.

---

# Multi Exchange Support

Current Market Provider:

Bitvavo

Future Providers:

- Kraken
- Coinbase
- Binance
- Bybit

Exchange-specific logic must remain isolated.

The AI Engine must operate independently from any single exchange implementation.

---

# Live Trading Architecture

Current Status:

Disabled

Default Configuration:

ENABLE_LIVE_TRADING=false

Future live trading may only become available after:

- Live Trading Preparation
- Live Trading Infrastructure
- Live Trading Validation
- Live Trading Activation

phases have been completed.

Future live trading must reuse existing:

- Risk Manager
- Portfolio Management
- Logging
- Strategy Evaluation

without major architectural rewrites.