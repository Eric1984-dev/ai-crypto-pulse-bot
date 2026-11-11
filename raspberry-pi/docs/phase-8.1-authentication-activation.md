# Phase 8.1 — Authentication Activation

## Status

The API now selects `CloudflareAccessAuthenticationProvider` from the runtime's Cloudflare Access configuration. There is no disabled-authentication fallback in the API server. `npm start` and `npm run validate` fail with `CLOUDFLARE_ACCESS_REQUIRED` before opening database connections unless Cloudflare Access is enabled. The Pi's actual `.env`, Access application, allowlist, and authenticated live API response were not inspected or changed by this task; production activation still requires operator configuration and verification.

The API stays bound to loopback and exposes only read-only dashboard routes. This phase does not change profile ownership, create user accounts, add write endpoints, enable live trading, or proceed to Phase 9.

## Required environment variables

Configure these values in the Raspberry Pi's local `raspberry-pi/.env`; never commit that populated file:

| Variable | Requirement |
|---|---|
| `CLOUDFLARE_ACCESS_ENABLED` | Must be `true` for runtime startup and `npm run validate`. |
| `CLOUDFLARE_ACCESS_ISSUER` | Exact HTTPS Access team issuer, for example `https://<team-name>.cloudflareaccess.com` without a trailing path, query or fragment. |
| `CLOUDFLARE_ACCESS_AUDIENCE` | The Access application's public audience tag for the protected API hostname. |
| `ALLOWED_OPERATOR_EMAILS` | Comma-separated operator email addresses. At least one unique valid address is required; matching is case-insensitive. |
| `API_CORS_ORIGINS` | Exact HTTPS origin(s) of the static dashboard, comma-separated if needed. Wildcards and URL paths are rejected. |
| `API_HOST` | Keep `127.0.0.1`; the Node listener must not be exposed directly. |
| `API_PORT` | The configured local API port (default `3002`), matching the tunnel service target. |

`CLOUDFLARE_ACCESS_ISSUER`, `CLOUDFLARE_ACCESS_AUDIENCE`, and the email allowlist are also required in the dashboard deployment config as applicable; the frontend's `accessAudience` and `apiOrigin` are public routing values, not credentials. The frontend must never contain a database password, signing key, or service credential.

## Cloudflare Access setup

1. In Cloudflare Zero Trust, create a self-hosted Access application for the API hostname. Require an allow policy limited to the intended operator identities.
2. Record the app's audience tag and the exact team issuer. Use these same values for `CLOUDFLARE_ACCESS_AUDIENCE` and `CLOUDFLARE_ACCESS_ISSUER` on the Pi.
3. Configure the Cloudflare Tunnel hostname to forward to `http://127.0.0.1:3002`. Keep the Node API and PostgreSQL listeners private; do not create a public port-forward to the Pi.
4. Configure the Pi `.env` values above and set `CLOUDFLARE_ACCESS_ENABLED=true`. The runtime configuration validates the issuer format, audience, unique email allowlist and CORS origins.
5. Configure the dashboard's public `apiOrigin` to the HTTPS API hostname and `accessAudience` to the Access application audience. Keep this configuration separate from Pi-only settings.
6. Restart the runtime only after all values are correct. A missing/disabled Access configuration causes startup/preflight to fail closed rather than leaving protected routes serving an anonymous-only runtime.

Do not use the example placeholders as production values. The actual operator email list is an operator-owned configuration value and is intentionally not recorded in this report.

## JWT validation and authenticated context

For a protected API request:

1. Cloudflare Access authenticates the visitor and adds the `Cf-Access-Jwt-Assertion` header when forwarding to the API.
2. The provider rejects a missing, malformed, oversized or non-RS256 JWT.
3. It resolves the token's `kid` using `{issuer}/cdn-cgi/access/certs`. JWKS requests use HTTPS, disable caching at the fetch layer, reject redirects, time out after three seconds, cap the response at 64 KB and cache valid keys for one hour.
4. It verifies the signature and checks exact `iss`, configured `aud` (string or array), nonempty `sub`, allowlisted `email`, future `exp`, and optional `nbf`/`iat` with the configured 60-second clock skew.
5. A valid identity becomes `{principal:{subject,email,roles:["operator"]}}`. Middleware places that identity on the request context; protected read routes then require authentication. The shared system portfolio is not user-mapped.

Missing/invalid assertions return `401 UNAUTHENTICATED`. An unavailable or malformed Cloudflare signing-key set returns a safe `503` error. A valid operator receives the `operator` role; the separate `/api/v1/health/operational` endpoint still requires `admin` and is not part of dashboard access.

## Testing procedure

Run locally from the repository root:

```powershell
node --test raspberry-pi/tests/cloudflare-access-provider.test.mjs raspberry-pi/tests/runtime-config.test.mjs raspberry-pi/tests/health-api.test.mjs raspberry-pi/tests/runtime-bootstrap.test.mjs
Set-Location raspberry-pi
npm.cmd test
```

The tests cover valid and invalid signatures, issuer/audience/expiry checks, email allowlisting, identity extraction, JWKS failures, API provider activation, missing-provider rejection, startup/preflight refusal when Access is disabled, protected routes, CORS and runtime behavior. The full Pi package suite includes API, repository and auth tests.

For a controlled Pi smoke test after operator configuration:

1. Run `npm run validate`; it must report valid contracts with Access enabled. It exits without starting the scheduler.
2. Restart `cryptopulse-runtime.service` only under the operator's deployment procedure and confirm it is active.
3. From an allowed Access session, request `GET https://<api-host>/api/v1/markets` and confirm `200` with the `{data:{count,items}}` envelope.
4. From the same Pi loopback listener without an Access assertion, request `GET http://127.0.0.1:3002/api/v1/markets` and confirm `401 UNAUTHENTICATED`. The public hostname should present Cloudflare's Access challenge to an unauthenticated browser.
5. Confirm an unlisted email is denied by the Cloudflare policy and by the server-side allowlist. Do not log, paste or commit JWTs or cookies.

No live Pi restart or authenticated production request was performed as part of this coding task.

## Validation results

- Cloudflare authentication, runtime configuration, health/API and bootstrap tests: 28 passed.
- Raspberry Pi full package suite (`npm.cmd test`): 165 passed, 0 failed.
- JavaScript syntax validation (`node --check` across `src/` and `tests/`): passed.
- `git diff --check`: passed.
- Live Pi/Cloudflare smoke test: not run; requires operator-controlled environment values and deployment.

## Remaining activation gate

The software no longer silently falls back to `DisabledAuthenticationProvider`; however, this work cannot supply the actual operator email allowlist or update the Pi's private `.env`. Until the Pi is configured and a live authenticated `200` request is verified, production authentication activation remains unconfirmed. Stop here; do not begin Phase 9.
