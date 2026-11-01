# Dashboard Admin Actions Report

## Status

Implemented and validated. Phase 09 has not been started.

## Functionality

The dashboard includes a separate **Admin Actions** section with:

- **Execute AI Analysis** — invokes the existing AI Engine service.
- **Execute Paper Trading** — invokes the existing paper-trading service.

The section stays hidden until the server confirms the signed-in user is an administrator. While either action runs, both buttons are disabled to prevent duplicate clicks. The UI displays running, success, and failure states, execution duration, and a safely rendered JSON summary. It refreshes dashboard data after a successful action.

No Market Refresh or Candle Refresh controls were added.

## Authorization and safety

- The server reads the existing HttpOnly Supabase session cookie and verifies it with Supabase Auth.
- The verified Auth user UUID must appear in the server-only, comma-separated `ADMIN_USER_IDS` environment variable. Missing or malformed allowlist configuration fails closed.
- The browser does not receive or send `ADMIN_USER_IDS`, `CRON_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY`.
- Admin actions invoke the existing AI and paper-trading services. AI status handling remains unchanged. Paper trading still requires `ENABLE_LIVE_TRADING=false` and uses the existing transactional RPC, freshness checks, confidence threshold, cooldown, position/drawdown limits, emergency stop, and idempotency protections.
- Existing cron endpoints and their scheduler authorization remain unchanged. The admin endpoint does not expose market or candle refresh actions.
- Response summaries are rendered with `textContent`; no HTML from API responses is interpreted.

## API

`GET /api/admin-actions` returns `{ "data": { "isAdmin": true } }` for an authenticated allowlisted user. `POST /api/admin-actions` accepts `{ "action": "ai-analysis" }` or `{ "action": "paper-trading" }` and returns the service result plus `metrics.executionDurationMs`.

The server requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_USER_IDS`. Paper-trading actions additionally require `ENABLE_LIVE_TRADING=false`.

## Files changed

- Added `api/admin-actions.mjs` and `lib/admin-auth.js`.
- Updated `dashboard.html`, `js/dashboard.js`, and `css/styles.css`.
- Added `ADMIN_USER_IDS` to `.env.example` and project validation.
- Added `tests/admin-actions.test.mjs` and dashboard request/UI-state regression tests.
- Updated `README.md`, `ROADMAP.md`, `docs/API.md`, and `docs/CHANGELOG.md`.

## Tests and validation

- `npm test` — passed: 125 tests, 0 failures.
- `npm run build` — passed static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency).
- Focused admin, dashboard, AI, and paper-trading tests — passed: 43 tests, 0 failures.

These are local checks; no production deployment or Vercel environment configuration was performed.

## Administrator setup

Set `ADMIN_USER_IDS` in the server environment to the comma-separated Supabase Auth UUIDs permitted to use these controls. Do not configure this variable as a client-side value. Continue to keep cron and service-role credentials server-side.
