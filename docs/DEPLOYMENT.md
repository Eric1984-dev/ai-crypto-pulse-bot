# Deployment Guide

## Phase 02 status

Phases 02-06 use Supabase Auth and Vercel Functions for protected pages, dashboard data, and public Bitvavo market data. Phase 03 adds PostgreSQL tables and RLS through Supabase migrations; Phase 06 uses those existing tables and adds no schema migration. Apply reviewed database migrations separately with the Supabase CLI.

## Hosting

CryptoPulse AI Agent is designed to run on:

- Vercel
- Supabase

Import the repository into Vercel with the repository root as the project root. The project is framework-free: `vercel.json` sets `outputDirectory` to `.` because the static HTML/CSS/JS files live in the repository root. This overrides a stale Project Settings value such as `public`; no `public/` folder or generated build directory is required. The same config enables clean URLs and orders protected-page routes before the filesystem handler, so root-level static HTML cannot bypass the authentication function.

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
CRON_SECRET=long-random-cron-secret
ENABLE_LIVE_TRADING=false
```

For local Vercel Functions, use `vercel dev` so the Vercel runtime loads `.env` and serves `/api/*` routes. Opening the HTML files through a static-only server does not run the protected-page functions.

The anon key is designed for browser use and is returned by `/api/auth-config`; it is not a service secret. `SUPABASE_SERVICE_ROLE_KEY` allows only server-side market synchronization, AI analysis, and database writes; `CRON_SECRET` protects `/api/market-refresh` and `/api/ai-analysis`. Keep both secrets out of browser configuration and logs. Bitvavo access uses public endpoints without an API key.

### External scheduled market refresh

The market refresh function remains available at `/api/market-refresh`, but `vercel.json` does not declare a Vercel Cron schedule. This keeps deployment compatible with Vercel Hobby. The endpoint updates stale ticker snapshots and scheduled candles for enabled watched markets. Configure an external scheduler such as cron-job.org:

1. Set the task URL to `https://<your-deployment-host>/api/market-refresh`.
2. Select `GET` and a schedule supported by the scheduler.
3. Add the HTTP header `Authorization: Bearer <CRON_SECRET>`, using the same secret configured as a server-side Vercel environment variable.
4. Do not include the secret in the URL, query string, or task name. Confirm successful runs return HTTP `200`.

Vercel Cron can still be used on plans that support the chosen schedule; it is not required by project validation.

### External AI analysis

Phase 07 exposes `POST /api/ai-analysis` for an external scheduler. Configure the deployed URL and method, then add `Authorization: Bearer <CRON_SECRET>` using the same server-side Vercel environment variable. The function also requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep the credentials in protected environment/header settings and never in the request URL. No scheduler cadence is imposed by the application.

In Supabase Authentication settings, configure the site URL and allow the exact deployed `/login.html` and `/reset-password.html` redirect URLs for email confirmation and password recovery. Supabase can fall back to the configured site URL when a requested redirect does not match the allowlist, which may send recovery links to the site root. Do not configure production Auth redirects to untrusted origins.

`ENABLE_LIVE_TRADING=false` remains the required safe default. Live trading is not implemented or available.