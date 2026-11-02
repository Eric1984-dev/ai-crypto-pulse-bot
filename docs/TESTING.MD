# Testing Strategy

Testing is mandatory.

All implemented functionality must be validated before a phase can be completed.

## Phase 02 validation

Phase 02 uses the built-in Node.js test runner. Auth SDK operations are tested with a fake Supabase client; Vercel route handlers are tested with mocked Supabase verification responses. No package installation is required.

```powershell
npm.cmd test
npm.cmd run build
```

The tests cover registration, login, logout, password reset and update, persistent-session configuration, anonymous and authenticated `getSession()` results, safe redirects, session cookies, all protected routes, and unauthorized redirects. Reset-page coverage checks anonymous visibility, recovery-link and recovery-event detection, password update, and the exact `https://<deployment-host>/reset-password.html` email redirect. A protected-page logout interaction test exercises the button listener, Supabase sign-out, `DELETE /api/auth-session`, the clearing `Set-Cookie` header, and the login redirect. Anonymous session lookup must return `null`, so public auth pages do not request server-side session verification before sign-in. The build command validates required pages and directories, local references, auth endpoints, protected Vercel rewrites, and environment defaults. It does not generate build artifacts.

No Supabase project credentials are present in the repository, so live-provider integration tests were not run. Configure `.env` and use the Vercel development runtime for a real Supabase smoke test. Database, market data, AI, risk, and paper-trading tests remain outside Phase 02.

## Phase 03 database validation

Phase 03 database tests execute the timestamped SQL migrations in PGlite, an embedded PostgreSQL engine used only for development tests. They verify the 16 prefixed tables, RLS activation, consistency of the immutable initial five-market seed with `config/markets.js`, Auth profile backfill and signup/email synchronization, Auth-delete cascades, user portfolio isolation, authenticated read access, anonymous denial, server-only writes, seed repeatability, unique trade/change idempotency keys, foreign keys, and representative data constraints.

```powershell
npm.cmd test
npm.cmd run build
```

The build check validates migration filenames, table/policy/index prefixes, per-table RLS coverage, and consistency of the immutable initial market seeds. PGlite tests do not connect to Supabase or validate a linked project's existing schema. Supabase CLI and Docker are not configured in this environment, so `supabase db reset`, `supabase db push`, and live-provider integration checks must be run separately where those tools and project access are available. Inspect the target database and back it up before applying migrations.

## Phase 04 dashboard validation

Dashboard tests use the Node.js built-in test runner with mocked Supabase PostgREST responses; they do not depend on credentials or create simulated trading records in the database. They cover verified-session requirements, forwarding the caller JWT and anon key, RLS-compatible data requests, summary calculations, error responses, rendering, text-safe list content, empty values, persisted-snapshot chart data, authentication readiness, retry behavior, expired-session redirects, 30-second full-data polling, immediate foreground refresh, hidden-page pause/resume, no-store requests, and coalescing while a dashboard load is already in progress.

Dashboard KPI help controls are checked for all 12 portfolio metrics, accessible button/tooltip relationships, English-only static dashboard copy, opening and toggling, outside-click dismissal, Escape dismissal with focus restoration, and listener cleanup. The implementation uses native buttons and responsive CSS; no external UI library is required.

```powershell
node --test tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

The API reads real rows at runtime. Empty collections render as empty states and absent financial aggregates as unavailable; no positions, trades, decisions, or chart snapshots are synthesized. Mobile layout is implemented with mobile-first CSS. Project setup tests verify that all page brands use the same icon, link to Dashboard, and reset internal navigation to the top on the destination page. Dashboard tests verify that additional summary metrics are collapsed after Win Rate. Automated tests validate dashboard behavior, but physical iOS/Android device testing and live Supabase smoke tests require a configured deployment and were not performed by the test suite.

## Phase 05 Agent Status visualization validation

The Node.js test runner covers normalized status mapping, unknown states, a detailed SVG circuit composition with routed traces, vias, component packages and board markings, accessible status labels, lifecycle cleanup, and status-specific signal density, color, and speed. Dashboard tests cover initial and polled status application, recovery after a transient visualization initialization failure, the static neutral state for UNKNOWN/STOPPED, the responsive full-width Agent Status panel, and reduced-motion behavior. The native SVG renderer requires neither WebGL nor a third-party graphics library; the visualization reads the existing agent-status flow and does not change agent or trading logic.

The browser markup includes the circuit renderer before the dashboard controller and needs no external visualization CDN. The protected Vercel route still requires an authenticated session; an unauthenticated browser is redirected to login, so local unit tests do not claim a live Supabase session.

```powershell
node --test tests/agent-brain.test.js tests/agent-status.test.js tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

