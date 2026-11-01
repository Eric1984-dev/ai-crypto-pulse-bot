# Phase 13 Analytics Production Loading Fix

## Executive Summary

Analytics previously returned `503 DASHBOARD_DATA_UNAVAILABLE` while reading all retained AI decision history. The existing API handler intentionally returns a generic error for database/data failures, so the available evidence does not establish which production table or query failed. The most significant known load was the unbounded decision scan: 19,380 rows required 39 sequential 500-row pages; snapshots were also read across all history.

The existing Analytics path now defaults to a rolling 30-day window and supports 90- and 365-day ranges for historical trades, AI decisions, and portfolio snapshots. Source reads use exact caller-visible counts and bounded, concurrent 500-row pages. Safe query-level diagnostics identify the failing table and page internally while leaving the production API response generic.

No endpoint, database object, migration, or trading behavior was added or changed. The `api/` directory remains at 12 Vercel functions. `npm.cmd test` passed 202 tests, and `npm.cmd run build` passed. The change has not been deployed or verified against hosted Supabase/Vercel.

## Production Diagnosis

- The Analytics browser calls the existing authenticated `GET /api/dashboard-data?view=analytics` route.
- The route maps `AnalyticsDataError`, `ExportDataError`, and `TypeError` to HTTP `503` with code `DASHBOARD_DATA_UNAVAILABLE`; this is the condition behind the UI's generic loading error.
- The exact UI trigger is a non-OK fetch response: `requestAnalytics` throws when `response.ok` is false, and `startAnalytics` then displays “Analytics data could not be loaded. Please try again.”
- The prior implementation queried portfolios, positions, trades, decisions, then snapshots. It paged decision/trade histories sequentially and had no historical date cutoff. A Supabase error, timeout, malformed response, or failed range could all produce the same public 503.
- Verified table/column existence and row counts do not identify which read failed. No production query log or response body was available to confirm a specific table, RLS policy, or Supabase error code. Therefore the original failure is not attributed to a single table without evidence.
- The newly added internal diagnostics will identify the first failing Analytics query after deployment. They include query name, table, operation, page/range, HTTP status, safe database code, and failure category. They never log response bodies, rows, access tokens, or secrets. The public 503 remains unchanged.

## Implementation

### Date ranges and metric scope

- Supported windows: `30d`, `90d`, and `365d`, measured as rolling UTC cutoffs.
- The Analytics page defaults to 30 days and sends the selected range to the existing endpoint.
- Historical trades and AI decisions are filtered by `created_at`; portfolio snapshots are filtered by `captured_at`.
- Current portfolio values, open/closed position counts, and unrealized P&L remain current account metrics. Total P&L remains an all-time metric.
- Period realized-trade metrics use only in-range SELL trades. Portfolio period performance and drawdown use in-range snapshots; the first available in-range snapshot establishes the period baseline.
- All four Analytics CSV reports share the selected range. Raw data exports retain their existing filters.

### Large-history handling

- Every analytics source uses stable 500-row PostgREST ranges and a caller-JWT `HEAD` count to bound its final page under the same RLS visibility.
- At most four pages per source are prefetched concurrently. Trades, decisions, and snapshots are processed concurrently; source rows are not sent to or accumulated in the browser.
- A page whose returned row count conflicts with the exact count fails closed instead of returning partial analytics.
- The regression test synthesizes 100,001 decisions, 100,001 snapshots, and 10,001 trades. It verifies all rows are aggregated and source-page concurrency remains bounded.

## Exports Integration

The existing Analytics export cards share one period selector and one analytics request per selected range. Counts and downloads now use matching 30-, 90-, or 365-day data through `/api/dashboard-data`; no new export route or CSV implementation was introduced.

## Validation

| Check | Result |
|---|---|
| Focused Analytics/Exports tests | PASS — 31 tests |
| Large-history regression | PASS — 100,001 decisions, 100,001 snapshots, 10,001 trades |
| `npm.cmd test` | PASS — 202 tests, 0 failures |
| `npm.cmd run build` | PASS — static validation and database migration validation |
| API function count | PASS — 12 `.mjs` functions |
| Database schema changes / migration | None |
| Paper-trading behavior | Unchanged |
| Hosted Supabase/Vercel runtime | Not verified |

## Files Changed

- `lib/analytics.mjs`
- `lib/exports.mjs`
- `lib/analytics-exports.mjs`
- `api/dashboard-data.mjs`
- `analytics.html`
- `js/analytics.js`
- `exports.html`
- `js/exports.js`
- `tests/analytics.test.mjs`
- `tests/analytics-ui.test.js`
- `tests/exports-ui.test.js`
- `README.md`
- `ROADMAP.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/TESTING.MD`
- `docs/CHANGELOG.md`
- `docs/KNOWN_ISSUES.md`
- `docs/reports/PHASE_13_ANALYTICS_REPORT.md`
- `docs/reports/PHASE_13_ANALYTICS_PRODUCTION_FIX_REPORT.md`

## Outstanding Production Check

Deploy the existing application change, reproduce the Analytics request, and inspect the server log for the `Analytics query failed` entry. If the page still returns 503, the logged query/table/page and safe status/code fields will distinguish an RLS/permission, schema, malformed-response, pagination, network, or Supabase failure. Do not treat local mocked tests as proof of production resolution. Phase 14 has not started.
