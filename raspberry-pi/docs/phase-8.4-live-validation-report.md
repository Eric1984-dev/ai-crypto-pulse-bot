# Phase 8.4 — Live Raspberry Pi Validation Report

## Scope and evidence

This report records operator-provided results from validation on the real Raspberry Pi. No deployment, database connection, API request, Cloudflare configuration change or dashboard browser session was performed from this worktree. The reported endpoint responses and production fixes are not independently verified here.

The work is documentation-only. It does not change runtime code, dashboard code, PostgreSQL schema, deployment settings or trading behavior. Phase 9 is not started.

## Deployment architecture

```text
Browser
  -> static dashboard on Vercel
  -> HTTPS, exact CORS origin configured
  -> Cloudflare Tunnel / Quick Tunnel
  -> Raspberry Pi API bound to 127.0.0.1
  -> read-only PostgreSQL queries
  -> ai_crypto_bot_store
```

The dashboard's `js/runtime-api-config.js` was configured with the validated Raspberry Pi API origin. The production URL is deployment-specific and is intentionally not copied into repository documentation. The Pi's `API_CORS_ORIGINS` was set to:

```text
https://ai-crypto-pulse-bot.vercel.app
```

The reported deployment used `CLOUDFLARE_ACCESS_ENABLED=false`. Its dashboard routes therefore provided anonymous, GET-only data access through the tunnel. This is not equivalent to Cloudflare Access authentication.

## Live validation reported

| Component or request | Operator-reported result |
|---|---|
| Raspberry Pi runtime | Operational |
| PostgreSQL | Operational |
| Scheduler | Operational |
| AI engine | Operational |
| Paper trading | Operational |
| Cloudflare Tunnel | Operational |
| Cloudflare Quick Tunnel | Operational |
| Dashboard migration | Operational |
| `GET /api/v1/health/live` | `200` |
| `GET /api/v1/markets` | `200` |
| `GET /api/v1/dashboard-data` | `200` |

These are live results communicated by the operator. They are distinct from the local test results recorded in the earlier Phase 8 reports.

## Issues discovered and resolutions

### 1. Dashboard PostgreSQL permissions

**Symptom:** `GET /api/v1/dashboard-data` returned `503 DASHBOARD_DATA_UNAVAILABLE`; Pi logs showed `POSTGRES_PERMISSION_DENIED` / SQLSTATE `42501`.

**Root cause reported from live validation:** `ai_crypto_bot_runtime_reader` lacked `SELECT` privileges on:

- `AI_Crypto_Bot_Profiles`
- `AI_Crypto_Bot_Portfolios`
- `AI_Crypto_Bot_Positions`
- `AI_Crypto_Bot_Trades`
- `AI_Crypto_Bot_Portfolio_Snapshots`
- `AI_Crypto_Bot_Emergency_State`

**Resolution reported:** Applied [phase-8.3-dashboard-permissions.sql](../migrations/phase-8.3-dashboard-permissions.sql). The endpoint subsequently returned `200`. The migration grants `SELECT` only; it does not provide table ownership or write privileges. See the [Phase 8.3 permission report](phase-8.3-dashboard-permission-validation.md).

### 2. Browser CORS

**Symptom:** Browser dashboard API calls were blocked by CORS.

**Root cause reported:** `API_CORS_ORIGINS` was missing.

**Resolution reported:** Configured the exact dashboard origin, `https://ai-crypto-pulse-bot.vercel.app`. CORS allows the browser origin but is not an authentication mechanism.

### 3. Dashboard API origin

**Symptom:** The frontend did not send requests to the Raspberry Pi runtime API.

**Root cause reported:** `js/runtime-api-config.js` had `apiOrigin: ""`.

**Resolution reported:** Set `apiOrigin` to the validated Raspberry Pi API endpoint. The actual endpoint URL is not repeated in this report.

### 4. Cloudflare Access startup requirement

**Symptom:** Mandatory Access configuration prevented a deployment that did not use Cloudflare Access.

**Resolution:** Phase 8.2 made Cloudflare Access optional. The validated deployment used `CLOUDFLARE_ACCESS_ENABLED=false`; runtime/API operation does not require Access issuer, audience or operator allowlist values in this mode.

## Runtime API and dashboard validation

The operator reports successful responses from the liveness, markets and dashboard data endpoints. The dashboard was reported operational after configuring its API origin and the Pi's CORS allowlist. The shared system portfolio and read-only API design remain unchanged; no dashboard write or trading endpoint was introduced by these fixes.

## Cloudflare validation

Cloudflare Tunnel and Quick Tunnel were reported operational as paths to the Pi API. Cloudflare Access itself was disabled for the validation. Consequently:

- The live results verify the deployment's anonymous read-only mode only.
- No production Cloudflare JWT, issuer/audience claim, operator allowlist or Access-denial path was tested.
- CORS does not protect the endpoint from non-browser clients or clients that can reach the tunnel.
- A Quick Tunnel should be treated as a validation path, not assumed to be a stable long-term production hostname.

## Lessons learned

- Validate effective PostgreSQL grants for every table read by the dashboard API, not only the tables used by market or health endpoints.
- A `42501` diagnostic can identify a permission failure without naming the denied relation; use database privilege inspection to find the full missing grant set.
- The browser API origin and server-side CORS allowlist are separate settings and both must match the deployment.
- Optional authentication means an Access-disabled tunnel remains anonymous. CORS is not a substitute for network controls or authentication.
- Distinguish operator-reported live evidence from local automated tests and checks.

## Production recommendations

1. Keep the Node API bound to `127.0.0.1`; do not expose PostgreSQL or the API port directly to the Internet.
2. Before shared/public exposure, enable Cloudflare Access or another appropriate access-control layer, configure issuer/audience/operator allowlist, and validate both allowed and denied requests on the deployed path.
3. Use a named Cloudflare Tunnel and a stable hostname for unattended production access; test restart/reconnect behavior and monitor tunnel health.
4. Keep `API_CORS_ORIGINS` limited to exact dashboard origins. Do not treat it as access control.
5. Retain the non-owner runtime reader and least-privilege grants. Recheck effective permissions after database role or schema changes.
6. Repeat the three endpoint checks and a browser dashboard check after deployment configuration changes. Do not infer the result from a healthy tunnel or a successful markets request alone.
7. Keep paper trading active and `ENABLE_LIVE_TRADING=false`; this phase validates read-only dashboard operation and does not authorize real trading.

## Limitations and Phase 8 status

- The results in this report come from the operator; no live host, database or browser was independently accessed from this worktree.
- The exact Raspberry Pi API URL is intentionally omitted.
- The deployed Cloudflare Access JWT path was not tested because Access was disabled.
- Quick Tunnel stability, recovery and availability over long periods were not measured.
- The Phase 8 read-only dashboard cutover and the three listed endpoints are reported operational. Phase 9 has not started and requires separate authorization.
