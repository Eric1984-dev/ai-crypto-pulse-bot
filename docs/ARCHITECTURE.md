# Architecture

## Current Implementation: Phase 06

The project is a static HTML/CSS/JavaScript application hosted on Vercel. Phase 02 implements Supabase Authentication with server-side Vercel functions for configuration, session-cookie validation, and protected page delivery. Phase 03 adds the Supabase PostgreSQL schema, migrations, seed data, and RLS policies.

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
- Three.js Agent Brain visualization driven by the live database status, with bounded rendering, hidden-tab pause, and explicit resource disposal
- Authenticated public-market API using Bitvavo's market catalog, 24-hour tickers, and supported OHLCV candles
- Non-destructive watched-market validation/synchronization and 60-second in-memory provider caching
- Server-side ticker/candle persistence and scanner-event error logging using the existing RLS-protected tables
- Five-minute scheduled market refresh and dashboard counts for active markets and markets with stored data

The presentation layer never receives a service-role key. The public anon key and URL are read from server environment variables and provided to the browser for Supabase Auth. Protected HTML is returned only after the Vercel function validates the session with Supabase Auth.

The following capabilities are not implemented:

- Realtime functionality
- AI Engine
- Signal-generating Market Scanner
- Paper Trading
- Backtesting
- Strategy Optimization
- Live Trading

Current platform status:

PAPER ACTIVE

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
- Agent Brain Rendering
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

# AI Decision Flow

Market Data
↓
Indicators
↓
AI Engine
↓
Decision Generation
↓
Risk Manager
↓
Paper Trading Engine

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

# Agent Brain

Data Source:

AI_Crypto_Bot_Status

Supported States:

- ACTIVE
- ANALYZING
- IDLE
- STOPPED
- ERROR

The Agent Brain must reflect actual backend state.

Opening a dashboard page must never activate the Agent Brain.

The brain is a front-facing bilateral neural drawing with approximately 16% taller proportions and an anchored lower edge: an irregular outer cortical contour and center fissure frame curved gyri, branching pathways, bright neuron hotspots, and up to 48 traveling energy particles. The 720-node network and 2160 connections define the brain itself; no brain-surface mesh, translucent shell, volume layer, fog, or external circuit traces are used. All neurons receive independent, deterministic pulse phases, while routed signals advance across connected neurons and illuminate their current pathways. Inactive connections remain dim; neuron points and active hotspots provide the visual emphasis. Both hemispheres share one status color. Radial shader halos brighten selected neurons while signals animate; the silhouette remains stable and does not rotate. The database status controls activity density: moderate blue local activation (ACTIVE), many simultaneous blue activations (ANALYZING), occasional soft blue activations (IDLE), near-static grey (STOPPED), and intermittent red neurons/signals (ERROR). Missing or invalid status is `UNKNOWN` with a neutral, static visualization. The fallback is hidden while a WebGL context is available and appears only when WebGL is unavailable or Three.js initialization fails; transient failures can be retried on later status updates. It does not activate or control the agent.

Rendering is capped at 30 FPS and device pixel ratio is capped at 1.5 (1.25 on mobile). The network is capped at 720 nodes, 2160 connections, and 48 traveling energy particles. The loop pauses while the document is hidden. Renderer, geometry, material, observer, and event-listener resources are disposed when the page is left.

---

# Emergency State Model

Emergency state is separate from Agent Status.

Emergency State Storage:

AI_Crypto_Bot_Emergency_State

Supported Values:

- NORMAL
- PAUSED
- EMERGENCY_STOP

The Agent Brain must visually indicate emergency conditions.

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

`GET /api/dashboard-data` is an authenticated, read-only endpoint for the dashboard. It returns current agent and emergency states, RLS-filtered portfolio summaries and counts, recent records, and up to 100 real portfolio snapshots. The portfolio chart renders only persisted snapshots; no synthetic history is generated. Portfolio totals are sums across the authenticated user's visible portfolios. Daily P&L is realized SELL P&L since 00:00 UTC, and win rate is the share of profitable SELL trades across visible trade history.

`GET /api/agent-status` is an authenticated read-only endpoint for the Agent Brain. It reads a single status row and returns a supported status or `null` when no valid row exists. It uses the public anon key plus the verified user's JWT and never writes to the database.

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