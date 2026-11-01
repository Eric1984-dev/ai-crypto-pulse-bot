# CryptoPulse AI Agent

Version: 1.0

This file is the primary source of truth for the entire project.

All development must follow the rules defined in this document.

---

# 1 Project Vision

CryptoPulse AI Agent is a crypto analysis and trading platform.

The platform evolves through stages.

Stage 1:

Paper Trading Platform

Stage 2:

Backtesting Platform

Stage 3:

Strategy Optimization Platform

Stage 4:

Live Trading Platform

The system must be built from day one with future live-trading support in mind.

However:

The current project starts in Paper Trading mode.

---

# 2 Current Trading Mode

Default:

PAPER ACTIVE

All positions, balances, profits and losses are simulated.

No real money may be used during Paper Trading phases.

---

# 3 Future Live Trading Support

Live Trading is a planned future capability.

The architecture must support future Live Trading.

However:

Live Trading may only be activated when:

- Live Trading phases have been completed
- Risk controls are implemented
- User explicitly enables:

ENABLE_LIVE_TRADING=true

Until then:

ENABLE_LIVE_TRADING=false

must remain the default.

---

# 4 Technology Constraints

Frontend:

- HTML
- CSS
- JavaScript

Backend:

- Vercel Functions
- Supabase

Libraries:

- Three.js
- Chart.js

Avoid unnecessary dependencies.

---

# 5 Dashboard Requirements

Always display:

Portfolio Value

Total P&L

Daily P&L

Win Rate

Open Positions

Available Balance

AI Decisions

Paper Trades

Tracked Markets

---

# 6 Agent Brain

The dashboard must contain:

3D Agent Brain

Supported states:

ACTIVE

ANALYZING

IDLE

STOPPED

ERROR

Status must be obtained from:

AI_Crypto_Bot_Status

The brain may not animate solely because the dashboard is open.

---

# 7 Market Coverage

Markets must be managed centrally.

config/markets.js contains the default market list.

AI_Crypto_Bot_Watched_Markets is the runtime source of truth.

All scanning, analysis and trading decisions must use:

AI_Crypto_Bot_Watched_Markets

as the active market universe.

---

# 8 AI Engine Principles

The AI engine may recommend:

BUY

SELL

HOLD

WAIT

The AI engine may generate autonomous paper trading decisions.

Execution must occur through:

AI Engine
↓
Risk Manager
↓
Paper Trading Engine

The AI engine may not bypass the Risk Manager.


---

# 9 Risk Management

Every trade decision must pass through:

Risk Manager

before execution.

Standard rules:

Maximum Position Size:
10%

Maximum Open Positions:
5

Minimum Confidence:
70

Cooldown:
15 minutes

Paper Fee:
0.25%

Paper Slippage:
0.10%

Daily Drawdown Limit:
5%

Maximum Portfolio Drawdown:
15%

Emergency Stop Loss:
20%

---

# 10 Data Validation

Validate:

- API responses
- AI responses
- Database inputs
- User inputs

Reject invalid data.

Fail safely.

---

# 11 Security

Never:

- hardcode credentials
- expose secrets
- store secrets in repository
- print secrets to logs

Always use:

.env

and

.env.example

---

# 12 Database Rules

Use migrations.

Do not silently modify schema.

All database changes:

- migration
- documentation update
- verification

required.

---

# 13 Testing Requirements

Testing is mandatory.

Required when applicable:

- Unit Tests
- Integration Tests
- Build Tests
- API Tests
- Security Tests
- Regression Tests

Never invent results.

Never report unexecuted tests as passed.

Coverage targets must not be invented.

If coverage tooling is configured:

- report actual coverage
- report untested areas
- report blocked tests

Do not claim coverage targets were met unless measured.

---

# 14 Documentation Requirements

Documentation must stay synchronized with implementation.

Store generated reports in `docs/reports/`, including future phase, validation, fix, audit, and enhancement reports. Do not create report files in the repository root; update links when reports move.

Update when applicable:

README.md

ROADMAP.md

CHANGELOG.md

DATABASE.md

API.md

DEPLOYMENT.md

TESTING.md

RISK_MANAGEMENT.md

ARCHITECTURE.md

KNOWN_ISSUES.md

OPERATIONS_LOG.md

---

# 15 Development Workflow

For every phase:

Step 1

Understand requirements

Step 2

Plan implementation

Step 3

Implement

Step 4

Test

Step 5

Fix issues

Step 6

Review

Step 7

Document

Step 8

Report

---

# 16 Phase Governance

Only work on the current phase.