The SVG overlay is rendered once over the green circuit-board image and uses the existing 15-second agent-status refresh to switch activity groups. The static artwork is shown at 58% opacity; larger signal cores, full-opacity green halos, and stronger ANALYZING glows improve contrast, while ERROR keeps a red halo. ACTIVE displays 12 green signals, ANALYZING 24 brighter, faster green signals, IDLE two dim green signals, ERROR six red signals, and STOPPED/UNKNOWN none. Sixteen motion routes begin at chip pins and follow horizontal or vertical circuit traces in all four directions. A luminance mask derived from the frame-free artwork prevents signal dots and glow from appearing between traces; opacity fades toward route ends. Tests verify the mask, route directions, route count, artwork dimensions, glow contrast, and fade animation. The square board fills the available mobile width and is bounded by 90vh; `prefers-reduced-motion` hides all moving signal groups while retaining the artwork and accessible status label. No WebGL renderer or animation-frame loop is used; physical-device visual checks remain a separate deployment validation.

## Phase 06 Bitvavo market-data validation

Market-data tests use mocked public Bitvavo responses and mocked PostgREST calls. They verify ticker and candle parsing/persistence, invalid configured market logging and non-insertion, empty provider responses, timeouts, rate limits, offline fallbacks, storage failures, scanner-event writes, 60-second catalog/ticker/candle caching, authenticated market/summary endpoints, query validation, and the cron-secret guard. Scheduled snapshot tests assert `/api/market-refresh` performs no candle requests or writes. Candle-job tests cover authorization, interval and batch validation, deterministic five-market batch selection, one-interval processing, bounded concurrency, cache-limit upgrades, incremental latest-timestamp queries and range limits, up-to-date skipping, partial failures, provider/storage failure states, and separate runtime metrics. Dashboard tests verify stored market snapshots and counts. No private Bitvavo endpoint or API key is used.

```powershell
node --test tests/market-data.test.mjs tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

`npm run build` additionally validates the market endpoints, shared market-data service, and server-only environment template without requiring a Vercel Cron configuration. Project tests verify both scheduled endpoints remain available when Vercel Cron is absent. Automated tests use controlled fixtures and do not claim live-provider or deployment success. A live Bitvavo/Supabase smoke test requires deployment environment variables and a configured Supabase project.

## Phase 07 AI engine validation

AI engine tests use deterministic candle/snapshot fixtures and a mocked PostgREST boundary. They cover bullish/bearish/neutral decisions; EMA, RSI, MACD, momentum, volume, and volatility indicators; confidence bounds and reduced confidence for partial inputs; missing/stale market data; invalid candle handling; database decision inserts and status PATCH updates; STOPPED and empty-market behavior; database failures; scheduler authorization/configuration; and generic endpoint failures. Existing dashboard tests verify persisted decisions remain present in the authenticated dashboard response and are rendered as recent decisions.

```powershell
node --test tests/ai-engine.test.mjs tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

The AI Engine regression suite simulates the PostgREST 1,000-row response cap and verifies that all six supported intervals remain available when each interval has hundreds of stored candles. It also verifies the interval-aware result is persisted in the decision indicators.

The AI engine reads only persisted market snapshots/candles and writes only AI decisions and agent status. The tests do not call live Supabase, Bitvavo, or an external scheduler. No trading, order execution, portfolio mutation, or paper-trading behavior is implemented or tested in this phase.

---

# Testing Types

## Unit Testing

Validate:

- Indicator calculations
- AI Engine logic
- Risk Manager logic
- Portfolio calculations
- PnL calculations
- Fees and slippage calculations

---

## Integration Testing

Validate:

- Supabase connectivity
- Authentication
- Database access
- Realtime subscriptions
- Bitvavo integration

---

## API Testing

Validate:

- Success responses
- Invalid requests
- Missing parameters
- Error responses
- Timeouts

---

## UI Testing

Validate:

- Dashboard
- Portfolio
- Market Scanner
- Trade History
- Settings
- Agent Brain

---

## Mobile Testing

Validate:

- iPhone
- Android
- Tablet

---

