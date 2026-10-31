# Architecture

## Current Implementation: Phase 02

The project is a static HTML/CSS/JavaScript application hosted on Vercel. Phase 02 implements Supabase Authentication with server-side Vercel functions for configuration, session-cookie validation, and protected page delivery.

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

The presentation layer never receives a service-role key. The public anon key and URL are read from server environment variables and provided to the browser for Supabase Auth. Protected HTML is returned only after the Vercel function validates the session with Supabase Auth.

The following capabilities are not implemented:

- Database access
- Custom database schema or RLS policies
- Realtime functionality
- Bitvavo integration
- AI Engine
- Market Scanner
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

# Market Data Flow

Bitvavo
↓
Market Data Service
↓
AI_Crypto_Bot_Candles
↓
AI_Crypto_Bot_Watched_Markets
↓
Market Scanner
↓
AI Engine

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

- Vercel Cron Jobs
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

Protected Vercel rewrites validate that cookie with Supabase Auth before returning page HTML; invalid or missing sessions are redirected to login. The anon key is public by design. No service-role key, custom database access, schema, or RLS policy is used in this phase.

Database ownership and data access controls remain required when Phase 03 introduces application tables:

- Row Level Security
- Access Policies
- User Ownership Validation

---

# API Architecture

Future API endpoints are implemented through:

Vercel Functions

Examples:

- /api/status
- /api/market
- /api/portfolio
- /api/trades
- /api/scan
- /api/analyze

API Contracts:

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