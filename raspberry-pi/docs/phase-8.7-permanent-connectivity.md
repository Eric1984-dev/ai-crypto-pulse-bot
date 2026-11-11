# Phase 8.7 — Permanent API Connectivity

## Scope and current architecture

The operator reports that the Raspberry Pi runtime, PostgreSQL, AI, scheduler, paper trading, named Cloudflare Tunnel `ai-crypto-pulse-bot`, Quick Tunnel and dashboard API are operational. This report does not independently access the Pi, Cloudflare account, DNS, Vercel project or live dashboard. It records repository findings and the permanent connectivity implementation.

The intended production path is:

```text
Browser
  -> static dashboard on Vercel
  -> HTTPS https://api.<operator-domain>
  -> Cloudflare DNS and named Tunnel: ai-crypto-pulse-bot
  -> cloudflared on Raspberry Pi
  -> http://127.0.0.1:3002
  -> read-only Raspberry Pi API
  -> PostgreSQL on the Pi
```

The Node API remains loopback-bound. Cloudflare Tunnel creates outbound connections, so no inbound port forwarding or direct PostgreSQL exposure is needed. A stable hostname belongs to an operator-owned DNS zone managed by Cloudflare; `api.example.com` below is only a placeholder.

## Connectivity audit

| Finding | Evidence |
|---|---|
| The dashboard API origin was a Quick Tunnel URL embedded in `js/runtime-api-config.js`. | The config file is loaded by the dashboard pages and feeds `js/runtime-api.js`. |
| The static Vercel project had no build-time environment substitution for the browser config. | The existing config was a literal JavaScript object; the Vercel config had no explicit build command. |
| No Pi-side `cloudflared` ingress file or stable API hostname was present in the repository. | The Pi deployment directory contained the runtime systemd unit but no tunnel route/configuration. |
| The named tunnel exists operationally according to the operator, but the tunnel UUID, DNS zone, public hostname and active ingress target are not recorded here. | No Cloudflare account or live Pi checks were performed. |

Quick Tunnel hostnames are temporary testing endpoints, not production origins. Phase 8.7.1 permits them only in development or validation mode; production builds continue to reject all `trycloudflare.com` hostnames.

## Permanent tunnel design

Use the existing named tunnel `ai-crypto-pulse-bot` and publish one stable HTTPS hostname, for example `api.example.com`. Configure its public-hostname route to forward to `http://127.0.0.1:3002`. Cloudflare creates or updates the DNS route for the named tunnel; HTTPS terminates at Cloudflare. Keep `API_HOST=127.0.0.1`, configure `API_CORS_ORIGINS` with the exact Vercel dashboard origin, and do not expose the Pi API port or PostgreSQL to the Internet.

The repository includes a local-managed configuration example at [cloudflared-config.example.yml](../deploy/cloudflared-config.example.yml). It contains placeholders, not the live tunnel UUID, credential path or domain. For a dashboard-managed tunnel, configure the same hostname and origin in Cloudflare Zero Trust's Public Hostnames instead of applying the local ingress example. Do not configure conflicting ingress routes in both places.

Supported access models:

1. **Named Cloudflare Tunnel and stable hostname — recommended for the Vercel dashboard.** Requires a Cloudflare-managed DNS zone, named tunnel credentials/token on the Pi, a persistent `cloudflared` service, and an HTTPS public hostname. Protect a shared/public route with Cloudflare Access; CORS alone is not protection.
2. **Private network or same-host reverse proxy — supported for self-hosted use.** Keep the API reachable only on a trusted network and configure the dashboard origin to that HTTPS route. The network path and certificate must remain stable.
3. **Quick Tunnel — temporary testing only.** Supported for development and validation builds. Production builds reject it.

## Dashboard API-origin configuration

The dashboard build reads these Vercel build-time environment variables:

