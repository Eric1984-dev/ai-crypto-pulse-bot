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

- Raspberry Pi Node.js runtime and PostgreSQL
- Vercel static hosting and limited authentication/data bridge
- Cloudflare Tunnel

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

Store all new project reports (phase, validation, fix, audit, and enhancement reports) in `docs/reports/`. Do not create reports in the repository root, and update any links when moving existing reports.

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

Existing PostgreSQL database on the Raspberry Pi

Never claim deployment succeeded unless verified.

## PostgreSQL Access

The active production database is PostgreSQL on the Raspberry Pi; Supabase is historical and is not the active runtime database. The operator can open a local SSH tunnel with:

```bash
ssh -N -L 5433:localhost:5432 eric@192.168.0.121
```

When the operator has opened the tunnel, connect to `localhost:5433` through the configured PostgreSQL integration/client and use existing local configuration for the database name and credentials. The tunnel does not provide PostgreSQL credentials. The operator owns starting and stopping the tunnel; do not start, stop, or leave it running on the operator's behalf. If it is unavailable, ask the operator to open it before concluding the database is unreachable.

Use read-only queries by default. Production writes or migrations require explicit user authorization and must follow the Raspberry Pi migration procedure. Never hardcode, expose, or log database credentials.

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

WARNING

Project is deployed on Vercel Hobby.

Maximum:
12 Serverless Functions

Any implementation that introduces a new file under /api must first:

- count current functions
- justify the new function
- propose reuse of existing endpoints

Prefer:

- lib/*
- services/*
- shared modules

Vercel Hobby Constraint

Maximum:
12 Serverless Functions

Current deployments must remain within the Hobby limit.

DO NOT create a new file under /api unless explicitly approved.

Before creating any new /api endpoint:

1. Count all existing functions.
2. Reuse existing routes whenever possible.
3. Extend existing endpoints whenever possible.
4. Justify why the new endpoint cannot be merged into an existing endpoint.

Deployment must fail review if function count exceeds the Hobby limit.

Dashboard Administration

Prefer dashboard-admin controls over creating scheduler-only workflows.

When functionality already exists through:

- /api/ai-analysis
- /api/paper-trading

reuse those endpoints.

Do not create dedicated admin API routes when existing endpoints can be invoked securely.

Phase Completion Rule

A phase may not be considered completed until:

- Production deployment succeeds.
- Database migrations are applied.
- Production validation is executed.
- Runtime behaviour is verified.

Passing tests and builds alone do not mark a phase complete.