Future phases may be prepared for architecturally.

Future phase features may not be activated prematurely.

---

# 17 Deployment

Hosting:

Vercel

Database:

Supabase

Environment configuration must be documented.

Never claim deployment success unless verified.

---

# 18 Future Roadmap

Phase 15

Backtesting Engine

Phase 16

Strategy Optimization

Phase 17

Autonomous Agent Enhancement

Phase 18

Live Trading Preparation

Phase 19

Live Trading Infrastructure

Phase 20

Live Trading Activation

Only after completion of the Live Trading phases:

ENABLE_LIVE_TRADING=true

may be used.

---

# 19 Definition Of Done

A phase is complete only when:

- functionality implemented
- tests executed
- tests passed
- documentation updated
- review completed
- acceptance criteria met

If not:

the phase is not complete.

---

# 20 Final Rule

When in doubt:

choose the safest option

and document the decision.

# 21 Autonomous Agent Behaviour

CryptoPulse is intended to operate as an autonomous agent.

The purpose of the platform is not merely to provide indicators.

The agent is expected to autonomously manage a simulated portfolio.

The agent may:

- Scan configured markets
- Analyze price movements
- Compare opportunities
- Generate BUY decisions
- Generate SELL decisions
- Generate HOLD decisions
- Generate WAIT decisions
- Open paper positions
- Close paper positions
- Set stop losses
- Set take profits
- Evaluate performance

without requiring approval for individual paper trades.

All actions must be logged.

# 22 Strategy Management

The platform must support multiple strategies.

Examples:

- Momentum
- Trend Following
- Breakout
- Mean Reversion

Strategies must be:

- versioned
- testable
- measurable
- comparable

Strategies must expose:

- win rate
- profit factor
- average profit
- average loss
- total trades

# 23 Self Optimization

The platform must support optimization.

The agent may:

- compare strategy performance
- compare indicator combinations
- compare confidence thresholds
- compare market universes

The agent may recommend and apply strategy improvements during paper trading.

All changes must:

- be logged
- be reversible
- be traceable

# 24 Backtesting

Future phases must support backtesting.

Backtesting results must be separated from paper trading results.

All backtests must account for:

- fees
- slippage
- spread

The platform must avoid:

- lookahead bias
- data leakage

Backtests must be reproducible.

# 25 Market Scanner

The Market Scanner continuously evaluates:

- Top Gainers
- Top Losers
- Volume Spikes
- Momentum
- AI Signals

The scanner must operate across all configured markets.

The scanner must support mobile and desktop.

# 26 Market Universe

Markets must be managed centrally.

config/markets.js contains the default market list used during initial setup and database seeding.

After initialization:

AI_Crypto_Bot_Watched_Markets

becomes the runtime source of truth.

All of the following components must use:

AI_Crypto_Bot_Watched_Markets

- Market Scanner
- AI Engine
- Paper Trading Engine
- Dashboard Metrics
- Strategy Evaluation
- Backtesting

Markets may be:

- enabled
- disabled
- prioritized

without code modifications.

Changes to active markets must be stored in:

AI_Crypto_Bot_Watched_Markets.

# 27 Strategy Database

The platform should support:

AI_Crypto_Bot_Strategies

AI_Crypto_Bot_Strategy_Changes

AI_Crypto_Bot_Backtests

AI_Crypto_Bot_Strategy_Performance

Every strategy modification should be historically traceable.

# 28 Agent Learning Rules

The agent may optimize:

- confidence levels
- ranking models
- indicator weights
- market priorities

The agent may not:

- change deployment settings
- disable security controls
- activate live trading
- modify environment variables

All optimization actions must be logged.

# 29 Extended Dashboard Requirements

In addition to core metrics:

Display:

- Agent Status
- Active Strategy
- Strategy Version
- Strategy Score
- Decisions Today
- Tracked Markets
- Daily Performance
- Weekly Performance
- Monthly Performance
- Agent Optimizations
- Backtests
- Portfolio Snapshots
- Market Scanner Events

# 30 Logging Rules

Log:

- AI decisions
- Paper trades
- Portfolio updates
- Strategy changes
- Login events
- Errors
- Market data failures

Logs must never expose secrets.

# 31 Live Trading Preparation

The platform is expected to eventually support live trading.

Current phases remain paper trading.

The architecture must be designed so that future live trading can be added without major rewrites.

# 32 Live Trading Restrictions

Live trading may only be activated when:

- dedicated live trading phases completed
- validation completed
- risk controls completed
- audits completed

and:

ENABLE_LIVE_TRADING=true

Until then:

