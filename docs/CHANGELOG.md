# Changelog

All notable project changes should be documented here.

---

## [Unreleased]

### Purple Visual Theme

- Recolored the Bitcoin-in-hands app icon with a purple background while preserving its coin-and-circuit artwork, and applied a subdued purple application theme including chart accents and browser theme colors
- Removed decorative labels from the Agent Status circuit and increased the vivid purple glow and signal density for `ANALYZING`; all signal activity remains driven by the existing agent status
- Expanded the square circuit artwork to fill available mobile width, bounded by 90vh; neuron routes now start at the chip edge, move in multiple directions, and remain clipped inside the board border
- Preserved red error signaling, static `STOPPED`/`UNKNOWN` states, reduced-motion behavior, and all trading logic

### Phase 15 - AI Recommendations

- Added a protected advisory-only recommendations page covering AI performance, market selection, portfolio management, risk management, and strategy quality from existing Analytics outcomes
- Added 30-, 90-, and 365-day analysis ranges, sample-size confidence tiers, supporting metrics, period/generated timestamps, and explicit insufficient-data behavior
- Added automatic refresh on source-table Realtime events with a 30-second polling fallback; no trading or configuration changes are performed
- Added Recommendation and Recommendation History CSV exports through existing Analytics Exports and the authenticated dashboard-data function; history exports are recomputed and no generations are archived
- Added recommendations to protected navigation and route guards without adding a Vercel Function, database table, or migration
- Added recommendations generation, evidence thresholds, export, UI, authentication, Realtime, and large aggregated-input regression coverage
- Documented the Phase 15 scope and deferred Backtesting Engine to Phase 16; Phase 16 work has not started

### Validation

- Phase 15 AI Recommendations passed all 227 automated tests and static/database build validation; the Vercel API count remains at 12. Recommendation confidence now uses distinct closed-trade evidence rather than scored decision count. Hosted deployment and Realtime behavior remain unverified.
- Completed the Phase 12 system audit and generated `reports/PHASE_12_SYSTEM_VALIDATION_REPORT.md`; `npm.cmd test` passed 169 tests and `npm.cmd run build` passed static/database validation
- Recorded a 50% production-readiness score (WARNING), the six known production findings, and the hosted Supabase, Realtime, provider, and external-scheduler checks still outstanding; verified the API function count remains 12
- Corrected stale Dashboard/scanner documentation and Known Issues status to match current behavior and implementation
- Phase 14 final-polish audit passed 212 tests and static/database build validation. All 12 pages were checked in Chromium at 320px, 768px, and 1280px with no remaining horizontal overflow; Lighthouse, supported-browser, physical-device, and production checks remain open. The API remains at 12 functions.
- Analytics production-loading follow-up passed all 202 automated tests and static/database build validation; hosted Supabase/Vercel behavior remains unverified

### Fixed

- Replaced the anatomical Agent Brain with a detailed responsive SVG circuit board; moving signal density, color, and speed follow the live agent status, while reduced-motion users see a static board
- Brought the Agent Brain hemispheres closer while retaining the outer silhouette; increased `ANALYZING` highlights from 52 to 104 fluorescent-green neurons that travel neural connections with a brighter additive glow
- Tuned the status-specific `ANALYZING` effect to 80 moving green neurons with a smaller, softer glow; other Agent Status visuals remain unchanged
- Added a standalone web app manifest and linked it from every page; internal navigation remains same-window, while iOS browser chrome remains OS-controlled
- Parallelized and slightly thickened the Agent Brain's right-side circuit tracks, keeping them clear of the top frame without changing status logic
- Added more pronounced angled elbows and subtle outward fanning to the right-side Agent Brain circuit traces, matching the supplied reference while preserving lane separation and status behavior
- Matched the Agent Brain more closely to the reference with a narrower, brighter cortical outline and gyri, a cyan binary-glyph field, and a subtle hex-grid backdrop; reattached all left input waves and seven right-side traces to the contour, with stronger upward elbows and regression checks for contact, spacing, and top clearance
- Removed the fixed 320px minimum body width after the narrow-screen browser audit exposed horizontal overflow at 320px; all audited pages now fit the tested viewports
- Added accessible captions and explicit `scope="col"` semantics to all seven Analytics tables, with a regression test
- Collapsed dashboard metrics after Win Rate and Trade History search/filter controls by default; added a bounded scroll area with a sticky header to the trade table
- Reset internal navigation destinations to the top on mobile, while leaving browser back/forward restoration intact
- Analytics AI-decision pagination now treats HTTP `416` as end-of-results, ignores later prefetched ranges, and covers the requested empty, page-boundary, and 19,380-row regressions
- Phase 13 Analytics now defaults to a 30-day history window and supports 90- and 365-day ranges for historical trades, AI decisions, and snapshots; current positions and account totals remain current-state metrics
- Bounded Analytics reads with exact RLS-visible counts and up to four concurrent 500-row pages per source, avoiding full all-history decision scans and detecting truncated pages
- Added temporary Analytics/Analytics Export diagnostics that log the exact failing dataset, request query, response status, and Supabase error fields. Development responses include diagnostics; production responses remain generic.
- Analytics CSV reports use the selected period through the existing dashboard-data function, without adding an API function or database object

