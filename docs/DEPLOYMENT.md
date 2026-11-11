# Deployment

## Production topology

```text
Static dashboard and three auth/data bridge functions on Vercel
  -> configured HTTPS API hostname
  -> Cloudflare named Tunnel
  -> loopback-bound Raspberry Pi runtime API
  -> existing PostgreSQL database
```

The operator reports that the Pi runtime, tunnel, dashboard, and authentication are operational. This workspace has not independently verified the live Pi, Cloudflare account, PostgreSQL, or Vercel project. Do not treat local test/build success as deployment evidence.

## Raspberry Pi

The `raspberry-pi/` package owns backend execution and database access. Follow its deployment and operations documentation for the systemd service, PostgreSQL connection, restricted credentials, and runtime environment. Keep the API loopback-bound behind the named Cloudflare Tunnel. Do not expose PostgreSQL or configure a separate scheduler.

The Pi runtime must remain in paper mode with `ENABLE_LIVE_TRADING=false`. The dashboard login username and bcrypt password hash are configured only in the Pi runtime environment. Never store plaintext passwords, database credentials, or Cloudflare tunnel credentials in this repository.

## Vercel dashboard

Vercel serves the static dashboard and exactly three existing functions:

- `api/protected-page.mjs` verifies the Pi session before returning protected HTML.
- `api/auth-session.mjs` proxies login, session lookup, and logout.
- `api/dashboard-data.mjs` proxies allowlisted `/api/v1/` requests.

The current same-origin proxy preserves the secure session-cookie flow. Do not remove these functions or replace them with direct browser-to-Pi requests without a separately validated authentication/CORS design.

Set these build-time environment values for the Vercel deployment:

| Variable | Purpose |
|---|---|
| `CRYPTOPULSE_RUNTIME_API_ORIGIN` | HTTPS origin of the Pi API hostname; no path, query, credentials, or fragment. |
| `CRYPTOPULSE_ENVIRONMENT` | `development`, `validation`, or `production`; Vercel Production cannot be downgraded. |
| `CRYPTOPULSE_ACCESS_ENABLED` | `true` only when Cloudflare Access is enabled for the deployment. |
| `CRYPTOPULSE_ACCESS_AUDIENCE` | Required public audience value when Access is enabled. |

Quick Tunnel origins are for development/validation only; production builds reject them. Build configuration contains public routing values only, never secrets. The root `.env.example` contains placeholders for these settings and the paper-mode safeguard.

The Vercel project uses the repository root for static assets. `vercel.json` runs `npm run build`, protects dashboard HTML routes, and defines no cron jobs. The project validator requires exactly the three active function files and keeps the total below the Hobby limit. `raspberry-pi/` is excluded from the Vercel deployment input.

## Local checks and deployment verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd test --prefix raspberry-pi
```

These commands validate local code only. Production verification must separately check the deployed commit/status, login/session behavior, protected-page redirects, API proxy responses, Pi runtime health, and monitoring. A Git push may trigger the repository's configured Production deployment. This guide does not instruct a manual deployment or Vercel setting change.
