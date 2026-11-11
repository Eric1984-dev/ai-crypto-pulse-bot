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

After the merge to `main`, the dashboard integration tests (38 tests), full Raspberry Pi package tests (173 tests), syntax checks, and merge-patch whitespace checks were rerun successfully.

## Merge and deployment correction

The implementation was initially committed as `d428f3462e7459ab5f886e3ffa3d05a0fd356f0d` on `phase-8.6-dashboard-ui-alignment`. The branch later advanced to `4474a8aeeff547850904c88f507ef58e5d0ba2f8`; that follow-up only added a trailing blank line to `raspberry-pi/src/api/api-error.mjs`. At the time of the deployment correction, `main` pointed to `16cb328` (`test commit`) and did not contain the Phase 8.6 implementation. The root cause was that the feature branch had never been merged into `main`.

The feature branch was merged into `main` in commit `efb87747750df7a2ba27aa7a91f275a48f9d9906`, and the push to `origin/main` succeeded. GitHub reported the Vercel check as `success` for that merge commit: [Vercel deployment status](https://vercel.com/erics-projects-998b3609/ai-crypto-pulse-bot/3B5pXBFarRHkxBn6Vjp7K632z47y). Fetching the production dashboard confirmed that the visible infrastructure heading is **Raspberry Pi**.

The Raspberry Pi runtime is separate from the Vercel static-site deployment. The checked-in systemd unit starts `node src/index.mjs` from the Pi's local working directory; it does not pull or deploy repository changes. A live `GET /api/v1/agent-status` request after the `main` merge still returned `{"data":{"status":"IDLE"}}`. No Pi-side code update or systemd restart was performed from this worktree, so the `ACTIVE` status change is merged and locally validated but is not yet live.

## Assessment

The branch and merge root cause are resolved. The Raspberry Pi label is live on Vercel Production, and `main` contains the runtime status implementation. Phase 8.6 deployment acceptance remains incomplete until the updated runtime is installed and restarted on the Raspberry Pi and `/api/v1/agent-status` returns `ACTIVE` during healthy operation. No Phase 9 work was started.
