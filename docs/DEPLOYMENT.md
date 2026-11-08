# Deployment Guide

## Current status

Phases 02-08 use Supabase Auth and Vercel Functions for protected pages, dashboard data, public Bitvavo market data, AI analysis, and paper trading. Apply reviewed PostgreSQL migrations separately with the Supabase CLI before enabling the scheduled paper-trading endpoint.

## Hosting

CryptoPulse AI Agent is designed to run on:

- Vercel
- Supabase

Import the repository into Vercel with the repository root as the project root. The project is framework-free: `vercel.json` sets `outputDirectory` to `.` because the static HTML/CSS/JS files live in the repository root. This overrides a stale Project Settings value such as `public`; no `public/` folder or generated build directory is required. The same config enables clean URLs and orders protected-page routes before the filesystem handler, so root-level static HTML cannot bypass the authentication function.

The root `.vercelignore` excludes `/archive-server/` from Vercel deployments. The directory remains in Git for Raspberry Pi installation and updates; `.vercelignore` excludes it from Vercel's deployment input but does not remove it from the Git repository. Keep `archive-server/.env` and other Pi-only credentials out of Git.

### iPhone home-screen icon

Every page declares the shared 180×180 Apple Touch Icon and the `CryptoPulse` home-screen title. After the site is deployed over HTTPS, open it in Safari on iPhone, tap **Share**, then **Add to Home Screen**. If an older icon is already installed, remove that shortcut and add it again so iOS fetches the updated icon. This adds a home-screen shortcut; it does not provide offline support.

Run local checks before deployment:

```powershell
npm.cmd test
npm.cmd run build
```

---

## Environment Variables

