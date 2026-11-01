# Analytics Root Cause Report

## Executive Summary

The supplied production log identifies the failing dataset and request: `AI_Crypto_Bot_AI_Decisions`, query `analytics.ai-decisions`, `SELECT` page 3 (`1000-1499`), HTTP `416`, Supabase/PostgREST code `PGRST103`. Analytics Exports use the same analytics service, so an identical source-query failure also prevents Analytics CSV counts and downloads.

This confirms a range/pagination failure in the AI Decisions read, not a missing table. The supplied log does not contain the Supabase error message or details, so the exact reason the range was rejected remains unknown. Temporary instrumentation now records the exact request query and Supabase error fields. It returns those diagnostics in the response only when `NODE_ENV=development`; production responses stay generic.

## Confirmed Production Failure

```text
Analytics query failed. QUERY=analytics.ai-decisions TABLE=AI_Crypto_Bot_AI_Decisions OPERATION=SELECT PAGE=3 RANGE=1000-1499 HTTP_STATUS=416 ERROR_CODE=PGRST103 FAILURE_CATEGORY=HTTP_ERROR
```

| Field | Confirmed value |
|---|---|
| Dataset/table | `AI_Crypto_Bot_AI_Decisions` |
| Query identifier | `analytics.ai-decisions` |
| Operation | `SELECT` |
| Page and range | Page 3, rows `1000-1499` |
| Response status | `416` |
| Supabase/PostgREST code | `PGRST103` |
| Supabase message/details | Not present in the supplied log |

The current Analytics decision request selects `id,symbol,decision,confidence,strategy_name,strategy_version,created_at`, orders by `symbol,created_at,id`, applies the selected period's `created_at` cutoff, and requests a 500-row range. The supplied production log identifies the failing page but does not include the full URL/query parameters or selected period.

`PGRST103` indicates that PostgREST rejected the requested range. This is consistent with a range/count mismatch or a server-side range constraint, but the log alone cannot distinguish those causes. The total historical row count does not establish how many rows were visible for the selected period and query.

## Why the API Returns 503

1. The Analytics page calls `GET /api/dashboard-data?view=analytics`; Analytics CSV counts/downloads use `view=export-count` or `view=export` on the same existing function.
2. Both Analytics views load data through `lib/analytics.mjs`, which streams trades and AI decisions with the shared paged reader in `lib/exports.mjs`.
3. A non-success response from the failing AI Decisions page becomes an `ExportDataError` with query diagnostics.
4. `api/dashboard-data.mjs` catches that data error and returns HTTP `503` with `DASHBOARD_DATA_UNAVAILABLE`. The browser then displays its generic Analytics loading failure.

The Analytics Exports failure is therefore consistent with the same AI Decisions source query failing; it does not require a separate export endpoint or an independent export-table problem.

## Temporary Diagnostics Added

The existing `/api/dashboard-data` function now logs:

- request view and Analytics export type, when applicable
- exact dataset/table and query identifier
- exact PostgREST method, path, and query string
- operation, page, and range
- exact HTTP status and allowlisted database code
- Supabase `message`, `details`, and `hint`
- failure category, including `RANGE_NOT_SATISFIABLE` for HTTP 416

With `NODE_ENV=development`, the same fields are returned under `error.diagnostics`. In production, the response remains limited to the existing generic error code and message. Logs do not include rows, request headers, access tokens, or the full Supabase response body.

The diagnostics are temporary. After deploying, reproduce the Analytics failure and an Analytics Export failure, then inspect the Vercel function logs for `Analytics query failed`. The `SUPABASE_MESSAGE` and `SUPABASE_DETAILS` fields should distinguish an unavailable offset from other PostgREST range constraints. Do not convert this failure into a successful partial result: Analytics validates source counts and must fail closed rather than report incomplete metrics.

## Validation and Scope

- Focused Analytics and export tests: passed, 27 tests.
- Full `npm.cmd test`: passed, 205 tests with 0 failures.
- `npm.cmd run build`: passed static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency).
- API function count: 12, unchanged.
- API endpoints or Vercel Functions added: none.
- Database schema or migrations changed: none.
- Analytics calculations or paper-trading logic changed: none.
- Phase 14: not started.

Local tests verify diagnostic fields and production/development response behavior with mocked Supabase responses. They cannot establish the exact hosted Supabase error message until this instrumentation is deployed and the failing request is reproduced.