| Variable | Requirement |
|---|---|
| `CRYPTOPULSE_RUNTIME_API_ORIGIN` | Required in Vercel builds. HTTPS origin only, with no path, query or fragment. Quick Tunnel hosts are permitted only outside production. |
| `CRYPTOPULSE_ENVIRONMENT` | Optional `development`, `validation`, or `production`. Defaults from `VERCEL_ENV`: `development` and `preview` map to development and validation, respectively; production maps to production. If a Vercel build has no recognized `VERCEL_ENV`, set this explicitly. A Vercel production build cannot be downgraded. |
| `CRYPTOPULSE_ACCESS_ENABLED` | Optional `true` or `false`, defaults to `false`. Must match `CLOUDFLARE_ACCESS_ENABLED` on the Pi. |
| `CRYPTOPULSE_ACCESS_AUDIENCE` | Required when dashboard Access is enabled; public Access audience value, not a secret. |

The root `npm run build` command generates the public static `js/runtime-api-config.js` from those values before project validation. `vercel.json` invokes that build command. Vercel builds fail when the API origin is missing or invalid. Production mode requires a stable HTTPS hostname and rejects Quick Tunnels, including if `CRYPTOPULSE_ENVIRONMENT` attempts to override a Vercel production build. Development and validation modes allow HTTPS Quick Tunnel origins. Vercel Preview builds default to validation mode; local builds default to development mode. Local development may also use `http://localhost:<port>`. Updating an environment value requires a new Vercel build/deployment; this phase does not trigger or claim a deployment.

The generated browser file contains only the API origin and Access settings. Never put database credentials, Cloudflare tunnel tokens, Access service tokens, signing keys or operator email allowlists in Vercel's public configuration or browser JavaScript. Keep the Cloudflare issuer, audience and operator allowlist configured in the Pi runtime environment as required by Phase 8.1.

## Deployment requirements and procedure

### Raspberry Pi and Cloudflare

1. Confirm the existing named tunnel with `cloudflared tunnel list` and `cloudflared tunnel info ai-crypto-pulse-bot`. Record the UUID and choose an operator-owned hostname such as `api.<your-domain>`; do not infer either value from the tunnel name.
2. In Cloudflare Zero Trust, configure a Public Hostname for that named tunnel and route it to `http://127.0.0.1:3002`. For a locally managed tunnel, copy [the example config](../deploy/cloudflared-config.example.yml), replace all placeholders, and validate it with `cloudflared tunnel ingress validate`.
3. Ensure the named tunnel credentials are held outside the repository with restrictive file permissions. Run `cloudflared` as a persistent systemd service enabled at boot; verify the service's configuration points to the named tunnel and the route above.
4. On the Pi, keep `API_HOST=127.0.0.1`, `API_PORT=3002`, and set `API_CORS_ORIGINS` to the exact dashboard origin, for example `https://ai-crypto-pulse-bot.vercel.app`. Configure Access issuer, audience and operator allowlist when Access is enabled.
5. From the Pi, confirm the local API responds before troubleshooting Cloudflare:

   ```sh
   curl --fail --show-error http://127.0.0.1:3002/api/v1/health/live
   ```

### Vercel dashboard

1. For Production, set `CRYPTOPULSE_RUNTIME_API_ORIGIN` to the permanent HTTPS hostname, for example `https://api.example.com`; leave `VERCEL_ENV=production` intact. For a development or validation deployment, the origin may be an HTTPS Quick Tunnel hostname.
2. If using Cloudflare Access, set `CRYPTOPULSE_ACCESS_ENABLED=true` and `CRYPTOPULSE_ACCESS_AUDIENCE` to the Access application's public audience. Keep these aligned with the Pi configuration. If Access is disabled, explicitly set `CRYPTOPULSE_ACCESS_ENABLED=false` and restrict the route to a trusted network; the public read-only API is otherwise anonymous.
3. Set the values for each Vercel environment that will serve the dashboard (Production and any intended Preview environments). Vercel Preview maps to validation mode automatically. For other build systems or when `VERCEL_ENV` is unavailable, set `CRYPTOPULSE_ENVIRONMENT=development`, `validation`, or `production` explicitly.
4. Run the Vercel build/deployment through the operator's normal process. No deployment was run as part of this phase.

## Verification procedure

