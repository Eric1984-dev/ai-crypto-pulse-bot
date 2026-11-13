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
- Candle ingestion stores aligned, closed intervals only, and the AI engine independently rejects incomplete legacy candles while reporting stale/missing/in-progress data. Snapshot tie ordering and the active position-exit state use local additive migration proposals; review and apply them on the Pi before deploying the corresponding runtime code.
- The paper executor uses one active position-aware exit: after a modeled net profit of €3, it ratchets a profit floor using 1.5 × the latest valid 5-minute ATR, with no fixed take-profit or initial stop-loss. High-water uses fresh observed market marks, not tick or intrabar highs; stale or incomplete ATR history cannot create a new stop. The rule is a PAPER starting configuration, not a validated profitability claim.
- Existing shadow-exit records remain available for historical export, but the paper-trading cycle does not evaluate the experimental rule grid and the dashboard no longer shows its monitoring panel.
- The dashboard uses a single administrator account configured on the Pi. Passwords are checked against a bcrypt hash, and the browser receives only the secure session cookie.
- The dashboard activity strip shows the latest runtime-cycle status and scheduled cycle time for AI analysis and paper trading, alongside market-data and actual paper-trade timestamps. Individual stage start/end times are not recorded; on-demand analytics and market scans are not presented as scheduled activity.
- The dashboard's expandable Infrastructure strip sits below the live backend signal, matching its styling without adding another nested card, and shows the device model, service/database status, and host resource metrics.
- A compact Raspberry Pi health indicator appears at the top of the dashboard and uses the existing monitoring read to show green only when services and available host metrics are healthy.
- Dashboard sessions persist in the Pi's systemd-managed state directory, so runtime restarts and Vercel-only deployments do not require a new login before the session expires.
- The Exports page puts complete historical AI-analysis export first. It pages through bounded Pi API responses, creates a `cryptopulse-analysis-ddMMyyyyHHmmss` subfolder in the selected local folder for split JSONL files and an as-of manifest, and does not upload data to an AI service. It writes each selected candle once and preserves all trade/decision window relationships in a separate JSONL file; it does not export the full candle table.
- Monitoring reads the Pi runtime API, including the Raspberry Pi model, scheduler, process, host, and database metrics. The dashboard and Exports page show the Pi model first in their infrastructure metrics. The former archive server is retired and is no longer used.
- `PostgreSQL/migrations/` and `config/markets.js` remain as historical schema/seed provenance and inputs to local PGlite validation. They do not configure a live Supabase runtime.

See [deployment](docs/DEPLOYMENT.md), [API contracts](docs/API.md), [architecture](docs/ARCHITECTURE.md), [scheduling](docs/SCHEDULING.md), and the [Phase 10 cleanup report](docs/post-migration-cleanup-report.md).

## Local validation

```powershell
npm.cmd test
npm.cmd run build
npm.cmd test --prefix raspberry-pi
```

The tests are local checks only. They do not constitute a Pi deployment, production database validation, or Vercel deployment.

## Historical phase documentation

Earlier platform-phase descriptions and reports preserve the pre-migration Supabase/Vercel implementation history. They are not instructions for the current production runtime. The current migration state and retained historical materials are summarized in the [roadmap](ROADMAP.md) and [cleanup report](docs/post-migration-cleanup-report.md).
