# Phase 9.1 — Authentication Route Activation Validation

## Status

The authentication routes are present and registered by the Raspberry Pi runtime startup path in the current source. A runtime-bootstrap regression test verifies that `GET /api/v1/auth/session` reaches the handler and returns `401 UNAUTHENTICATED` without a session, rather than `404`; the same integration test verifies that `POST /api/v1/auth/login` succeeds with test credentials.

The operator reports that both endpoints return `404` on the live Raspberry Pi. That live failure is not verified from this worktree, and no Raspberry Pi deployment or restart was performed. Phase 9's deployment report explicitly records that the Pi `.env` was not inspected or modified and the runtime service was not restarted. The Vercel Production deployment of `ee0e1dc` deploys the dashboard-side functions; it does not install or restart the separate Pi Node.js service. The evidence therefore indicates a deployment/version mismatch on the Pi, not a missing route in the current source.

Phase 9.1 is not production-complete until the Pi runtime is updated and the live endpoints are verified.

## Route activation trace

| Layer | Source behavior |
|---|---|
| Startup entrypoint | `src/index.mjs` reads the runtime configuration and calls `startRuntime`. |
| Authentication configuration | `src/config/runtime-config.mjs` requires `DASHBOARD_USERNAME` and a valid `DASHBOARD_PASSWORD_HASH`, then exposes them as `config.api.dashboardAuth`. Missing or malformed values prevent the new runtime process from starting. |
| Runtime bootstrap | `src/runtime/bootstrap.mjs` creates the session store from `config.api.sessionTtlMs` and `config.api.sessionMax`, then passes both `sessionStore` and `config.api.dashboardAuth` to `createApiServer`. |
| Router registration | `src/api/server.mjs` requires both authentication dependencies when either is supplied, then calls `registerAuthRoutes` before registering the dashboard data routes. |
| Route handlers | `src/api/auth-routes.mjs` registers `POST /api/v1/auth/login`, `GET /api/v1/auth/session`, and `DELETE /api/v1/auth/session`. |
| HTTP dispatch | `routerMiddleware` resolves the method and path; authentication and CSRF middleware then apply the route's session and origin rules. The session endpoint correctly returns `401` without a cookie; a missing router entry would return `404`. |

No separate API-version router, feature flag, or conditional authentication disablement excludes these routes from the `startRuntime` startup path. The registration condition in `createApiServer` is satisfied by the arguments passed from `startRuntime`.

## Root cause

The Phase 9 source and the Pi runtime are separate deployment targets. A successful Vercel deployment of `ee0e1dc` does not update the systemd-managed Raspberry Pi process. The Phase 9 report states the Pi package was not installed and `cryptopulse-runtime.service` was not restarted. An older process can continue serving the pre-Phase 9 route table and return `404` for both authentication endpoints.

The current worktree cannot independently identify the live process's checkout, systemd `WorkingDirectory`, or tunnel upstream. If the Pi operator confirms that the updated process is already running, verify those three values and compare the Pi checkout with `main` before changing application routing. The implementation path itself is coherent from `src/index.mjs` through router registration.

## Fix applied

- Added a runtime-bootstrap integration assertion for unauthenticated `GET /api/v1/auth/session`, requiring `401 UNAUTHENTICATED`. Existing bootstrap coverage already asserts a successful `POST /api/v1/auth/login`; the focused authentication-route suite also covers login, session refresh, and logout.
- Documented that the live fix is to deploy the current `raspberry-pi/` package to the Pi, ensure its required local authentication settings are valid, and restart `cryptopulse-runtime.service`. No source-route change is warranted by the current evidence.
- No production Pi configuration, service, tunnel, or credentials were accessed or changed.

## Pi activation and verification procedure

Run these steps on the Raspberry Pi using the operator's normal deployment procedure:

1. Confirm the runtime checkout is on the intended `main` commit containing the Phase 9 authentication source.
2. Confirm the systemd service's `WorkingDirectory` points to that checkout's `raspberry-pi/` directory and the tunnel forwards to the same API listener.
3. Configure `DASHBOARD_USERNAME` and a valid bcrypt `DASHBOARD_PASSWORD_HASH` in the Pi-local `.env`; keep the password and hash out of source control, logs, command arguments, and Vercel variables. Keep `API_HOST=127.0.0.1` and `ENABLE_LIVE_TRADING=false`.
4. Install the package dependencies according to the Pi deployment procedure and restart `cryptopulse-runtime.service`. Runtime configuration fails closed if the authentication settings are absent or malformed.
5. Confirm the service is active and inspect its startup journal for successful `runtime_started`, not `runtime_startup_failed`.
6. Request `GET /api/v1/auth/session` without a cookie. Expected: `401 UNAUTHENTICATED`, not `404`.
7. Open the production dashboard login page. Confirm incorrect credentials are rejected and valid credentials create a secure session; then verify refresh, authenticated dashboard reads, and logout.

Do not expose the API listener directly to the network. The runtime must remain loopback-bound behind the configured tunnel.

## Validation results

| Check | Result |
|---|---|
| Route registration and middleware trace | Confirmed in current source |
| Runtime-bootstrap activation regression | Passed: session without a cookie returned `401 UNAUTHENTICATED`; login returned `200` |
| Authentication, bootstrap, and repository-focused tests | Passed: 35 tests |
| Raspberry Pi package tests (`npm test --prefix raspberry-pi`) | Passed: 178 tests |
| Repository tests (`npm test`) | Passed: 531 tests |
| Syntax validation | Passed: 87 Raspberry Pi source and test modules |
| `git diff --check` | Passed |
| Live Pi endpoint and dashboard login | Not run; requires operator-controlled Pi deployment and restart |

## Remaining limitation

The reported live endpoints remain unverified after the fix because no Pi shell or deployment was available in this task. Do not mark dashboard login operational or Phase 9.1 complete until the Pi package is activated and the live endpoint and browser login checks pass.