## AI Testing

Validate:

- BUY decisions
- SELL decisions
- HOLD decisions
- WAIT decisions

Validate confidence calculations.

---

## Risk Management Testing

Validate:

- Maximum Position Size
- Maximum Open Positions
- Drawdown limits
- Emergency Stop
- Cooldown rules

---

## Paper Trading Testing

Validate:

- Paper Buy
- Paper Sell
- Position Closing
- Portfolio Updates
- Fee Calculations
- Slippage Calculations

---

## Phase 08 automated coverage

The Phase 08 PGlite suite executes the schema, seed, and paper-trading migrations and verifies profile-triggered €10,000 portfolio provisioning, service-role-only RPC access, decision-to-trade links, a real stored-decision BUY/SELL cycle, fee/slippage arithmetic, the 10% entry cap, insufficient funds, five-position limits, minimum entry confidence, HOLD/WAIT behavior, unique retry protection, per-market cooldown, live portfolio valuation, daily and maximum drawdown gates, and emergency-stop state changes.

The scheduler/API tests verify POST-only handling, timing-safe cron authorization, mandatory `ENABLE_LIVE_TRADING=false`, server-only service-role use, no-store RPC requests, malformed/provider failure handling, metrics, and that paper execution calls only Supabase rather than an exchange endpoint. Portfolio UI tests verify real summary/position/trade rendering, safe text insertion, response validation, and authenticated no-store reads.

`tests/admin.test.js` verifies allowlist-based Admin page access, hidden-by-default Admin navigation, non-admin denial, action requests, duplicate-action prevention, and progress/error states. Authentication and project-setup tests cover the protected Admin route and its navigation placement.

```powershell
node --test tests/database-migrations.test.js tests/paper-trading.test.mjs tests/portfolio.test.js tests/dashboard.test.js
node --test tests/admin.test.js
npm.cmd test
npm.cmd run build
```

These are local embedded-database and mocked HTTP tests. They do not prove a remote Supabase migration was applied, a Vercel deployment succeeded, or cron-job.org has been configured.

## Phase 09 Market Scanner coverage

Scanner unit tests verify 24h/7d/30d gainer and loser ordering, estimated EUR volume, timeframe-specific momentum, latest-decision AI opportunity ranking and required fields, active-market and freshness filtering, empty inputs, and 1,500-market ranking bounds. Market-data service tests exercise Range pagination for both candle history and AI decisions, including markets/decisions beyond the first PostgREST page. UI tests verify the existing no-store market-summary endpoint, malformed/unauthenticated response handling, timeframe selection, safe text rendering, and duplicate-request coalescing. Dashboard tests verify that scanner ranking markup and requests are absent while the watched-market list remains; the five rankings are displayed only on the dedicated Scanner page.

