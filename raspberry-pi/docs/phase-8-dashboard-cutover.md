# Phase 8 — Dashboard Migration and Cutover

> Authentication note: this Phase 8 report records the original anonymous/optional-Cloudflare read-only deployment. Migration Phase 9 supersedes that access model with a required single-admin Pi session and same-origin Vercel proxy; see [Phase 9 dashboard authentication](phase-9-dashboard-authentication.md).

## Status and scope

The existing Vercel dashboard reads the shared system portfolio from the Raspberry Pi runtime API. The operator reports that the live Pi runtime, PostgreSQL, scheduler, AI, paper trading, Cloudflare Tunnel and Quick Tunnel are operational, the dashboard migration is active, and all three required API endpoints return `200`. The API remains loopback-bound and exposes GET-only dashboard data routes.

The live results in this report are operator-provided evidence, not checks run from this worktree. Existing layouts and charts are preserved; this phase does not add dashboard write actions, alter the PostgreSQL schema, or enable live trading. See the [Phase 8.4 live validation report](phase-8.4-live-validation-report.md) for the deployment findings and limitations.

## Architecture

```text
Browser
  -> existing static dashboard on Vercel
  -> HTTPS or a trusted local route, credentialed read-only fetches
  -> optional Cloudflare Access protection
  -> configured tunnel or same-host reverse proxy
  -> Raspberry Pi API on 127.0.0.1:3002
  -> parameterized, read-only PostgreSQL repository queries
  -> existing ai_crypto_bot_store database
```

The browser has no database connection or credential. Cloudflare Access is optional. When enabled, it injects `Cf-Access-Jwt-Assertion`; the Pi verifies the RS256 signature against Cloudflare's JWKS and validates issuer, audience, expiry and the configured operator email allowlist. When disabled, the Pi serves anonymous access to the GET-only dashboard data routes; the operational health route remains admin-only. The dashboard shares the standalone system portfolio; it does not map users to Supabase profiles or depend on `auth.users`.

The operator reports configuring the dashboard API origin and setting `API_CORS_ORIGINS=https://ai-crypto-pulse-bot.vercel.app`. The reported live deployment used `CLOUDFLARE_ACCESS_ENABLED=false`; the API therefore allowed anonymous access to its read-only dashboard routes. Phase 8.7 replaces a manually embedded API origin with Vercel build-time configuration and documents a stable hostname on the existing named tunnel. The stable hostname and route still require live operator verification. Cloudflare Access remains optional. To enable it, configure the dashboard's Access build variables and the Pi issuer, audience and operator allowlist. The API remains loopback-only behind the tunnel. Do not expose PostgreSQL or an unauthenticated API to an untrusted network. See the [Phase 8.1/8.2 authentication configuration](phase-8.1-authentication-activation.md) and [Phase 8.7 permanent connectivity report](phase-8.7-permanent-connectivity.md).

## Dashboard dependency audit and migration mapping

The dashboard's browser scripts no longer create Supabase clients, issue Supabase REST/RPC queries, call Supabase Functions, or subscribe to Supabase Realtime. Dashboard reads use the configured Raspberry Pi API origin. The legacy `js/realtime.js` filename remains as an aligned polling helper; it does not create channels or subscriptions. The existing Supabase schema and unrelated Vercel functions were not deleted or migrated by this cutover.

| Existing dashboard dependency | Raspberry Pi replacement |
|---|---|
| Supabase Auth login/session and user/profile mapping | Optional Cloudflare Access login redirect, JWT validation and server-side operator email allowlist |
| Portfolio, balance, P&L, position, trade and snapshot table queries | `GET /api/v1/dashboard-data` |
| Trade history queries and filters | `GET /api/v1/dashboard-data?view=trade-history` |
| Latest AI decisions and reasoning | Default `dashboard-data` response; detailed paginated records through `view=ai-history` |
| AI decision/confidence/action distributions | `GET /api/v1/dashboard-data?view=analytics` |
| Strategy recommendations | `GET /api/v1/dashboard-data?view=recommendations` |
| CSV exports and export counts | `GET /api/v1/dashboard-data?view=export-count` and `view=export` |
| Watched markets and scanner summaries | `GET /api/v1/markets`, `GET /api/v1/market-summary`, and `GET /api/v1/market` |
| Agent status and Agent Brain portfolio context | `GET /api/v1/agent-status` and default `dashboard-data` |
| Supabase Realtime updates | Browser-side aligned polling of the Pi API; no Realtime subscription |
| Archive/host status cards | `GET /api/v1/monitoring` |

`admin.html` no longer presents execution controls and redirects to the dashboard. The cutover does not add a portfolio mutation, paper-trade execution, strategy write, market write, or exchange order API. Existing UI sections remain in place; the Pi API supplies current source data and does not implement new agent logic.

## API contracts

