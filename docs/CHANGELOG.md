# Changelog

All notable project changes should be documented here.

---

## [Unreleased]

### Added

- Shared `Europe/Brussels` timestamp formatting across dashboard, AI decision and agent logs, paper-trading and portfolio activity, scanner, and trade history; UTC storage and API values remain unchanged
- Accessible, keyboard-operable explanations for all 12 dashboard portfolio KPIs, with responsive popovers and outside-click dismissal
- Phase 10 trade history with authenticated server-side search, action/time filters, allowlisted sorting, stable 25-row pagination, and actual stored-trade statistics
- SECURITY INVOKER trade-history aggregate RPC, RLS/grant coverage, responsive history page, dashboard link, regression tests, and Phase 10 completion report
- Production-safe market-summary storage failure logs now include query, table, operation, page/range, HTTP status, Supabase code, and failure category without logging credentials, request data, or response bodies
- Temporary development-only market-summary read diagnostics identify the failed query and classify RLS/permission, schema, malformed-response, network, and database failures; production error responses remain generic
- Phase 09 market scanner rankings for gainers, losers, estimated quote volume, momentum, and recent stored AI opportunities across 24h, 7d, and 30d
- Scanner ranking and API pagination regression tests for empty and large datasets, plus responsive scanner UI and dashboard preview using the existing market-summary endpoint
- Phase 09 completion report documenting ranking methodology, data sources, function-count verification, and limitations
- Server-authorized dashboard Admin Actions for on-demand AI analysis and paper trading, using a Supabase user-ID allowlist and preserving existing engine and risk checks
- Admin authorization and dashboard execution-state tests, a server-only `ADMIN_USER_IDS` environment setting, and the dashboard Admin Actions report
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
### Security