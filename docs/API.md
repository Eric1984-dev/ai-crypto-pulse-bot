# API Architecture

## Active dashboard bridge

The browser uses same-origin Vercel functions so the `__Host-cp_session` cookie can be forwarded without exposing the Pi session token, password hash, or database credentials. Vercel does not read or write application tables.

| Browser route | Behavior |
|---|---|
| `POST /api/auth-session` | Forwards credentials to `POST /api/v1/auth/login`; the Pi validates the configured username and bcrypt hash and returns the secure session cookie. |
| `GET /api/auth-session` | Forwards `GET /api/v1/auth/session` using the session cookie. |
| `DELETE /api/auth-session` | Forwards logout with the session cookie, exact Origin, and CSRF token. |
| Protected page routes | `/dashboard`, `/portfolio`, `/scanner`, `/analytics`, `/recommendations`, `/history`, `/exports`, `/settings`, and `/admin` are served through `/api/protected-page` after Pi session verification. |
| `GET /api/dashboard-data?path=<encoded-path>` | Forwards an authenticated request to an allowlisted Pi `/api/v1/` path on `CRYPTOPULSE_RUNTIME_API_ORIGIN`. |

The proxy accepts exactly one `path` query parameter and rejects missing, duplicate, or non-versioned paths. A direct legacy query such as `/api/dashboard-data?view=analytics` is not supported; the `view` belongs in the encoded Pi path, for example `/api/v1/dashboard-data?view=analytics`.

The only Vercel function files are `api/auth-session.mjs`, `api/protected-page.mjs`, and `api/dashboard-data.mjs` (3 of the Hobby limit of 12). `vercel.json` protects page routes and configures static hosting; it declares no Cron jobs.

## Raspberry Pi API

The Pi runtime is the sole application API and validates the session, request, and database access. The dashboard reads these route groups:

| Route | Purpose |
|---|---|
| `POST /api/v1/auth/login` | Single-admin login. |
| `GET /api/v1/auth/session` | Session validation and CSRF-token retrieval. |
| `DELETE /api/v1/auth/session` | CSRF-protected session revocation. |
| `GET /api/v1/health/live` and `/api/v1/health/ready` | Public liveness/readiness checks. |
| `GET /api/v1/dashboard-data` | Portfolio, positions, recent trades, decisions, snapshots, current system data, and bounded shadow-exit scenarios/events. Shadow data reports `UNAVAILABLE` independently if its read grant or tables are unavailable. |
| `GET /api/v1/dashboard-data?view=analytics` | On-demand analytics data. |
| `GET /api/v1/dashboard-data?view=trade-history` | Filtered and paginated trade history. |
| `GET /api/v1/dashboard-data?view=analysis-export-manifest` | Fixed `asOf` boundary, source definitions, row/file limits, active markets, and paper-risk metadata for a full-history export. |
| `GET /api/v1/dashboard-data?view=analysis-export-page&source=trades&asOf=<UTC timestamp>&cursor=<opaque>` | Authenticated bounded keyset page for one allowlisted export source; pages are read sequentially by the browser. `candleWindows` pages return up to ten anchors and at most 1,200 unique candle rows, each with its page-local anchor timestamps. The browser deduplicates across pages and writes separate anchor-to-candle links. |
| `GET /api/v1/markets`, `/api/v1/market`, `/api/v1/market-summary` | Watched markets, market detail, and scanner rankings. |
| `GET /api/v1/agent-status` | Current agent status. |
| `GET /api/v1/monitoring` | Pi model, runtime, scheduler, process, host, database, and position-exit stage monitoring. |

Data endpoints require the single-admin session and return no-store responses. Dashboard reads make one bounded retry after HTTP 429 using the server's `Retry-After` header. The dashboard monitoring view and Exports page resource panel use `/api/v1/monitoring`; both display the Raspberry Pi model first, followed by temperature, CPU, and memory from its `system` metrics. The model is read from `/proc/device-tree/model` and is nullable when that file is unavailable. Neither page calls the retired Vercel archive-health handler. Current contracts and bounds are maintained in the [Pi API implementation](../raspberry-pi/src/api/).

The full-history export uses the existing `/api/v1/dashboard-data` route and the existing Vercel proxy function; it adds no serverless function or write endpoint. The browser saves bounded JSONL parts and a manifest locally, honors `Retry-After` on rate limiting, and does not upload data to an AI service. The fixed `asOf` boundary does not create a transactionally consistent database snapshot.

## Retired API surface

The former Vercel Supabase Auth/PostgREST endpoints, external-scheduler endpoints, Admin Actions, and duplicate market/status endpoints have been removed from `api/`. There is no Supabase fallback in the active dashboard proxy. PostgreSQL migrations remain in the repository as historical schema provenance and local test fixtures; they are not API routes or deployment instructions.

The optional Pi-side archive CLI is a separate manual utility, not an API or trading dependency. Its Supabase source connection uses isolated archive-specific configuration documented under `archive-server/`.
