# Dashboard Automatic Refresh Report

## Summary

The authenticated dashboard now refreshes all dashboard data every 30 seconds while visible and immediately when returning to the foreground. Existing API endpoints and `no-store` behavior are preserved. Phase 08 was not started.

## Refresh behavior

- After authentication initialization and the initial data load, a 30-second timer refreshes `/api/dashboard-data` and `/api/market-summary`.
- This refresh includes portfolio summaries, positions, recent trades, watched-market data, recent AI decisions, portfolio snapshots, emergency state, and agent status.
- The existing Agent Status-only endpoint continues to poll every 15 seconds. Its request is skipped while a full dashboard-data request is in progress.
- Both polling timers stop when the page becomes hidden and restart when it becomes visible. Returning to the foreground triggers an immediate full refresh.
- Concurrent full dashboard loads are guarded. If the page returns to the foreground while a full load is already running, one follow-up refresh is coalesced and runs after that load finishes.
- Browser fetches and server-side PostgREST requests continue to use `no-store`; no caching layer or API endpoint was added.
- A failed refresh retains the last successfully rendered dashboard values and displays the existing retry/error UI rather than replacing them with empty values.

## Files changed

- `js/dashboard.js` — visibility-aware full-data polling, foreground refresh, duplicate-load protection, and stale-view preservation on transient errors.
- `tests/dashboard.test.js` — periodic and foreground refresh, hidden-page pause/resume, in-flight duplicate suppression, and failure-state regression coverage.
- `README.md`, `ROADMAP.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and `docs/CHANGELOG.md` — documented behavior and test coverage.
- `docs/PHASE_04_COMPLETION_REPORT.md` — follow-up note.
- `docs/DASHBOARD_AUTO_REFRESH_REPORT.md` — this report.

## Validation

| Command | Result |
|---|---|
| `node --test tests/dashboard.test.js` | Passed: 17 tests |
| `npm.cmd test` | Passed: 104 tests, 0 failures |
| `npm.cmd run build` | Passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency) |

The tests use mocked API responses. No live Supabase or deployed-dashboard smoke test was performed.
