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

The operator reports that the Pi runtime, PostgreSQL, ingestion, AI analysis, scheduler, paper trading, Cloudflare Tunnel, dashboard, and authentication are operational. This repository does not independently verify the live Pi, Cloudflare, database, or Vercel configuration. Paper trading is simulated only; `ENABLE_LIVE_TRADING=false` remains required.

## Runtime and dashboard

- The [Raspberry Pi package](raspberry-pi/) owns the API, PostgreSQL repositories, market ingestion, deterministic AI, risk-managed paper trading, scheduler, and operational monitoring.
- The dashboard uses a single administrator account configured on the Pi. Passwords are checked against a bcrypt hash, and the browser receives only the secure session cookie.
- Monitoring reads the Pi runtime API, including scheduler, process, host, and database metrics. It does not depend on the separate archive service.
- The optional [archive service](archive-server/) contains a manual, copy-only historical-decision utility and a standalone health service. It is not a trading or scheduler dependency; its retirement has not been confirmed.
- `supabase/migrations/` and `config/markets.js` remain as historical schema/seed provenance and inputs to local PGlite validation. They do not configure a live Supabase runtime.

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
