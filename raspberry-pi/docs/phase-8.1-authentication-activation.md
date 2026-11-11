# Phase 8.1 — Authentication Activation

## Status

Phase 8.1 added Cloudflare Access JWT validation. Phase 8.2 supersedes its mandatory-authentication startup gate: Cloudflare Access is optional and disabled by default. With `CLOUDFLARE_ACCESS_ENABLED=false`, the runtime starts and validates without Access credentials and exposes anonymous, GET-only dashboard data routes. With it enabled, requests must pass Cloudflare JWT validation and the server-side operator email allowlist.

The API stays bound to loopback and exposes only read-only dashboard routes. `/api/v1/health/operational` remains admin-only in either mode. This phase does not change profile ownership, create user accounts, add write endpoints, enable live trading, or proceed to Phase 9.

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

Set the dashboard's `apiOrigin` for its deployment. For Access deployments, also set `accessEnabled: true` and `accessAudience` in `js/runtime-api-config.js`; for private/local deployments, leave `accessEnabled: false`. Those are public routing values, not credentials. The frontend must never contain a database password, signing key, or service credential.

## Cloudflare Access setup

1. In Cloudflare Zero Trust, create a self-hosted Access application for the API hostname. Require an allow policy limited to the intended operator identities.
2. Record the app's audience tag and the exact team issuer. Use these same values for `CLOUDFLARE_ACCESS_AUDIENCE` and `CLOUDFLARE_ACCESS_ISSUER` on the Pi.
3. Configure the Cloudflare Tunnel hostname to forward to `http://127.0.0.1:3002`. Keep the Node API and PostgreSQL listeners private; do not create a public port-forward to the Pi.
4. Configure the Pi `.env` values above and set `CLOUDFLARE_ACCESS_ENABLED=true`. The runtime configuration validates the issuer format, audience and unique email allowlist.
5. Configure the dashboard's public `apiOrigin` to the HTTPS API hostname, `accessEnabled: true`, and `accessAudience` to the Access application audience. Keep this configuration separate from Pi-only settings.
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

No live Pi restart or authenticated production request was performed as part of this coding task.

## Validation results

- Phase 8.1 Cloudflare authentication, runtime configuration, health/API and bootstrap baseline: 28 passed.
- Phase 8.2 focused Raspberry Pi authentication/API/runtime tests: 43 passed.
- Dashboard browser authentication tests: 8 passed.
- Raspberry Pi full package suite (`npm.cmd test`): 168 passed, 0 failed.
- Repository full suite (`npm.cmd test`): 507 passed, 0 failed.
- JavaScript syntax validation across API, library, scripts, tests and Pi source/test files: passed.
- `npm.cmd run build`: passed; static project and database migration validation succeeded.
- `git diff --check`: passed.
- Live Pi/Cloudflare smoke test: not run; requires operator-controlled environment values and deployment.

## Remaining activation gate

Cloudflare Access remains available and is recommended for shared/public API exposure, but production settings are deployment-owned and are not hardcoded here. This work does not inspect or change the Pi's private `.env` and does not verify a live deployment. When Access is disabled, keep the read-only API on a private/trusted route. Stop here; do not begin Phase 9.
