# CryptoPulse AI Agent

CryptoPulse is a paper-trading platform whose autonomous backend runs on a Raspberry Pi. The dashboard remains a static HTML/CSS/JavaScript site hosted by Vercel.

## Current architecture

```text
Browser
  -> Vercel static dashboard and same-origin auth/data bridge
  -> configured HTTPS API hostname
  -> Cloudflare Tunnel
  -> Raspberry Pi runtime
  -> existing PostgreSQL database
```

The bridge preserves the single-admin session cookie and forwards only allowlisted `/api/v1/` requests. Three Vercel functions remain active: login/session proxy, protected-page delivery, and Pi API proxy. No market ingestion, AI, trading, or scheduling runs on Vercel.

Supabase is no longer used by this project. The complete backend—including the API, database access, ingestion, AI, paper trading, scheduling, and monitoring—runs on the Raspberry Pi. Vercel serves the static dashboard and its small authentication/data bridge only.

The operator reports that the Pi runtime, PostgreSQL, ingestion, AI analysis, scheduler, paper trading, Cloudflare Tunnel, dashboard, and authentication are operational. This repository does not independently verify the live Pi, Cloudflare, database, or Vercel configuration. Paper trading is simulated only; `ENABLE_LIVE_TRADING=false` remains required.

## Runtime and dashboard

- The [Raspberry Pi package](raspberry-pi/) owns the API, PostgreSQL repositories, market ingestion, deterministic AI, risk-managed paper trading, scheduler, and operational monitoring.
- Paper trading fetches the latest stored AI decision per enabled watched market through the existing `(symbol, created_at DESC, id DESC)` index rather than scanning and sorting the full decision history. This local query optimization requires no migration; Pi rollout is operator-managed.
- Market Scanner reads only the latest 35 daily and 12 hourly candles per enabled market, and ingestion checkpoints use one latest-row lookup per market. Both use the existing `(symbol, interval, timestamp)` candle index; focused local regressions and measured pre-rollout query comparisons are documented in the [candle query optimization report](docs/reports/CANDLE_QUERY_OPTIMIZATION_REPORT.md). No schema migration is required; Pi rollout remains operator-managed.
- The operator-approved [Pi reset procedure](raspberry-pi/docs/paper-trading-reset.md) can clear paper, market-data, candle, scanner, analytics, and strategy-history data while preserving profiles, watched markets, strategy definitions, agent status, and emergency state; it resets the system portfolio to €2,000 and is never run automatically.
- Candle ingestion stores aligned, closed intervals only, and the AI engine independently rejects incomplete legacy candles while reporting stale/missing/in-progress data. Snapshot tie ordering and position-exit state/reason constraints use local additive migration proposals; review and apply them on the Pi before deploying the corresponding runtime code.
- Paper BUY execution requires explicit daily/hourly EMA trend alignment; missing or conflicting alignment is recorded as a reason-coded skip, while SELL exits remain available. The AI engine applies a 20-point Market Strength/confidence penalty when those trends are misaligned and caps its average ATR volatility penalty at five points; the AI floor (65), executor threshold (70), and executor risk controls are unchanged. Each open position also has a 5% modeled net-loss trigger based on entry basis and modeled exit costs, alongside the existing +€3 net-floor / 1.5 × 5-minute ATR trail. These paper risk thresholds are not validated profitability claims or guaranteed loss ceilings; price gaps may exceed them.
- Existing shadow-exit records remain available for historical export, but the paper-trading cycle does not evaluate the experimental rule grid and the dashboard no longer shows its monitoring panel.
- The dashboard uses a single administrator account configured on the Pi. Passwords are checked against a bcrypt hash, and the browser receives only the secure session cookie.
- The dashboard activity strip shows the latest runtime-cycle status and scheduled cycle time for AI analysis and paper trading, alongside market-data and actual paper-trade timestamps. Individual stage start/end times are not recorded; on-demand analytics and market scans are not presented as scheduled activity.
- Dashboard **Near Buy** lists enabled markets whose latest decision (at most 10 minutes old) is BUY or a directionally aligned HOLD with Market Strength from 15 to below the BUY signal threshold of 20. Markets with an existing open position are omitted. It is a signal watchlist, not a promise that paper-trade execution will pass confidence, cooldown, portfolio, or emergency risk controls. See the [Near Buy report](docs/reports/NEAR_BUY_DASHBOARD_REPORT.md).
- The dashboard's expandable Infrastructure strip sits below the live backend signal, matching its styling without adding another nested card, and shows the device model, service/database status, and host resource metrics.
- A compact Raspberry Pi health indicator appears at the top of the dashboard and uses the existing monitoring read to show green only when services and available host metrics are healthy; the host boot time is aligned at the far right.
- The Settings page can subscribe the installed dashboard to OneSignal Web Push. The Pi sends best-effort alerts after committed paper BUY/SELL trades, including automatic ATR exits, and when persisted agent status enters `ERROR`; no new Vercel function or database migration is added. See [OneSignal setup](docs/ONESIGNAL.md).
- Dashboard sessions persist in the Pi's systemd-managed state directory, so runtime restarts and Vercel-only deployments do not require a new login before the session expires.
- The Exports page provides complete historical AI-analysis export through bounded Pi API pages into split JSONL files and an as-of manifest, without uploading data to an AI service. Format v4 includes per-evaluation directional paper-execution outcomes (BUY/SELL), with trade IDs where available, and keeps all AI decisions in the decisions JSONL. To reduce export size, candle windows are selected around trades and their linked AI decisions, not every non-executed decision; source counts and anchor/candle/link invariants are checked before the manifest can report completion. The export uses full-precision keyset cursors to avoid skipping rows at PostgreSQL microsecond timestamp boundaries. Phase 8.15 creates the audit table; Phase 8.16 grants the paper writer SELECT only on the idempotency-key columns required by `ON CONFLICT`. The operator reports applying Phase 8.15 and the missing column grant to the Pi, followed by a successful paper-trading cycle. Apply Phase 8.16 on the Pi before deploying code that validates this grant.
- Monitoring reads the Pi runtime API, including the Raspberry Pi model, scheduler, process, host, and database metrics. The dashboard and Exports page show the Pi model first in their infrastructure metrics. The former archive server is retired and is no longer used.
- `PostgreSQL/migrations/` and `config/markets.js` remain as historical schema/seed provenance and inputs to local PGlite validation. They do not configure a live Supabase runtime.

See [deployment](docs/DEPLOYMENT.md), [database access and design](docs/DATABASE.md), [API contracts](docs/API.md), [architecture](docs/ARCHITECTURE.md), [scheduling](docs/SCHEDULING.md), and the [Phase 10 cleanup report](docs/post-migration-cleanup-report.md).

## Local validation

```powershell
npm.cmd test
npm.cmd run build
npm.cmd test --prefix raspberry-pi
```

The tests are local checks only. They do not constitute a Pi deployment, production database validation, or Vercel deployment.

## Historical phase documentation

Earlier platform-phase descriptions and reports preserve the pre-migration Supabase/Vercel implementation history. They are not instructions for the current production runtime. The current migration state and retained historical materials are summarized in the [roadmap](ROADMAP.md) and [cleanup report](docs/post-migration-cleanup-report.md).
