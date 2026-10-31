# CryptoPulse AI Agent - Copilot Instructions

## Source Of Truth

Before every task read:

1. AGENTS.md
2. README.md
3. ROADMAP.md
4. Current phase prompt
5. Relevant documentation

AGENTS.md is the primary source of truth.

If instructions conflict:

AGENTS.md wins.

---

## Project Goal

CryptoPulse is not a simple dashboard.

It is an autonomous AI-powered crypto analysis and trading platform.

The project evolves through stages:

Stage 1
Paper Trading

Stage 2
Backtesting

Stage 3
Strategy Optimization

Stage 4
Live Trading

The architecture must be built from day one to support all future stages.

---

## Technology Stack

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

Avoid introducing additional frameworks.

Do not introduce:

- React
- Next.js
- Angular
- Vue
- Vite

unless explicitly requested by the user.

---

## Autonomous Agent

The platform is designed as an autonomous trading agent.

The agent may:

- Scan markets
- Analyze indicators
- Generate signals
- Open paper positions
- Close paper positions
- Manage a paper portfolio
- Evaluate performance
- Improve trading strategies

without requiring approval for every paper trade.

---

## Risk Management

The agent must always respect:

- Position limits
- Portfolio limits
- Confidence thresholds
- Cooldowns
- Risk controls

The AI agent may not disable or bypass risk controls.

---

## Documentation

Documentation is part of the deliverable.

Update whenever functionality changes.

Always keep:

README.md

ROADMAP.md

CHANGELOG.md

docs/*

synchronized with implementation.

---

## Testing

Testing is mandatory.

Never claim tests passed if they were not executed.

Never fabricate:

- test results
- deployment results
- coverage results

---

## Deployment

Hosting:

Vercel

Database:

Supabase

Never claim deployment succeeded unless verified.

---

## Trading Modes

Current mode:

PAPER ACTIVE

Default:

ENABLE_LIVE_TRADING=false

Future live trading support must be architecturally prepared.

---

## Development Workflow

Follow AGENTS.md.

Complete:

- implementation
- testing
- review
- documentation

before reporting a phase complete.