All data endpoints below are `GET`. When Cloudflare Access is enabled, they require a valid Access JWT; when disabled, they allow anonymous read-only access. Responses use a `{ "data": ... }` envelope except CSV downloads. Query parameters are strict; unknown or duplicate parameters are rejected. API failures use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Common statuses are `400` invalid query, `401` missing/invalid authentication when Access is enabled, `403` disallowed origin, `404` untracked market, and `503` unavailable database/runtime data. Responses set `Cache-Control: no-store`.

| Endpoint | Request | Response and bounds |
|---|---|---|
| `GET /api/v1/health/live` | No query parameters; unauthenticated liveness check | `{data:{status:"live"}}`; no database assertion |
| `GET /api/v1/health/ready` | No query parameters; unauthenticated readiness check | `{data:{status:"ready"}}` or `503`; no database details |
| `GET /api/v1/health/operational` | No query parameters; requires an `admin` role | Bounded runtime, resource and failure counters; not used by the dashboard operator client |
| `GET /api/v1/markets` | No query parameters | `{data:{count,items:[{id,symbol,enabled,priority}]}}`; only enabled watched markets |
| `GET /api/v1/market` | Required `symbol` (uppercase alphanumeric followed by `-EUR`); optional `interval` (`1m`,`5m`,`15m`,`1h`,`4h`,`1d`, default `1m`), `limit` (default `200`, range `1..500`) | `{data:{symbol,interval,marketData,candles,refreshStatus:"read-only"}}`; disabled/untracked symbols return `404` |
| `GET /api/v1/dashboard-data` | No query parameters | Portfolio metrics, open positions, open-position AI status, recent trades, snapshots, emergency state, watched markets, latest decisions and market data. Lists are bounded; recent decisions are limited to five. |
| `GET /api/v1/dashboard-data?view=trade-history` | Optional `page` (default `1`), `side` (`all`,`BUY`,`SELL`), `period` (`all`,`24h`,`7d`,`30d`), `search` (up to 80 chars), and `sort` (newest/oldest/market/action/price/quantity/fees/P&L variants) | `{data:{page,pageSize,totalCount,totalPages,items,stats}}`; page size is fixed at 25 in the endpoint. |
| `GET /api/v1/dashboard-data?view=ai-history` | Optional `page` (default `1`, max `1,000,000`) and `pageSize` (default `25`, max `100`) | `{data:{page,pageSize,totalCount,totalPages,items}}`; each item includes decision, confidence, reasoning, indicators, strategy snapshot and timestamp. |
| `GET /api/v1/dashboard-data?view=analytics` | `period` in `30d`,`90d`,`365d` (default `30d`) | Computed trade/AI/portfolio performance, confidence/action/strategy distributions, data-quality diagnostics and analytics export counts. Analytics queries are capped at 10,000 rows per source. |
| `GET /api/v1/dashboard-data?view=recommendations` | `period` in `30d`,`90d`,`365d` (default `30d`) | On-demand recommendations generated from current analytics; not persisted and no recommendation-history table is introduced. |
| `GET /api/v1/dashboard-data?view=export-count` | Required `type`; optional `period`. Types: `trades`, `portfolio`, `decisions`, `positions`, `analytics-summary`, `trade-analytics`, `portfolio-analytics`, `ai-analytics`, `recommendations`, `recommendation-history`. Ordinary periods: `24h`,`7d`,`30d`,`all`; analytics periods: `30d`,`90d`,`365d`. | `{data:{exportType,period,recordCount}}`; default period is `all` or `30d` for analytics exports. |
| `GET /api/v1/dashboard-data?view=export` | Same type and period contract as `export-count` | UTF-8 CSV streamed with `X-Export-Record-Count`; downloads are capped at 10,000 rows. |
| `GET /api/v1/agent-status` | No query parameters | `{data:{status}}`; status is one of `ACTIVE`,`ANALYZING`,`IDLE`,`STOPPED`,`ERROR`, or `null` for missing/unknown status. |
| `GET /api/v1/market-summary` | No query parameters | `{data:{scanner}}`; scanner summary computed from enabled markets, stored market snapshots, recent candles and AI decisions. It does not refresh market data or trade. |
| `GET /api/v1/monitoring` | No query parameters | Runtime/scheduler state and last-cycle stage outcomes, process uptime and Node memory, CPU/load, host memory, temperature, disk, database size and estimated candle/decision/trade/position row counts. |

`/api/v1/monitoring` exposes counts from PostgreSQL statistics; they are estimates, not exact counts. Temperature may be `null` where the Linux thermal sysfs file is absent. CPU usage may be `null` until a prior sample exists. The read-only endpoint does not expose credentials or unrestricted database queries.

## Dashboard and Agent Brain integration

Existing pages use the `CryptoPulseRuntimeApi` URL helper and credentialed `GET` requests. Dashboard portfolio metrics, risk/emergency context, open-position AI summaries, latest decisions, tracked markets and chart history are returned by `dashboard-data`; market-scanner views use `market-summary`; Agent Status uses the existing status route. The polling helper refreshes dashboard data and status without a Supabase channel. Analytics and recommendations remain deterministic calculations over the system portfolio's stored trades, positions, decisions and snapshots.

