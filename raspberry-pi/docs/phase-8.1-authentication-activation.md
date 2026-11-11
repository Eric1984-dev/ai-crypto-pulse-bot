# Phase 8.1 — Authentication Activation

## Status

Phase 8.1 added Cloudflare Access JWT validation. Phase 8.2 supersedes its mandatory-authentication startup gate: Cloudflare Access is optional and disabled by default. With `CLOUDFLARE_ACCESS_ENABLED=false`, the runtime starts and validates without Access credentials and exposes anonymous, GET-only dashboard data routes. With it enabled, requests must pass Cloudflare JWT validation and the server-side operator email allowlist.

The operator reports that the live Phase 8.4 deployment uses `CLOUDFLARE_ACCESS_ENABLED=false`; Cloudflare Tunnel and Quick Tunnel are operational and the dashboard API endpoints return `200`. Thus the deployed dashboard path is currently anonymous and read-only, not protected by a live-validated Access JWT flow. The API stays bound to loopback and exposes only read-only dashboard routes. `/api/v1/health/operational` remains admin-only in either mode. This phase does not change profile ownership, create user accounts, add write endpoints, enable live trading, or proceed to Phase 9.

See the [Phase 8.4 live validation report](phase-8.4-live-validation-report.md) for the reported endpoint results, CORS/API-origin fixes and remaining Access limitations.

## Required environment variables

Configure these values in the Raspberry Pi's local `raspberry-pi/.env`; never commit that populated file:

| Variable | Requirement |
|---|---|
| `CLOUDFLARE_ACCESS_ENABLED` | Optional; defaults to `false`. Set `true` to require Cloudflare Access for dashboard data routes. |
| `CLOUDFLARE_ACCESS_ISSUER` | Required only when Access is enabled. Exact HTTPS Access team issuer, without a trailing path, query or fragment. |
| `CLOUDFLARE_ACCESS_AUDIENCE` | Required only when Access is enabled. The Access application's public audience tag for the protected API hostname. |
| `ALLOWED_OPERATOR_EMAILS` | Required only when Access is enabled. Comma-separated operator email addresses; at least one unique valid address is required. Matching is case-insensitive. |
| `API_CORS_ORIGINS` | Exact browser origin(s), comma-separated if needed. Wildcards and URL paths are rejected. This is not authentication. |
| `API_HOST` | Keep `127.0.0.1`; the Node listener must not be exposed directly. |
| `API_PORT` | The configured local API port (default `3002`), matching the tunnel service target. |

Set the dashboard's API origin with the Vercel build-time variable `CRYPTOPULSE_RUNTIME_API_ORIGIN`; do not commit a deployment hostname in frontend source. The Vercel build generates the static `js/runtime-api-config.js`. In the operator-reported live setup, `API_CORS_ORIGINS` was `https://ai-crypto-pulse-bot.vercel.app`; the new permanent hostname must be set as the API origin and independently validated before production use. For Access deployments, set `CRYPTOPULSE_ACCESS_ENABLED=true` and `CRYPTOPULSE_ACCESS_AUDIENCE` in the same Vercel environment, and configure the corresponding issuer, audience and operator allowlist in the Pi `.env`. For private/local deployments, leave `CRYPTOPULSE_ACCESS_ENABLED=false`. These frontend values are public routing/configuration values, not credentials. The frontend must never contain a database password, signing key, or service credential. See the [Phase 8.7 permanent connectivity procedure](phase-8.7-permanent-connectivity.md).

## Cloudflare Access setup

1. In Cloudflare Zero Trust, create a self-hosted Access application for the API hostname. Require an allow policy limited to the intended operator identities.
2. Record the app's audience tag and the exact team issuer. Use these same values for `CLOUDFLARE_ACCESS_AUDIENCE` and `CLOUDFLARE_ACCESS_ISSUER` on the Pi.
3. Configure the Cloudflare Tunnel hostname to forward to `http://127.0.0.1:3002`. Keep the Node API and PostgreSQL listeners private; do not create a public port-forward to the Pi.
4. Configure the Pi `.env` values above and set `CLOUDFLARE_ACCESS_ENABLED=true`. The runtime configuration validates the issuer format, audience and unique email allowlist.
5. In Vercel, set `CRYPTOPULSE_RUNTIME_API_ORIGIN` to the HTTPS API hostname, `CRYPTOPULSE_ACCESS_ENABLED=true`, and `CRYPTOPULSE_ACCESS_AUDIENCE` to the Access application audience. Keep the Pi-only issuer, audience and email allowlist in the Pi `.env`.
6. Restart the runtime only after all values are correct. If Access is disabled, runtime startup and validation are still supported; the read-only dashboard data routes then permit anonymous access.