Set these variables in a local ignored `.env` file and in Vercel Project Settings:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
ARCHIVE_SERVER_URL=https://archive.example
ARCHIVE_HEALTH_TOKEN=at-least-32-random-bytes
CRON_SECRET=long-random-cron-secret
AI_ANALYSIS_MODE=javascript
ENABLE_LIVE_TRADING=false
```

`AI_ANALYSIS_MODE` defaults to `javascript`, which remains the standard engine. The optional `database` value is only for the local database-side prototype and must not be set until migration `20261106120000_ai_analysis_database_mode.sql` has been manually reviewed and applied to the intended Supabase project and the rollout prerequisites in the [prototype report](./reports/AI_ANALYSIS_DATABASE_MODE_PROTOTYPE_REPORT.md) are met. An RPC failure marks agent status `ERROR` and returns an unavailable response; it never falls back to JavaScript.

For local Vercel Functions, use `vercel dev` so the Vercel runtime loads `.env` and serves `/api/*` routes. Opening the HTML files through a static-only server does not run the protected-page functions.

The anon key is designed for browser use and is returned by `/api/auth-config`; it is not a service secret. `SUPABASE_SERVICE_ROLE_KEY` allows only server-side market synchronization, AI analysis, and database writes; `CRON_SECRET` protects `/api/market-refresh`, `/api/candle-refresh`, and `/api/ai-analysis`. Keep both secrets out of browser configuration and logs. Bitvavo access uses public endpoints without an API key.

`ARCHIVE_SERVER_URL` is the HTTPS base URL exposed by a trusted tunnel/reverse proxy to the Raspberry Pi health service. Vercel cannot directly route to a private LAN address. Configure the tunnel to forward to `127.0.0.1:3001`; the service binds to loopback by default. `ARCHIVE_HEALTH_TOKEN` must be a random value of at least 32 bytes and must match in Vercel and the Pi service. The existing authenticated `/api/dashboard-data?view=archive-health` handler sends the token in a server-side Authorization header; neither the URL nor token is exposed to browser code.

Run the standalone service from `archive-server/` on the Pi. Copy `archive-server/.env.example` to an ignored `.env` file and set `ARCHIVE_DB_HOST`, `ARCHIVE_DB_PORT`, `ARCHIVE_DB_NAME`, `ARCHIVE_DB_USER`, `ARCHIVE_DB_PASSWORD`, and the same `ARCHIVE_HEALTH_TOKEN`. These database variables belong only on the Pi and must never be copied to Vercel or the browser. The service requires PostgreSQL TLS with certificate verification enabled. Set `ARCHIVE_DB_SSL_CA` when the PostgreSQL server uses a private certificate authority; set `ARCHIVE_DB_SSL_SERVERNAME` only when the trusted certificate DNS name differs from `ARCHIVE_DB_HOST`. TLS is not downgraded if verification fails. `ARCHIVE_DISK_PATH` selects the filesystem whose usage is reported.

Install the service's isolated dependency and run it with Node.js 20.6 or newer:

```powershell
cd archive-server
npm.cmd ci
npm.cmd start
```

### Manual AI decision archive pull

The archive CLI and health service run on the Raspberry Pi. The root `.vercelignore` excludes `archive-server/` from Vercel deployment while leaving it versioned in Git for Pi installation and updates. Do not deploy it as a separate Vercel project or serverless function, expose the sync CLI through the health tunnel, or configure an automatic timer for this proof of concept. Vercel uses the existing authenticated `/api/dashboard-data?view=archive-health` handler only to proxy health status to the Pi; no archive-sync Vercel function is needed. The user reports that the first manual `npm run sync:ai-decisions` run succeeded and copied data to the Pi archive; exact row counts were not provided or independently verified. Keep the Supabase reader and archive writer credentials on the Pi, use verified TLS, and never use the service-role key. Follow the [AI decision archive installation guide](./reports/AI_DECISION_ARCHIVE_AGENT_INSTALLATION.md) and [validation guide](./reports/AI_DECISION_ARCHIVE_AGENT_VALIDATION.md) for future manual runs and checks.

Configure the HTTPS tunnel to forward only the health path to the loopback service and apply tunnel access controls in addition to the bearer token. The health endpoint accepts only `GET /api/health`, returns no-store responses, and does not expose database errors. Missing settings, invalid TLS, or unreachable services result in Offline status in the dashboard. The tunnel, Pi environment, and production endpoint must be verified separately; code/build tests do not establish production connectivity.

### External scheduled market refresh

`/api/market-refresh` is snapshot-only and remains available without a Vercel Cron declaration, preserving Vercel Hobby compatibility. Configure an external task such as cron-job.org:

1. Use `GET https://<your-deployment-host>/api/market-refresh`.
2. Add the `Authorization: Bearer <CRON_SECRET>` header using the protected scheduler header settings.
3. Set a snapshot cadence appropriate to the dashboard freshness target; five minutes is a reasonable starting point.

This endpoint synchronizes valid watched markets and refreshes ticker snapshots only. It does not collect candles.

### External scheduled candle refresh

Candle ingestion is isolated at `/api/candle-refresh?interval=<interval>&batch=<index>`. Create scheduled GET requests for each required interval (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) and each batch index returned in the endpoint's `batchCount`. Each request handles at most five enabled, valid markets for one interval. For example, 102 eligible markets require batches `0` through `20`. Stagger requests where the scheduler allows it to avoid bursts, and choose a cadence that completes the full batch cycle within the desired freshness window.

Use the same protected `Authorization: Bearer <CRON_SECRET>` header. Configure an HTTP timeout of at least 90 seconds and monitor returned `candleRefreshDurationMs`, `recordsProcessed.candles`, `providerRequests`, status, and batch count. Verify actual deployed durations; provider or database outages can still cause partial refreshes. Do not put credentials in the URL or task name.

### External AI analysis

The JavaScript engine remains the default. Do not opt into database analysis until its additive migration is applied manually, the function grants and signature are verified, and the production rollout is separately approved. The migration adds no tables or Vercel Functions. Local migration/tests do not apply it to Supabase.

Phase 07 exposes `POST /api/ai-analysis` for an external scheduler. Configure the deployed URL and method, then add `Authorization: Bearer <CRON_SECRET>` using the same server-side Vercel environment variable. The function also requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep the credentials in protected environment/header settings and never in the request URL. No scheduler cadence is imposed by the application.

In Supabase Authentication settings, configure the site URL and allow the exact deployed `/login.html` and `/reset-password.html` redirect URLs for email confirmation and password recovery. Supabase can fall back to the configured site URL when a requested redirect does not match the allowlist, which may send recovery links to the site root. Do not configure production Auth redirects to untrusted origins.

### External paper-trading execution

After `/api/ai-analysis` completes successfully, configure an external scheduler to call `POST https://<your-deployment-host>/api/paper-trading` with the same protected cron authorization header. Use the same cadence as analysis and do not run the jobs concurrently. Verify that migration `20261101154600_phase08_paper_trading.sql` has been reviewed and applied first. Check the returned status and execution metrics after setup. This endpoint uses stored AI decisions and market snapshots only and never sends an exchange order.

The endpoint requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `ENABLE_LIVE_TRADING=false`. It returns `503` if the live-trading flag is configured to anything other than `false`.

`ENABLE_LIVE_TRADING=false` remains the required safe default. Live trading is not implemented or available; do not change this value.