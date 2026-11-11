# Phase 8.6 Dashboard UI Alignment

## Scope

This phase makes the requested dashboard status and infrastructure-label adjustments. The Raspberry Pi runtime and its tests are changed within `raspberry-pi/`; the dashboard heading and its integration test are the only approved files outside that directory. Dashboard behavior, API contracts, database schema, trading logic, and Phase 9 are unchanged.

## Runtime status

The runtime now reports `ACTIVE` after a healthy startup has bound the API and started the scheduler, rather than displaying `IDLE` while waiting for the first scheduled cycle. After a successful cycle, status returns to `ACTIVE`; during analysis it remains `ANALYZING`. Runtime cycle failures continue to report `ERROR`, and a clean shutdown reports `IDLE`.

Startup promotes only an existing `IDLE` status to `ACTIVE`. An interrupted `ACTIVE`/`ANALYZING` state still becomes `ERROR`, and the repository's status update guard continues to preserve emergency `STOPPED`. Tests cover healthy startup, successful-cycle completion, error handling, and preservation of `STOPPED`.

## Infrastructure label

The dashboard monitoring card is labeled **Raspberry Pi**, including its accessible disk-usage label. Internal selectors and the existing archive-health API/data contract remain unchanged; this is a user-facing label update only.

## Validation results

| Check | Result |
|---|---|
| Dashboard integration tests (`node --test tests\\dashboard.test.js`) | Passed: 38 tests, 0 failures |
| Raspberry Pi runtime lifecycle tests | Passed: 12 tests, 0 failures |
| Full repository suite (`npm.cmd test`) | Passed: 521 tests, 0 failures |
| Full Raspberry Pi package suite (`npm.cmd --prefix raspberry-pi test`) | Passed: 173 tests, 0 failures |
| Syntax checks for changed JavaScript modules | Passed: 5 modules |
| `git diff --check` | Passed |

Live Raspberry Pi validation was not run from this worktree. The local tests verify the status transitions and static dashboard labels; they do not establish live service or browser behavior on the Pi.

## GitHub and Vercel Preview

The user authorized pushing a feature branch to trigger GitHub and Vercel Preview validation. Remote checks are pending the initial push and will be recorded here after they complete.

## Assessment

The requested UI alignment is implemented and locally tested. This report does not mark the broader dashboard migration complete, assert live-Pi validation, or start Phase 9.
