# Phase 8.5 Dashboard Function Validation

## Scope and architecture

This phase validates the existing dashboard against the Raspberry Pi runtime API without redesigning the frontend or adding dashboard write operations. The path remains:

```text
Existing dashboard
  -> HTTPS / configured runtime API origin
  -> Cloudflare Tunnel (deployment-dependent)
  -> Raspberry Pi read-only API
  -> PostgreSQL
```

Changes are limited to the Raspberry Pi API, repositories, analytics service, and their tests. No frontend files, database schema, trading behavior, or live-trading paths were changed.

## Analytics

The `GET /api/v1/dashboard-data?view=analytics` response supplies the analytics metrics and chart series consumed by the existing Analytics page. The response also includes export counts. Before the fix, generating the AI analytics export count expected `aiPerformance.bySymbol`, but the analytics builder did not provide it, causing a `TypeError` and an API `500`.

The analytics builder now emits per-symbol AI performance groups, with decision counts and linked trade outcomes/P&L where available. API contract tests verify the groups and the data required by the Analytics page, including action and confidence distributions. The Analytics page's existing integration tests are included in the repository test suite.

## Trade History

The Trade History API supports filtering, sorting, and bounded pagination. Two contract defects were fixed:

- The route passed the ISO string from its clock into the repository, which requires a `Date`; it now passes a `Date`.
- The dashboard sends lowercase `buy`/`sell` filter values while the repository expects canonical uppercase sides; the route now accepts either case and normalizes it.

History statistics are queried for all portfolio SELL trades, independently of the current page filters, matching the existing UI's all-time statistics. Repository tests cover filtering, sorting, pagination, and this filter-independent statistics behavior. API tests cover lowercase filter normalization and the `Date` passed to the repository.

## Open Positions AI Status and unrealized P&L

The successful live dashboard-data response contained position records, but the `openPositionAiStatus` entries exposed only `symbol` and `latestAiDecision`. The existing renderer needs `amount`, `entry_price`, and `current_market_price` to calculate current unrealized P&L; it can use stored `unrealized_pnl` as a fallback. The API response now includes those fields and the current-price capture timestamp. No calculation or trading logic was added.

Repository tests verify that the AI-status position payload contains the fields used by the existing renderer. Frontend integration tests remain unchanged and pass. The live endpoint's current-price values were not revalidated after the code change, so the presence and freshness of prices for every production position remain an operator verification item.

## Dashboard contract validation

| Area | Local verification |
|---|---|
| Analytics | API contract covers analytics response shape, per-symbol AI performance, and export-count generation. |
| Trade History | API and repository tests cover case-insensitive side filters, `Date` clock handling, filtering, sorting, pagination, and all-time statistics. |
| Open Positions AI Status | Repository test asserts the required price, entry, amount, capture-time, and P&L response fields. |
| Existing dashboard rendering | The repository test suite includes dashboard integration tests; no frontend code was changed. |

## Live validation evidence

The live Raspberry Pi checks performed before these local fixes reported:

- `GET /api/v1/health/live`, `/api/v1/markets`, and the default `/api/v1/dashboard-data` returned `200`.
- The default dashboard response contained five open positions.
- Analytics and Trade History requests returned `500`.
- A lowercase `side=sell` Trade History request returned `400 INVALID_QUERY`; an uppercase `SELL` request still returned `500`.
- A trade export-count request returned `200`.
- A later request to the Quick Tunnel returned Cloudflare `530`, blocking further live checks.

These are baseline observations from before the local fixes, not post-fix production results. The changes have not been deployed to the Raspberry Pi, and Analytics, Trade History, and position P&L have not been verified against a post-fix live endpoint.

## Fixes applied

- Added the missing `aiPerformance.bySymbol` analytics groups needed by AI export-count generation.
- Passed a `Date` to the Trade History repository instead of the ISO clock string.
- Accepted and normalized lowercase dashboard trade-side filters.
- Added the price, position, capture-time, and unrealized-P&L properties required by the existing Open Positions AI Status renderer.
- Made Trade History statistics independent of active history filters.
- Added API and repository regression tests for these contracts.

No schema migration, API endpoint, dashboard feature, or dependency was added.

## Validation results

Executed locally on the repository worktree:

| Check | Result |
|---|---|
| Targeted API and repository tests (`node --test tests\\data-api.test.mjs tests\\dashboard-repository.test.mjs`) | Passed: 17 tests, 0 failures |
| Raspberry Pi package suite (`npm.cmd test` from `raspberry-pi/`) | Passed: 172 tests, 0 failures |
| Repository and dashboard integration suite (`npm.cmd test` from repository root) | Passed: 511 tests, 0 failures |
| `node --check` on all modified runtime and test modules | Passed |
| `git diff --check` and trailing-whitespace check on the new report | Passed |

The initial `npm test` invocation was blocked by this Windows PowerShell execution policy loading `npm.ps1`; the equivalent `npm.cmd test` commands ran successfully.

## Limitations and remaining risks

- Post-fix live validation is blocked until the Quick Tunnel is reachable and the Raspberry Pi has the updated code.
- The Analytics, Trade History, and Open Positions AI Status endpoints must be retested after deployment; local tests do not establish production runtime behavior.
- Confirm each live open position has a numeric, sufficiently fresh current price. If a current price is unavailable, the UI can only display the stored unrealized P&L fallback.
- These changes do not authenticate public access. Keep the API behind a trusted network boundary or enable Cloudflare Access before exposing it publicly.

## Assessment

The local Phase 8.5 implementation and regression suites pass, and the existing dashboard contract is preserved without frontend modifications. Production acceptance is **pending** live post-deployment checks for Analytics, Trade History filters/pagination, and unrealized P&L. Phase 9 has not started.