Perform these checks after configuration and deployment; they are not represented as completed by local tests:

1. Confirm the Pi API is healthy at `http://127.0.0.1:3002/api/v1/health/live`.
2. Confirm `cloudflared` is active and enabled at boot. Restart the named tunnel service and verify it reconnects without changing the configured public hostname.
3. From an external network, request `https://api.<your-domain>/api/v1/health/live` and confirm `200`; verify that the hostname resolves to the named tunnel, not to a Quick Tunnel.
4. Request `/api/v1/markets` and `/api/v1/dashboard-data`. Confirm `200` and expected read-only data. With Access enabled, also verify an authorized browser request succeeds and unauthenticated/disallowed requests fail.
5. In the deployed dashboard browser, confirm requests use the configured API hostname, CORS permits the dashboard origin, and Dashboard, Analytics and Trade History render. In Production, confirm no request uses a `trycloudflare.com` hostname; such hostnames are expected only in development/validation deployments.
6. Restart the Pi and verify both `cryptopulse-runtime.service` and `cloudflared` start automatically, and the same HTTPS hostname remains usable.
7. Check the generated `js/runtime-api-config.js` in the Vercel build artifact: it must contain the selected origin and Access settings, and no credentials or temporary hostname.

## Validation results and limitations

- Repository audit confirmed one hardcoded Quick Tunnel origin in the browser config and no checked-in named-tunnel UUID, ingress route or stable API hostname.
- The new build-time configuration validates HTTPS origins, permits Quick Tunnel hosts only in development/validation, requires the API origin in Vercel builds, and validates Access configuration.

Local checks:

| Check | Result |
|---|---|
| Raspberry Pi package suite (`npm.cmd test` in `raspberry-pi/`) | Phase 8.7 baseline: 172 tests, 0 failures; not rerun for Phase 8.7.1, which changes only dashboard build configuration. |
| Repository suite (`npm.cmd test` at repository root) | Passed during Phase 8.7.1: 519 tests, 0 failures |
| Dashboard API-origin configuration tests | Passed during Phase 8.7.1: 7 tests, 0 failures |
| `node --check` for the config builder, its tests and runtime API configuration modules | Passed |
| Vercel Production build with stable origin | Passed |
| Production Quick Tunnel rejection | Passed; both Vercel production mode and explicit production mode reject it |
| Vercel Preview build with Quick Tunnel origin | Passed; generated config retains the validation origin |
| Local build with no deployment variables | Passed; the generated origin was restored to empty |
| `git diff --check` and whitespace checks for new files | Passed |

- The operator reports that the named tunnel is operational, but its DNS hostname, active ingress route, `cloudflared` service configuration and external availability were not independently verified.
- No live Pi configuration, Cloudflare account, DNS record, Vercel environment or deployment was changed from this worktree; only a local tunnel-config example was added. Production verification remains pending operator setup and smoke testing.
- The API remains read-only. No database, authentication design, runtime, dashboard layout or trading behavior was changed.

## Phase 8.7 assessment

The dashboard no longer ships with a hardcoded Quick Tunnel origin. Its API origin is deployment-configurable through Vercel build environment; development/validation builds can use Quick Tunnels, while production builds reject them. The permanent named-tunnel hostname and live end-to-end availability still require operator configuration and verification. Phase 9 has not started.

## Phase 8.7.1 — Development Quick Tunnel support

The build distinguishes Vercel's `VERCEL_ENV` values: `production` remains protected, `preview` is treated as validation, and local builds default to development. `CRYPTOPULSE_ENVIRONMENT` can explicitly select `development`, `validation`, or `production` when needed. A production Vercel build cannot be reclassified as development or validation. Quick Tunnel origins remain HTTPS-only, and are accepted only in the non-production modes.

Phase 8.7.1 checks: the dashboard build tests passed **7/7**, the repository suite passed **519/519**, syntax checks passed, and `git diff --check` passed. A Vercel Production build accepted a stable sample origin, rejected a Quick Tunnel origin, and a Vercel Preview build accepted one. No live Pi, Cloudflare or Vercel deployment checks were run.