Do not use example placeholders as production values. The operator email list is an operator-owned configuration value and is intentionally not recorded in this report. If Access is disabled, use only a private/trusted route: CORS does not protect the data from other clients that can reach the API.

## JWT validation and authenticated context

For a protected API request when Access is enabled:

1. Cloudflare Access authenticates the visitor and adds the `Cf-Access-Jwt-Assertion` header when forwarding to the API.
2. The provider rejects a missing, malformed, oversized or non-RS256 JWT.
3. It resolves the token's `kid` using `{issuer}/cdn-cgi/access/certs`. JWKS requests use HTTPS, disable caching at the fetch layer, reject redirects, time out after three seconds, cap the response at 64 KB and cache valid keys for one hour.
4. It verifies the signature and checks exact `iss`, configured `aud` (string or array), nonempty `sub`, allowlisted `email`, future `exp`, and optional `nbf`/`iat` with the configured 60-second clock skew.
5. A valid identity becomes `{principal:{subject,email,roles:["operator"]}}`. Middleware places that identity on the request context; protected read routes then require authentication. The shared system portfolio is not user-mapped.

With Access enabled, missing/invalid assertions return `401 UNAUTHENTICATED`; unavailable or malformed signing keys return a safe `503`. A valid operator receives the `operator` role; `/api/v1/health/operational` still requires `admin`. With Access disabled, anonymous access is allowed only by the read-only dashboard data routes; the operational health route returns `401 UNAUTHENTICATED`.

## Testing procedure

Run locally from the repository root:

```powershell
node --test raspberry-pi/tests/cloudflare-access-provider.test.mjs raspberry-pi/tests/runtime-config.test.mjs raspberry-pi/tests/health-api.test.mjs raspberry-pi/tests/runtime-bootstrap.test.mjs
Set-Location raspberry-pi
npm.cmd test
```

The tests cover valid and invalid signatures, issuer/audience/expiry checks, email allowlisting, identity extraction, JWKS failures, API provider activation, protected routes, both runtime modes, anonymous read-only access, admin-only health, CORS and runtime behavior. The full Pi package suite includes API, repository and auth tests.

For a controlled Pi smoke test after operator configuration:

1. With Access disabled, run `npm run validate` and confirm contract validation succeeds without issuer, audience or allowlist values.
2. Restart `cryptopulse-runtime.service` only under the operator's deployment procedure and confirm it is active.
3. From an authorized private/local route, request `GET http://127.0.0.1:3002/api/v1/markets` without an Access assertion and confirm `200`; confirm the operational health route remains `401`.
4. For an Access-enabled deployment, configure issuer, audience, allowlist and frontend settings, then confirm an allowed browser request returns `200`, while a request without a valid assertion returns `401`.
5. Confirm an unlisted email is denied by Cloudflare policy and the server-side allowlist. Do not log, paste or commit JWTs or cookies.

The Phase 8.1/8.2 implementation did not perform a live Pi restart or authenticated production request. The operator later reports live API and dashboard validation with Access disabled; this verifies anonymous read-only operation only and does not verify Access JWT enforcement on the deployed Pi.

## Validation results

- Phase 8.1 Cloudflare authentication, runtime configuration, health/API and bootstrap baseline: 28 passed.
- Phase 8.2 focused Raspberry Pi authentication/API/runtime tests: 43 passed.
- Dashboard browser authentication tests: 8 passed.
- Raspberry Pi full package suite (`npm.cmd test`): 168 passed, 0 failed.
- Repository full suite (`npm.cmd test`): 507 passed, 0 failed.
- JavaScript syntax validation across API, library, scripts, tests and Pi source/test files: passed.
- `npm.cmd run build`: passed; static project and database migration validation succeeded.
- `git diff --check`: passed.
- Phase 8.4 live Pi smoke test (operator-reported): runtime dependencies and Cloudflare Tunnel/Quick Tunnel operational; `/api/v1/health/live`, `/api/v1/markets` and `/api/v1/dashboard-data` returned `200` with Access disabled.
- Live Cloudflare Access JWT test: not performed; Access was disabled in the reported deployment.

## Live deployment status and remaining Access limitation

Cloudflare Access remains available and is recommended for shared/public API exposure, but production settings are deployment-owned and are not hardcoded here. The reported live deployment has Access disabled. When Access is disabled, keep the read-only API on a private/trusted route: CORS does not prevent non-browser clients or other clients that can reach the tunnel from reading dashboard data. The live validation did not inspect or change the Pi's private `.env`, nor did it test an authenticated Access request. Stop here; do not begin Phase 9.