### Added

- Added a dark-green 180×180 Apple Touch Icon and the AI Crypto Bot brand mark across all pages; every brand link opens Dashboard.
- Phase 13 protected Analytics page with trade, AI-decision, strategy, symbol, portfolio-growth, equity-curve, and drawdown insights calculated from existing RLS-scoped tables
- Four Analytics CSV reports integrated into Exports and the existing authenticated dashboard-data function; paginated source reads, bounded portfolio series, regression coverage, and no new tables or Vercel Functions
- Protected Exports page for CSV downloads of trades, portfolio snapshots, AI decisions, and positions, with date filters, exact counts, and streamed 500-row pages using the existing authenticated dashboard-data function
- CSV export tests for all datasets, date filters, empty and large result sets, formula-safe content, API streaming, and UI loading/empty/error/download states; no new API function or schema migration
- Removed the dashboard Market Scanner preview and the “Database history” / “Supabase snapshots” labels; scanner rankings remain on the dedicated Scanner page
- Moved Admin Actions from the dashboard to a separate protected Admin page, reusing server-side allowlist authorization and the existing action API
- Phase 11 Supabase Realtime subscriptions for dashboard, portfolio, trade history, and scanner, with debounced refreshes through existing APIs, reconnect/offline handling, polling fallback, cleanup, and no new Vercel Functions
- Supabase Realtime publication migration and regression tests for table selection, event coalescing, reconnects, offline recovery, multiple tabs, visibility, and cleanup
- Shared `Europe/Brussels` timestamp formatting across dashboard, AI decision and agent logs, paper-trading and portfolio activity, scanner, and trade history; UTC storage and API values remain unchanged
- Accessible, keyboard-operable explanations for all 12 dashboard portfolio KPIs, with responsive popovers and outside-click dismissal
- Phase 10 trade history with authenticated server-side search, action/time filters, allowlisted sorting, stable 25-row pagination, and actual stored-trade statistics
- SECURITY INVOKER trade-history aggregate RPC, RLS/grant coverage, responsive history page, dashboard link, regression tests, and Phase 10 completion report
- Production-safe market-summary storage failure logs now include query, table, operation, page/range, HTTP status, Supabase code, and failure category without logging credentials, request data, or response bodies
- Temporary development-only market-summary read diagnostics identify the failed query and classify RLS/permission, schema, malformed-response, network, and database failures; production error responses remain generic
- Phase 09 market scanner rankings for gainers, losers, estimated quote volume, momentum, and recent stored AI opportunities across 24h, 7d, and 30d
- Scanner ranking and API pagination regression tests for empty and large datasets, plus responsive scanner UI using the existing market-summary endpoint
- Phase 09 completion report documenting ranking methodology, data sources, function-count verification, and limitations
- Server-authorized Admin Actions for on-demand AI analysis and paper trading, using a Supabase user-ID allowlist and preserving existing engine and risk checks
- Admin authorization and execution-state tests, a server-only `ADMIN_USER_IDS` environment setting, and the Admin Actions report
- Phase 08 transactional paper-trading engine using persisted AI decisions and stored market data only, with service-role-only database execution, unique decision-linked trade records, portfolio valuation, and scheduler metrics
- Per-profile €10,000 simulated starting portfolios, paper positions/trades/snapshots, 0.25% fees, 0.10% adverse slippage, and database-enforced position, confidence, cooldown, funds, drawdown, and emergency-stop rules
- Authenticated portfolio summary page and dashboard realized/unrealized P&L values sourced from bounded, RLS-protected database reads
- Phase 08 database migration, PGlite risk/execution regression tests, scheduler/API tests, portfolio UI tests, documentation, and completion report
- Phase 07 AI candle retrieval now queries each supported interval independently with a bounded per-interval limit, preventing PostgREST's global response cap from starving later intervals
- Phase 06 separate market-snapshot and candle-refresh jobs; authenticated candle batches process one interval and up to five markets with incremental reads, metrics, and existing-schema upserts
- Phase 06 incremental candle refresh using latest stored timestamps, due-interval scheduling, bounded range requests, batch latest-candle reads, and market/candle runtime metrics
- Phase 06 bounded scheduled candle refresh across all six supported intervals for enabled, Bitvavo-valid watched markets, with bounded concurrency, limit-aware cached upserts, provider/storage circuit breakers, explicit partial results, and regression coverage
- Phase 07 deterministic AI analysis service and scheduler-protected endpoint, using existing market/candle/decision/status tables only
- Confidence-scored BUY/SELL/HOLD/WAIT decisions, missing-data fallbacks, status transitions, and regression tests
- Phase 07 API, architecture, database, scheduling, testing, README, roadmap, and completion documentation
- Phase 06 deployment fix: allow external schedulers for market refresh on Vercel Hobby without a Vercel Cron declaration
- Phase 06 public Bitvavo market catalog, ticker, and candle service backed by existing market tables
- Authenticated market and market-summary APIs, non-destructive watched-market sync, scanner-event logging, and scheduled refresh endpoint
- Dashboard market-data count and watched-market price / 24-hour change details
- Bitvavo provider, database persistence, cache, failure-fallback, API, and dashboard regression tests
- Phase 06 Bitvavo market-data completion report
- Phase 04 authenticated read-only dashboard endpoint and database-backed summaries for agent status, emergency state, portfolio, positions, trades, watched markets, and AI decisions
- Responsive dashboard KPI cards, actual-snapshot Chart.js history, and safe empty/error states
- Dashboard API and rendering tests plus Phase 04 completion report
- Three.js Agent Brain visualization mapped to the live `AI_Crypto_Bot_Status.status` value
- Authenticated status polling endpoint with UNKNOWN fallback, hidden-tab pause, bounded rendering, and explicit GPU-resource disposal
- Agent Brain status-mapping, API, dashboard integration, fallback, rendering, and performance tests plus Phase 05 completion report
- Network-first Agent Brain silhouette with 720 nodes, up to 2160 dynamically pulsing links, flowing energy particles, and WebGL-context-aware fallback behavior
- Phase 05 brain improvement report and geometry, signal-flow, and fallback-recovery regression tests
- Final Phase 05 visual redesign report documenting the contour-led brain and browser validation
- Phase 03 Supabase migrations for all 16 prefixed application tables, relationships, indexes, Auth profile synchronization, RLS, duplicate-safe trade/strategy-change keys, and initial seeds
- Central default market list in `config/markets.js` with automated migration-seed parity validation
- PGlite database integration tests for migration execution, Auth profile provisioning, RLS ownership, role grants, seed idempotency, and constraints
- Phase 03 database completion report
- Phase 01 static project structure and six placeholder pages
- Shared responsive CSS and small browser navigation script
- Node.js built-in test setup and static project validation command
- Vercel static hosting configuration and Phase 01 completion report
- Supabase registration, login, logout, and password recovery flows
- Persistent client sessions and HttpOnly session cookie verification
- Server-protected page rewrites and authentication route tests
- Phase 02 completion report
- Initial project documentation
- AGENTS.md
- README.md
- ROADMAP.md
- Architecture documentation
- Database documentation
- API documentation
- Risk management documentation
- Deployment documentation
- Testing documentation

