# Analytics Database Pool Contention Fix

## Summary

`DashboardRepository.getAnalytics()` fetched six independent PostgreSQL read results with `Promise.all`. The Raspberry Pi runtime's default pool is limited to four connections, while `PG_CONNECTION_TIMEOUT_MS` defaults to 2,000 ms. Under normal pool use, the extra concurrent reads could wait for a connection and fail before starting. The operator temporarily raised this setting to 10 seconds and reported that the errors stopped.

The method now performs the same six bounded, read-only queries sequentially. This avoids the six-connection burst and keeps Analytics and AI Recommendations within the small shared API pool. Query SQL, filters, result bounds, calculations, response shape, and recommendation logic are unchanged. AI analysis, paper trading, execution rules, and trading data are untouched.

## Changes

- Replaced the six-way `Promise.all` in `DashboardRepository.getAnalytics()` with sequential query execution.
- Added a repository regression test asserting that Analytics uses at most one active database connection at a time.
- No schema, migration, dependency, configuration, or deployment changes.

## Validation

- Focused Analytics/repository tests: **20 passed, 0 failed**.
- Full Raspberry Pi test suite: **278 passed, 0 failed**.
- `npm.cmd run build`: **passed** (static project and database migration validation).
- `git diff --check`: **passed**.

Tests use local fixtures. They do not validate a live Pi deployment or production PostgreSQL behavior. Production verification still requires an operator-managed Pi rollout and smoke tests of both Analytics and AI Recommendations.

## Risk and scope

Sequential reads can increase total Analytics response time compared with parallel execution, but avoid reserving six pool connections and prevent two of them from queuing behind the pool limit. Per-query timeout remains unchanged. No analytics or trading semantics were changed.
