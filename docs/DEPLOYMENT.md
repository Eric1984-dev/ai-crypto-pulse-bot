# Deployment Guide

## Phase 02 status

Phase 02 uses Supabase Auth and Vercel Functions for public Auth configuration, session-cookie validation, and protected-page delivery. No database schema, market, trading, or service-role credentials are required.

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
ENABLE_LIVE_TRADING=false
```

For local Vercel Functions, use `vercel dev` so the Vercel runtime loads `.env` and serves `/api/*` routes. Opening the HTML files through a static-only server does not run the protected-page functions.

The anon key is designed for browser use and is returned by `/api/auth-config`; it is not a service secret. Never use or expose a Supabase service-role key. Keep all other secrets in server-side environment variables.

In Supabase Authentication settings, configure the site URL and allow the deployed `/login.html` and `/reset-password.html` redirect URLs for email confirmation and password recovery. Do not configure production Auth redirects to untrusted origins.

`ENABLE_LIVE_TRADING=false` remains the required safe default. Live trading is not implemented or available.