Monitoring includes the runtime's current scheduler state and last-cycle ingestion, AI-analysis and paper-trading outcomes, plus process/host/database metrics. It does not invent an independent success state when metrics are unavailable; API dependency errors fail the request with a safe error envelope.

## Read-only and Cloudflare safeguards

- The API process remains bound to `127.0.0.1`; use a same-host reverse proxy or tunnel to reach it.
- Configure exact HTTPS dashboard origins in `API_CORS_ORIGINS`; wildcard credentialed CORS is rejected.
- Cloudflare Access is recommended for shared or public network exposure. When enabled, the backend verifies JWT signature, issuer, audience, timestamps and an operator email allowlist.
- When Access is disabled, any client that can reach the API can read dashboard data. Network isolation or another trusted access boundary is required; CORS is not authentication.
- Dashboard browser requests use `credentials: "include"` so Access cookies are sent to the API origin.
- All data routes are GET-only and repository access uses parameterized read-only queries. No direct database access is present in frontend code.
- The runtime does not add a browser-facing API route for trading, portfolio updates, configuration changes or exchange execution.
- No Vercel `/api` function was added; the existing 12-function Hobby limit is checked by the repository build validator.
- Existing live-trading safeguards remain unchanged; `ENABLE_LIVE_TRADING=false` is required by runtime startup.

## Limitations and risks

- Live Pi, Cloudflare Tunnel/Quick Tunnel, endpoint and dashboard results are operator-reported; they were not independently queried from this worktree. The deployment-specific API origin is intentionally not copied into this repository.
- Cloudflare Access was disabled during the reported live validation. The Access JWT path and protected production requests were not validated on the deployed Pi.
- With Access disabled, any client able to reach the tunnel can read the dashboard data. CORS restricts cooperating browsers but is not an authentication or network access control.
- Quick Tunnel availability and hostname stability are not production guarantees. Use the Phase 8.7 named-tunnel procedure; the stable hostname and route have not been independently live-validated from this worktree.
- Shared system-portfolio access is intentionally not per-user isolated. Every operator allowlisted in the API environment sees the same read-only portfolio.
- Dashboard reads depend on the Pi, its PostgreSQL connection and Cloudflare Tunnel availability. There is no Supabase fallback, offline cache or frontend same-origin fallback.
- PostgreSQL table counts are estimates, CPU is sampled, and temperature support is host-dependent.
- Analytics/history/export limits deliberately cap response work. AI history supports paginated read access; it does not persist separate analytics or recommendation history.
- Legacy Supabase schema and serverless code remain in the repository for existing non-dashboard workflows. This cutover removes dashboard runtime calls; it does not delete or migrate those services.
- Automated tests and static checks do not prove production authorization, tunnel routing, browser cookie behavior, deployment configuration or runtime performance under real data volume.

## Validation results

### Operator-reported live Raspberry Pi validation

- Runtime, PostgreSQL, scheduler, AI, paper trading, Cloudflare Tunnel and Quick Tunnel: operational.
- Dashboard migration: operational.
- `GET /api/v1/health/live`: `200`.
- `GET /api/v1/markets`: `200`.
- `GET /api/v1/dashboard-data`: `200`.
- Dashboard API CORS origin and frontend API origin were configured as described in the [Phase 8.4 report](phase-8.4-live-validation-report.md).
- Access mode: `CLOUDFLARE_ACCESS_ENABLED=false`; live JWT authentication was not exercised.

The results above were supplied by the operator. They are distinct from the original local automated results below; no deployment or live request was executed from this worktree. The following counts are historical results from the initial Phase 8 implementation, not test runs for this documentation-only Phase 8.4 update.

- Raspberry Pi package tests: `npm.cmd test` passed, 161 tests.
- Runtime API tests: included in the Pi package suite; export, monitoring, pagination, authentication, validation and read-only route tests passed.
- Dashboard integration tests: targeted dashboard/realtime/project-setup/database-migration run passed, 86 tests.
- Repository tests: `npm.cmd test` passed, 497 tests.
- Repository build and database/static validation: `npm.cmd run build` passed; 18 prefixed tables, RLS coverage, seed consistency and the existing Vercel function limit were validated.
- JavaScript syntax validation: `node --check` passed for 167 `.js` and `.mjs` files.
- `git diff --check`: passed.

## Phase 8 assessment

The operator reports that the dashboard-to-Pi read-only cutover and required endpoints are operational on the live Raspberry Pi. This validates the current anonymous read-only mode, not the optional Cloudflare Access JWT flow. Keep the route private/trusted while Access is disabled; use a stable named tunnel and validate Access separately before shared or public exposure. Phase 9 is not part of this work and has not been started.
