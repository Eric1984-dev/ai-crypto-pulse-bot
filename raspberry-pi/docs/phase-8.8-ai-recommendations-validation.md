# Phase 8.8 — AI Recommendations and Analytics Validation

## Scope

This phase investigates and fixes the dashboard's AI Recommendations and Analytics loading errors. Changes are confined to `raspberry-pi/`; the frontend, recommendation-generation rules, AI engine, database schema, API routes, and response envelope remain unchanged.

## Architecture and affected components

```text
Dashboard Analytics / Recommendations pages
  -> GET /api/v1/dashboard-data?view=analytics|recommendations
  -> DashboardRepository.getAnalytics()
  -> buildDashboardAnalytics()
  -> existing recommendation generator
  -> PostgreSQL
```

- **Endpoint:** `GET /api/v1/dashboard-data?view=recommendations&period=30d`
- **Shared endpoint:** `GET /api/v1/dashboard-data?view=analytics&period=30d`
- **Repository:** `DashboardRepository.getAnalytics()`; the same read path serves both views.
- **Analytics service:** `buildDashboardAnalytics()` produced data missing fields consumed by the recommendation generator.
- **Frontend:** the existing Analytics and Recommendations components display generic load errors when the API fails. Their request and response expectations are consistent with the API's intended response; no frontend change was needed.

## Root cause

The recommendation generator requires closed-trade sample counts for confidence buckets and strategies, plus `maxDrawdown` and `snapshotCount` for portfolio analytics. The Raspberry Pi analytics builder did not emit those fields.

The error was conditional: fewer than ten closed trades causes the generator to return an insufficient-data response before reading the missing fields. At ten or more closed trades, recommendation generation throws while validating the analytics data. The recommendations view invokes the generator directly; the Analytics view invokes it indirectly while calculating recommendation export counts. Thus both views can fail even though they use the same successful repository query.

The failure is downstream of the repository's SQL reads, not a SQL or response-property mismatch. Production database contents were not queried as part of this local validation, so the exact live trade count at failure time is unverified.

## Fix applied

- Added per-group `tradeCount`, calculated from distinct matched closed-trade IDs, to analytics decision groups. The internal ID sets are not exposed in the response.
- Added period-scoped `snapshotCount` and `maxDrawdown` to portfolio analytics. `maxDrawdown` is `null` when the selected period has no snapshots.
- Added Raspberry Pi API and repository regression coverage for both affected views and the required analytics fields.
- Left recommendation generation, frontend rendering, API routing, and database schema unchanged.

## Validation results

| Validation | Result |
|---|---|
| Targeted Pi API and repository tests | Passed: 18 tests, 0 failures |
| Dashboard recommendations UI tests | Passed: 5 tests, 0 failures |
| Full repository and dashboard tests (`npm.cmd test`) | Passed: 346 tests, 0 failures |
| Full Raspberry Pi suite (`npm.cmd test`) | Passed: 179 tests, 0 failures |
| Syntax validation | Passed for all changed JavaScript modules |
| `git diff --check` | Passed |

The API regression test exercises both views through the Pi HTTP server and confirms each returns `200` with the expected data. It includes a dataset with at least ten closed trades and verifies generated recommendations. Frontend tests confirm the existing request and renderer continue to handle the response.

## Live validation and limitations

Authenticated production API requests and browser-console inspection were not performed from this worktree. No Raspberry Pi deployment or production database access was performed. Therefore, local `200` responses and passing UI tests validate the implementation and contracts, but do not establish that the production Pi has received the change or that its live pages are now error-free.

After deploying this commit to the Pi, verify both authenticated endpoints return `200` and inspect the Analytics and Recommendations pages in a browser. No Phase 9 work was started.

## Follow-up — recurring Analytics unavailable response

On 2026-11-12, the user reported that both tabs still returned `ANALYTICS_UNAVAILABLE`. They share `DashboardRepository.getAnalytics()`. The repository previously fetched every AI decision in the selected period, then returned an error when that query exceeded its 10,000-row cap. The Pi analyzes all enabled markets on each five-minute runtime cycle, so decision history can exceed this cap quickly. The exact live row count and cause for the supplied request IDs were not available from this workspace.

The follow-up implementation aggregates decision counts by action, confidence band, strategy, and market in PostgreSQL. It loads only period-matched decisions referenced by the bounded trade result for outcome scoring, preserving the analytics response shape without transferring the full decision history. Analytics repository failures now also produce a safe diagnostic containing the request ID, view, and either the stored-data reason or PostgreSQL error code.

The aggregate path was exercised with 10,001 additional decision rows. The targeted analytics/recommendation suite passed before the request-ID diagnostic test was added. A subsequent test rerun was denied, so the latest diagnostic-only changes and the full suites remain unverified. Production database row counts, Pi update, and live tab behavior were not verified.