```powershell
node --test tests/market-scanner.test.mjs tests/market-scanner-ui.test.js tests/market-data.test.mjs tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

These tests use deterministic stored-data fixtures and mocked Supabase requests. They do not verify a live database or deployment. The scanner uses the existing `/api/market-summary` function, so it does not increase Vercel's serverless function count.

## Phase 10 Trade History coverage

Trade-history API/UI tests cover symbol search, action and rolling-period filters, sorting, stable server-side pagination, clamping after history shrinks, empty results, million-row count behavior with a single bounded page, response validation, text-safe rendering, BUY realized-P&L handling, and the dashboard link. Static UI checks verify the filters are collapsed initially and the table gets a bounded vertical scrollbar with a sticky header. Price-formatting tests verify the supplied sub-€1 examples round to five decimal places, prices at/above €1 retain two decimals, and the shared formatter is used by dashboard, portfolio, and trade-history renderers. The PGlite migration test verifies the SQL aggregate calculations for profitable, losing, breakeven, and BUY rows, confirms user-scoped RLS results, and denies RPC execution to `anon`.

```powershell
node --test tests/trade-history.test.js tests/database-migrations.test.js
npm.cmd test
npm.cmd run build
```

The API tests mock PostgREST and the database integration runs in PGlite. These checks do not prove that the migration was applied to the configured remote Supabase project or validate a production deployment.

## Shared timestamp timezone coverage

The shared browser formatter pins timestamps to `Europe/Brussels` and relies on the runtime's IANA timezone data for daylight-saving changes. Tests cover winter and summer offsets, the spring DST transition, date rollover, invalid inputs, dashboard chart/trade/position/AI-decision timestamps, portfolio positions and trades, scanner snapshots and AI opportunities, and the trade-history date column. The API and database remain UTC; no timestamp writes or calculations are converted.

```powershell
node --test tests/price-formatting.test.js tests/dashboard.test.js tests/portfolio.test.js tests/market-scanner-ui.test.js tests/trade-history.test.js
npm.cmd test
npm.cmd run build
```

---

## Phase 11 Supabase Realtime coverage

Realtime-manager tests verify per-surface table selection, filtered scanner candle subscriptions, event-burst coalescing, reconnect status and catch-up refreshes, offline/online recovery, hidden-page pause and foreground refresh, multiple independent tabs, duplicate-subscription prevention, and channel/listener/timer cleanup. Database migration tests verify that the publication migration contains exactly the union of tables required by the UI surfaces and fails if the managed publication is missing. Existing UI tests continue to cover the authenticated refresh APIs and polling behavior.

```powershell
node --test tests/realtime.test.js tests/database-migrations.test.js
npm.cmd test
npm.cmd run build
```

These local tests use fake Supabase channels and PGlite for database behavior; they do not prove that the migration has been applied to a hosted Supabase project or that its live Realtime service is reachable. Apply the migration and smoke-test updates, reconnects, and offline recovery against the target deployment before marking Phase 11 production-complete.

---

## Phase 12 System Validation

The full validation review covers Authentication, Database, Bitvavo, Market Scanner, AI Engine, Agent Brain, Paper Trading, Realtime, and Dashboard. It combines implementation inspection, existing unit/API/UI tests, PGlite migration and transaction tests, static/database build validation, and review of recorded production findings.

```powershell
npm.cmd test
npm.cmd run build
```

In this validation run, `npm.cmd test` passed 169 tests with 0 failures, and `npm.cmd run build` passed static project validation plus migration validation for 16 prefixed tables, RLS coverage, and initial seed consistency. The `api/` directory contains 12 function files.

Automated tests use fakes, fixtures, mocked HTTP/PostgREST responses, or local PGlite where documented above. They do not prove live Supabase Auth/database/Realtime behavior, a Vercel deployment, Bitvavo availability, or external scheduler configuration. The hosted Realtime publication migration and production smoke tests remain pending. See [the Phase 12 system validation report](reports/PHASE_12_SYSTEM_VALIDATION_REPORT.md) for per-component ratings, production findings, risks, and recommendations. Phase 13 has not started.

---

## Exports module coverage

Export-service tests cover all four datasets and CSV headers, row mapping, EUR amounts, date cutoffs, empty datasets, formula-safe CSV escaping, and a 1,201-row trade export spanning three 500-row Supabase pages. Route tests verify that count and streamed-download modes use the existing authenticated `/api/dashboard-data` function. UI tests cover type/period selection, count and empty states, failure messages, protected English page/navigation, and same-origin download URLs.

```powershell
node --test tests/exports.test.mjs tests/exports-ui.test.js
npm.cmd test
npm.cmd run build
```

Supabase requests are mocked; these checks do not prove remote RLS configuration, production streaming behavior, or a Vercel deployment. The export path adds no API function or database migration.

---

## Phase 13 Analytics validation

Analytics tests cover SELL-based win/loss and breakeven handling, signed average loss, realized/unrealized/total P&L, profit factor, paired-trade hold time, confidence-range boundaries including 100, BUY/SELL/HOLD attribution, strategy and symbol grouping, period-scoped portfolio growth/drawdown and daily/weekly/monthly performance, empty data, invalid ranges, and query diagnostics for all five source datasets. AI-decision pagination regressions cover 0, 1, 723, 999, 1000, 1001, and 19,380 rows, and verify that HTTP 416 ends that stream without processing later prefetched ranges. Other failure tests assert exact PostgREST query, HTTP status, Supabase message/details, and development-only response diagnostics while production responses remain generic. A generated large-history test processes 100,001 AI decisions, 100,001 snapshots, and 10,001 trades through 500-row pages with a maximum of four prefetched pages per source. Export tests validate all four Analytics CSV types and ensure counts and downloads follow the selected 30/90/365-day range through the existing authenticated dashboard-data route. UI tests verify loading/empty/error states, rendered metrics, range requests, and shared count requests.

```powershell
node --test tests/analytics.test.mjs tests/analytics-ui.test.js tests/exports.test.mjs tests/exports-ui.test.js tests/project-setup.test.js tests/auth.test.js
npm.cmd test
npm.cmd run build
```

The original Phase 13 validation run passed 196 tests. After the production-loading follow-up, `npm.cmd test` passed 202 tests; after the pagination fix, the suite passed 206 tests with 0 failures and `npm.cmd run build` passed static project and database migration validation. The `api/` directory contains 12 deployable `.mjs` function files (and a non-function README). Tests use mocked Supabase/PostgREST responses; they do not prove hosted database correctness, Vercel deployment behavior, or production request latency. The Analytics page and reports default to 30 days and support 90 and 365 days; page reads are bounded and concurrent, but processing a very large 365-day window can still take time. See [the production fix report](reports/PHASE_13_ANALYTICS_PRODUCTION_FIX_REPORT.md) and [the pagination fix report](reports/ANALYTICS_PAGINATION_FIX_REPORT.md) for coverage and outstanding deployment checks. Phase 14 UX polish is now in progress; device-level and full release checks remain open.

## Phase 14 targeted UX coverage

Agent Status visual tests verify the detailed routed circuit, vias, component packages, status-specific green signal counts, and that no decorative text is rendered. Dashboard tests verify that the summary metrics after Win Rate are collapsed by default. Project setup tests cover the green brand icon and browser theme color on every page, the shared soft green-to-dark page background behind unchanged card surfaces, Dashboard links, scroll-to-top behavior after internal navigation, and the absence of a fixed global minimum width that would cause narrow-screen overflow. Trade History UI checks verify collapsed search/filter controls and a bounded scroll area with a sticky table header. Analytics UI tests verify every report table has an accessible caption and explicit column-header scopes.

```powershell
node --test tests/agent-brain.test.js tests/analytics-ui.test.js tests/dashboard.test.js tests/project-setup.test.js tests/trade-history.test.js
npm.cmd test
npm.cmd run build
```

In the final-polish audit, `npm.cmd test` passed 212 tests with 0 failures, and `npm.cmd run build` passed static project and database migration validation. A local Chromium viewport sweep covered all 12 pages at 320px, 768px, and 1280px; no horizontal overflow remained after the layout fix. The mobile navigation menu also fit within the 320px viewport. The API directory remains at 12 deployable `.mjs` functions.

The browser sweep used a local static server with authentication scripts blocked; it validates rendered layout, not authenticated API behavior or live data. These checks do not replace physical iPhone/Android/desktop tests, Chrome/Edge/Safari coverage, Lighthouse, hosted Realtime checks, or production smoke tests.

---

## Phase 15 AI Recommendations coverage

Recommendation tests cover the five advisory categories, 30/90/365-day selection through the existing Analytics loader, 10/50/100 distinct-trade confidence tiers, confidence-bucket comparisons, symbol and strategy performance, portfolio realized losses, drawdown evidence, empty and insufficient data, large aggregated inputs, EUR supporting metrics, and non-forecast impact descriptions. API/export tests verify the existing authenticated `dashboard-data` view and CSV count/stream paths, including recomputed Recommendation History exports. UI tests cover safe rendering, empty/loading/error/auth behavior, selected-range refresh, Realtime refresh, 30-second fallback polling, protected navigation, and the explicit no-mutation boundary. Realtime tests verify subscriptions to the five existing Analytics source tables.

```powershell
node --test tests/recommendations.test.mjs tests/recommendations-ui.test.js tests/analytics.test.mjs tests/exports.test.mjs tests/exports-ui.test.js tests/realtime.test.js tests/auth.test.js tests/project-setup.test.js
npm.cmd test
npm.cmd run build
```

Recommendation History is generated from current stored Analytics inputs and does not archive earlier generations. These tests use local fixtures and mocked Supabase requests; hosted Supabase, deployed Vercel, and live Realtime behavior require separate production smoke testing. No migration or Vercel Function is introduced.

Phase 15 validation result: `npm.cmd test` passed 226 tests with 0 failures; `npm.cmd run build` passed static project and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency). The API directory remains at 12 deployable `.mjs` functions.

---

## Regression Testing

Every completed phase must be followed by regression testing.

New functionality may not break existing functionality.

---

# Test Reporting

Every phase report must contain:

- Implemented
- Files Changed
- Tests Executed
- Test Results
- Build Status
- Documentation Updated
- Outstanding Issues
- Acceptance Criteria Status