# Phase 9 — Simple Dashboard Authentication

## Status

The single-admin authentication implementation and local validation are complete. The Vercel Production deployment for commit `ee0e1dc` succeeded, `/login` returned `200`, and an unauthenticated `/dashboard` request redirected to login. Production login is not yet validated: the Raspberry Pi must first be configured with the dashboard username and bcrypt hash, then restarted.

## Architecture

```text
Browser
  -> Vercel protected-page / auth-session / dashboard-data functions
  -> same-origin HttpOnly session cookie
  -> existing Vercel-to-Pi HTTPS tunnel
  -> Raspberry Pi session authentication and CSRF validation
  -> read-only dashboard API and PostgreSQL repositories
```

The browser never receives the Pi session token, password hash, or database credentials. Vercel forwards only the `__Host-cp_session` cookie to the Pi. The existing `api/auth-session.mjs`, `api/protected-page.mjs`, and `api/dashboard-data.mjs` functions are reused; the repository still contains exactly 12 Vercel API function files, within the Hobby limit. No file was added under root `api/`.

Dashboard HTML routes are sent through the existing protected-page function, which verifies the session with the Pi before returning a page. Dashboard data calls use the existing dashboard-data function as a same-origin proxy to validated `/api/v1/` paths. Login/session calls use the existing auth-session function. Public liveness/readiness checks remain available; dashboard data, market, monitoring, and operational routes require a valid session.

## Account and session behavior

- One configured username and one shared dashboard administrator; there is no registration, password reset, OAuth, Supabase Auth, roles UI, or user/profile mapping.
- `POST /api/v1/auth/login` compares the supplied password with the configured bcrypt hash and returns the same generic error for an incorrect username or password.
- `GET /api/v1/auth/session` returns a session-bound CSRF token and expiry only to the same-origin dashboard.
- `DELETE /api/v1/auth/session` verifies the session, exact allowed `Origin`, and CSRF token, revokes the session, and clears the cookie.
- The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, and uses the `__Host-` prefix.
- Session tokens are random and stored as SHA-256 hashes in a bounded in-memory session store. The default lifetime is eight hours (`API_SESSION_TTL_MS`); sessions are invalidated when the Pi runtime restarts.
- Bcrypt passwords are limited to 72 UTF-8 bytes. `npm run auth:hash-password` prompts without echo and emits a cost-12 hash.

## Configuration and deployment procedure

1. On the Raspberry Pi, generate a hash from an interactive terminal:

   ```sh
   cd ~/ai-crypto-pulse-bot/raspberry-pi
   npm run auth:hash-password
   ```

2. Set `DASHBOARD_USERNAME` and the generated `DASHBOARD_PASSWORD_HASH` in the Pi runtime `.env`. Never put the plaintext password or hash in source control, Vercel variables, command-line arguments, or logs. Keep `.env` readable only by the runtime operator.
3. Set `API_CORS_ORIGINS` to the exact dashboard origin, keep `API_HOST=127.0.0.1`, and keep `ENABLE_LIVE_TRADING=false`.
4. Configure `CRYPTOPULSE_RUNTIME_API_ORIGIN` in Vercel for both the Production build and function runtime. The value is an HTTPS Pi API origin without a path. It is routing configuration, not a credential.
5. If Cloudflare Access is enabled for the Pi API, also protect the Vercel dashboard origin with the corresponding Access application so its assertion can be forwarded by the existing proxy. Otherwise leave `CLOUDFLARE_ACCESS_ENABLED=false`.
6. Install the updated Raspberry Pi package dependencies and restart `cryptopulse-runtime.service`.
7. Verify an unauthenticated dashboard-page request redirects to `/login.html`; wrong credentials return `401`; valid credentials set the secure cookie; refresh retains the session; logout returns `204`; and subsequent page/API access requires another login.
8. Verify `GET /api/v1/health/live`, `GET /api/v1/markets`, and `GET /api/v1/dashboard-data` through the Vercel same-origin route. Health liveness is public; dashboard data must return `401` without a session and `200` with a valid session.

## Implementation and local validation

- Added required Pi runtime settings for the sole username and bcrypt hash; startup fails closed if they are missing or malformed.
- Added Pi login, session lookup, and CSRF-protected logout routes, and applied session authentication to dashboard read routes.
- Added the same-origin Vercel proxy and protected-page verification using existing function files.
- Added the login form, safe internal return paths, session checks, and logout behavior; disabled registration and password recovery.
- Updated the root and Raspberry Pi READMEs, API/architecture/testing documentation, roadmap, and changelog.

Validation executed:

| Check | Result |
|---|---:|
| Repository tests (`npm test`) | 531 passed, 0 failed |
| Raspberry Pi tests (`npm test --prefix raspberry-pi`) | 178 passed, 0 failed |
| Dashboard build and project/database validation (`npm run build`) | Passed |
| JavaScript/module syntax validation | 174 files passed |
| Vercel API function files | 12 of 12 |
| `git diff --check` | Passed |
| GitHub push to `main` | Passed (`ee0e1dc`) |
| Vercel Production status for `ee0e1dc` | Success — deployment completed |
| Production `/login` | HTTP `200` |
| Production unauthenticated `/dashboard` | HTTP `302` to `/login.html` |

Tests cover wrong-password rejection, session cookie attributes, refresh/session lookup, logout revocation, unauthenticated data denial, same-origin proxy forwarding, protected-page redirects, safe next paths, and no new Vercel function files.

## Production validation and limitations

The live Pi `.env` was not inspected or modified, and the service was not restarted from this worktree. Therefore credential validation, authenticated login/logout, browser cookie persistence, direct Pi API denial, and Vercel-to-Pi authenticated proxying remain unverified. The Vercel deployment and unauthenticated page protection were verified, but a successful static deployment does not prove Pi authentication is configured. A runtime restart invalidates all existing sessions, requiring the administrator to sign in again.

This phase adds no database migration or write endpoint. The dashboard remains read-only and continues to use the shared system portfolio. The implementation is locally validated, but Phase 9 is not considered production-complete until the Vercel Production deployment and Raspberry Pi login/API checks above succeed.