### Changed

- Move the Risk control / Emergency State panel to the bottom of the Dashboard, expand Agent Status and its brain canvas to full width, and add an automatically refreshed backend signal strip with status-driven animation
- Add visible neuron nodes and status-driven traveling cyan signals along the left and right brain traces; the 52 additional green neurons remain exclusive to `ANALYZING`
- Add a Trade Value breakdown to Trade History and Portfolio trade details: BUY invested amount, fees, and total cost; SELL gross proceeds, fees, net proceeds, and realized P&L
- Refine the Agent Brain toward the supplied visual reference with blue input waves, right-side circuit traces, and 52 green neuron highlights shown only during `ANALYZING`; status sourcing and agent logic remain unchanged
- Reuse stored execution price, quantity, fees, and realized P&L with shared EUR presentation formatters; no trading logic, database calculations, API endpoints, or Vercel Functions changed
- Standardize the trade status label to `Executed · Paper Trade` and use `Execution` terminology on Portfolio and Trade History
- Standardize all user-facing interface copy, accessibility labels, authentication feedback, loading and error states, and financial number formatting in English
- Keep the dashboard limited to portfolio and agent summaries; show watched-market symbols and priorities without scanner rankings, prices, or scanner-data requests
- Standardize protected and public navigation labels, paper-trading descriptions, and trade-execution terminology across all pages
- Convert all static dashboard interface copy to English
- Format EUR prices below €1 with up to five decimal places in position and trade views; prices from €1 use two decimals, while fees, P&L, and portfolio totals retain existing formatting
- Replace the history placeholder with an auto-refreshing, responsive paper-trade ledger; BUY rows show unrealized P&L as unavailable, while all-time statistics use stored SELL realized P&L
- Replace the scanner placeholder with timeframe-filtered rankings refreshed from stored market data; keep the existing `/api/market-summary` endpoint and Vercel function count unchanged
- Replace the fixed header navigation links with a keyboard-accessible dropdown menu across public and protected pages
- Refresh complete authenticated dashboard data every 30 seconds while visible and immediately when returning to the foreground; retain no-store requests and coalesce concurrent loads
- Increase Agent Brain active-neuron halo strength and extend the taller silhouette slightly downward
- Remove the visible dashboard title/subtitle and redundant Agent Status descriptions while retaining the paper-mode notice, accessible page heading, and status visualization
- Replace the diffuse node-cloud layout with a front-facing bilateral cortical contour, pronounced center fissure, curved gyri, branching neural paths, and radial neuron halos; both hemispheres share one status color
- Remove the external circuit traces from either side of the Agent Brain while keeping the neural contour and activity unchanged
- Remove every brain surface mesh, translucent shell, inner volume, and separate fissure line; define the bilateral silhouette solely with status-colored nodes, local connections, bright hotspots, and traveling energy particles
- Refine Agent Brain activity so 720 neurons pulse independently, up to 48 signals travel across the connected network, and inactive connections stay subtle until a signal passes
- Slightly increase both Agent Brain hemispheres' vertical proportions while keeping the lower edge anchored
- Increase the Agent Brain's vertical proportions by a further 10 percentage points (approximately 16% total) and preserve its lower-edge alignment
- Replace the single cloud-like Agent Brain surface and external aura with a recognizable bilateral brain silhouette, central fissure, restrained lower structures, internal status-colored network, and a subdued stage background
- Historical visual iteration: temporarily used a semi-solid brain volume and layered additive glow; superseded by the current shell-free, contour-led network

### Fixed

- Treat PostgREST `416/PGRST103` on a generated subsequent scanner page as an empty end-of-pagination page instead of failing the market summary
- Keep the Agent Brain fallback hidden whenever its renderer is available, clear stale failed initialization state, and retry after transient renderer failures
- Prevent anonymous auth pages from sending an empty session to `/api/auth-session` by unwrapping Supabase `getSession()` results and checking for an access token before cookie synchronization
- Bind logout controls during auth initialization on protected pages so logout signs out, clears the server cookie, and redirects to login
- Keep password-change fields hidden until a recovery session is detected; preserve the hidden state against auth-card form styling
- Always pass `/reset-password.html` as the password reset email redirect target

---

## Future Releases

Each completed phase should add:

### Added
### Changed
### Fixed
### Removed

- Remove dashboard Market Scanner data requests and market-data ranking details; the dedicated Scanner page remains the only location for all five scanner rankings

### Security