ENABLE_LIVE_TRADING=false

# 33 Agent Performance Tracking

Track:

- win rate
- profit factor
- net performance
- drawdown
- strategy score
- average trade duration

Performance history must be retained.

# 34 Failure Handling

The agent must fail safely.

If:

- market data unavailable
- invalid AI response
- configuration invalid
- database unavailable

then:

- no new positions opened
- error logged
- status updated

The system should recover automatically when possible.

If duplicate execution is detected:

- prevent duplicate paper trades
- prevent duplicate strategy changes
- prevent duplicate optimization events

Scheduled jobs must be idempotent.

# 35 Long-Term Goal

CryptoPulse should evolve into a fully autonomous trading platform.

Capabilities:

- market scanning
- strategy evaluation
- strategy optimization
- backtesting
- paper trading
- future live trading

while maintaining transparency, reproducibility and risk controls.

# 36 Market Data Requirements

The platform must collect and maintain historical market data.

Supported intervals:

- 1m
- 5m
- 15m
- 1h
- 4h
- 1d

For each candle store:

- Open
- High
- Low
- Close
- Volume

Historical data must be available for:

- AI analysis
- Backtesting
- Strategy optimization

The Market Scanner and AI Engine must use the same source data.

# 37 AI Decision Tracking

Every AI decision must be recorded.

Store:

- market
- timestamp
- indicators
- decision
- confidence
- strategy
- reason

This history must remain available for future analysis.

The platform must be able to compare:

- decision quality
- decision accuracy
- strategy performance

# 38 Portfolio Requirements

The platform must maintain a virtual portfolio.

Track:

- Available Balance
- Portfolio Value
- Open Positions
- Closed Positions
- Total PnL
- Daily PnL
- Fees
- Drawdown

All calculations must remain reproducible.

Portfolio history must be retained.

# 39 Strategy Ranking

Strategies must be ranked.

Metrics:

- Win Rate
- Net Profit
- Profit Factor
- Drawdown
- Risk Adjusted Return

The ranking system must be transparent.

The platform must display:

- Active Strategy
- Best Performing Strategy
- Historical Performance

# 40 Emergency Controls

The platform must support:

- Global Trading Pause
- Emergency Stop
- Disable Strategy
- Disable Market

During Emergency Stop:

- No new positions may be opened
- Existing positions remain visible

The Agent Brain must indicate emergency state.

Emergency State Values:

NORMAL
PAUSED
EMERGENCY_STOP

The Agent Brain should visually reflect the current emergency state.

Emergency State is independent from Agent Status.

Agent Status values:

ACTIVE
ANALYZING
IDLE
STOPPED
ERROR

Emergency State values:

NORMAL
PAUSED
EMERGENCY_STOP

# 41 Multi Exchange Support

The architecture should support future exchanges.

Examples:

- Bitvavo
- Kraken
- Coinbase
- Bybit
- Binance

Exchange-specific logic must remain isolated.

The AI Engine should not depend directly on a specific exchange.

# 42 Database Naming Convention

CryptoPulse will be deployed into an existing database.

To avoid naming conflicts with existing tables,
all project tables must use a mandatory prefix.

Required prefix:

AI_Crypto_Bot_

Examples:

AI_Crypto_Bot_Profiles

AI_Crypto_Bot_Portfolios

AI_Crypto_Bot_Positions

AI_Crypto_Bot_Trades

AI_Crypto_Bot_AI_Decisions

AI_Crypto_Bot_Status

AI_Crypto_Bot_Strategies

AI_Crypto_Bot_Backtests

AI_Crypto_Bot_Candles

AI_Crypto_Bot_Watched_Markets

The prefix is mandatory.

No project table may be created without this prefix.

All migrations, views, functions, indexes and policies should follow the same naming convention when practical.

# 43 Scheduling Requirements

The platform relies on scheduled execution.

Required job categories:

- Market Scanning
- AI Analysis
- Portfolio Updates
- Strategy Evaluation
- Strategy Optimization

Scheduled jobs must:

- be idempotent
- be retry safe
- prevent duplicate executions
- prevent duplicate trades

The scheduling system must support:

- Vercel Cron Jobs
- Scheduled Functions

Scheduling frequency is documented in:

docs/SCHEDULING.md

# 44 AI Approach

Phase 07 implements a deterministic trading engine.

Indicators:

- RSI
- EMA
- MACD
- Momentum
- Volume

No external AI provider is required.

The platform must function without:

- OpenAI
- Azure OpenAI
- Claude
- Gemini

Future phases may introduce external AI providers.

Current phases must remain functional without external AI services.