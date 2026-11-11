# Phase 10 — Post-Migration Cleanup

## Summary

The active runtime is the Raspberry Pi package. The browser remains hosted as static HTML, CSS, and JavaScript on Vercel and uses three same-origin functions for single-admin authentication, protected-page delivery, and the authenticated Pi API proxy:

```text
Browser
  -> Vercel static dashboard and same-origin auth/data bridge
  -> configured HTTPS Pi API origin
  -> Cloudflare Tunnel
  -> Raspberry Pi runtime and PostgreSQL
```

The Vercel bridge is part of the checked-in dashboard contract; removing it would break the session-cookie flow. The Pi runtime owns market ingestion, AI, paper trading, scheduling, and operational monitoring. The operator reports that these services, the dashboard, authentication, and the custom-domain tunnel are operational. This report does not independently access the Pi, Cloudflare account, database, or Vercel project.

## Audit findings and dispositions

| Area | Finding | Disposition |
|---|---|---|
| Vercel functions | `auth-session`, `protected-page`, and `dashboard-data` are called by the active browser/session flow. `dashboard-data` is the same-origin bridge to allowlisted `/api/v1/` paths. | Retain these three functions. |
| Legacy API routes | The remaining nine function files provide Supabase Auth/database access, Vercel-triggered ingestion/AI/trading, or obsolete market/status endpoints. The active browser uses the Pi API through the bridge, and the Pi runtime owns scheduled work. | Remove from `api/` so they are no longer deployed as Vercel functions. |
| Dashboard data handler | The active path is the `path`-parameter proxy. The old default Supabase dashboard, analytics, export, recommendation, shadow-exit, and archive-health handlers are not called by current dashboard code. | Keep the function as a proxy only; remove the inactive Supabase fallback. |
| Supabase application code | Root auth, admin, scheduler, market-data, analytics data-fetching, Supabase export services, shadow-exit, and paper-trading modules are tied to the retired Vercel runtime. The Pi API still imports shared market-scanner, analytics-export formatting, and recommendation helpers from root `lib/`. | Remove retired data-fetching services; retain only the shared domain/CSV helpers and their tests because active Pi routes depend on them. |
| PostgreSQL migration history | `supabase/migrations/`, `config/markets.js`, and `scripts/validate-database.js` are used by local migration/contract tests and preserve schema and seed provenance. They do not connect to or modify a live Supabase project. | Retain as historical schema and test evidence; do not reapply migrations or alter production data. |
| Archive service | `archive-server/` still contains the separately invoked copy-only archive CLI and its health service. Its retirement is not confirmed, and the user explicitly requires monitoring to remain. It is not part of trading execution. | Retain as an optional Pi-side utility. The current dashboard monitoring card reads the Pi runtime monitoring API, not the old Vercel archive-health proxy. |
| Runtime configuration | Root `.env.example` contains legacy Supabase, Vercel scheduler, administrator-ID, and archive-proxy settings. The Pi and archive packages have their own active configuration templates. | Remove obsolete root variables; retain the Pi/archive-specific settings in their package templates. |
| Scripts | `scripts/build-runtime-api-config.mjs` is invoked by the root build; `scripts/validate-project.js` and `scripts/validate-database.js` are invoked by build validation; the Pi password-hash utility is exposed by its package script. | Retain all remaining scripts; no other script was confirmed unused. |
| Documentation | Root README, API, architecture, deployment, scheduling, and migration pages present old Supabase/Vercel runtime assumptions as current. Phase reports also preserve historical implementation evidence. | Update operational documentation and mark migration plans/reports as historical; preserve evidence rather than deleting it. |
| Vercel deployment config | `vercel.json` protects pages and the three active functions; no Vercel Cron is configured. | Retain the protected-page routing and static deployment setup. Do not change project settings or initiate a manual deployment. |

## Cleanup applied

Files removed:

- Vercel functions: `api/admin-actions.mjs`, `api/agent-status.mjs`, `api/ai-analysis.mjs`, `api/auth-config.mjs`, `api/candle-refresh.mjs`, `api/market.mjs`, `api/market-refresh.mjs`, `api/market-summary.mjs`, and `api/paper-trading.mjs`.
- Retired root services: `lib/admin-auth.js`, `lib/ai-engine.mjs`, `lib/analytics.mjs`, `lib/archive-server-health.mjs`, `lib/auth-session.js`, `lib/cron-auth.js`, `lib/exports.mjs`, `lib/market-data.mjs`, `lib/market-handler.mjs`, `lib/shadow-exits.mjs`, and `lib/supabase-response-metrics.mjs`.
- Retained shared services: `lib/analytics-exports.mjs`, `lib/dashboard-exports.mjs`, `lib/market-scanner.mjs`, and `lib/recommendations.mjs`; active Pi API routes import these modules.
- Inactive administrator-action client: `js/admin.js`.
- Tests tied only to the retired root runtime: `tests/admin-actions.test.mjs`, `tests/agent-status.test.js`, `tests/ai-engine.test.mjs`, `tests/analytics.test.mjs`, `tests/exports.test.mjs`, `tests/market-data.test.mjs`, `tests/paper-trading.test.mjs`, and `tests/supabase-response-metrics.test.mjs`.
- Retained shared-service tests: `tests/market-scanner.test.mjs` and `tests/recommendations.test.mjs`; their analytics CSV coverage now exercises the shared CSV writer used by the Pi API.
- Superseded root API fallback tests were removed from `tests/dashboard.test.js` and `tests/trade-history.test.js`; Pi API, dashboard UI, authentication, and runtime-proxy tests remain.

Files retained:

- The Raspberry Pi runtime, API, PostgreSQL repositories, scheduler, AI engine, paper-trading implementation, and monitoring.
- The three active Vercel bridge functions and their shared runtime-proxy helper.
- `archive-server/` and its package-specific credentials template; its use as a manual archive/monitoring utility is not confirmed retired.
- Database migration SQL, default-market seed configuration, and local migration tests as historical schema provenance and validation fixtures.
- Historical phase and investigation reports.

## Documentation and configuration changes

- Replaced the root README's old Supabase/Vercel runtime summary with the Pi-owned production topology and evidence boundary.
- Updated root API, architecture, deployment, scheduling, testing, database, known-issues, changelog, and roadmap pages.
- Marked pre-cutover migration design/status documents as historical and linked them to current operating documentation.
- Replaced root `.env.example` with public dashboard-routing settings and the live-trading safety default. Archive-only Supabase reader settings remain isolated in `archive-server/.env.example`.
- Updated `scripts/validate-project.js` to require only the three active Vercel functions, the shared proxy, and the current root environment contract.
- Reduced `api/dashboard-data.mjs` to the authenticated Pi proxy; requests without exactly one supported Pi path now return `400` and never reach Supabase.

## Validation evidence

- `npm.cmd test` — passed: 386 tests, 0 failures.
- `npm.cmd --prefix .\raspberry-pi test` — passed: 178 tests, 0 failures.
- `npm.cmd run build` — passed static project validation and database migration validation (18 prefixed tables, RLS coverage, and initial-seed consistency).
- Syntax validation — passed `node --check` for 146 JavaScript and module files.
- `git diff --check` — passed with no whitespace errors.
- Dashboard, authentication, and Pi API regression coverage ran as part of the repository and Pi test suites.
- Commit `b7d7ccd3b550567ad7e41e7fe4a31260b0ec069e` was pushed to `main`.
- GitHub reported the Vercel check as `success` with “Deployment has completed” for that commit.
- Production smoke checks: the dashboard domain served its public sign-in landing page, and `/api/v1/health/live` returned `{"data":{"status":"live"}}`.
- No manual deployment or Vercel setting changes were made; the GitHub push triggered the configured deployment.

## Remaining risks and limitations

- The production Pi, Cloudflare tunnel configuration, and PostgreSQL internals were not directly inspected. The public API health endpoint and dashboard landing page were reachable.
- The external Cloudflare/Vercel settings and any manually configured third-party scheduled tasks were not inspected. No Vercel cron is present in the repository; the current scheduler owner is the Pi runtime.
- The archive CLI still uses a separate, restricted Supabase source reader for its optional manual copy workflow. It was retained because its retirement was not confirmed; it is not part of the Pi trading runtime.
- Supabase-named migration history is retained for reproducibility and local tests. No remote Supabase database, project, branch, migration, or data was changed.
- A Git push may trigger the repository's configured Production deployment. No manual Vercel deployment or setting change is performed by this task.

## Readiness assessment

The cleanup leaves the Raspberry Pi runtime as the owner of backend operations while preserving the existing dashboard authentication/proxy contract. Repository, Pi, build, syntax, and whitespace checks passed; the commit was pushed and Vercel reported deployment success, with both production smoke checks responding as expected. Internal PostgreSQL and runtime behavior remain outside the scope of these external checks. No Phase 11 work is included.
