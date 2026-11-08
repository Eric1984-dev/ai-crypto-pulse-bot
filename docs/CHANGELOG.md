# Changelog

All notable project changes should be documented here.

---

## [Unreleased]

### Manual AI decision archive POC

- Add a manually invoked Raspberry Pi pull CLI that copies only `AI_Crypto_Bot_AI_Decisions` into the existing archive database
- Allow source preflight to accept read-only `SELECT` on multiple prefixed application relations while rejecting non-prefixed relations, source writes, and ownership
- Validate archive decision primary/foreign-key structure through catalog columns, target relation identity, validation status, and delete action instead of formatted constraint text
- Record the user-confirmed application and verification of the Supabase decision-reader migration and login; keep the Pi-local writer separate
- Validate the one Supabase-managed `postgres` membership edge (grantor `supabase_admin`, ADMIN enabled, INHERIT and SET disabled) and reject every other decision-reader membership
- Document that the archive CLI does not inspect `pg_auth_members`; migration postflight and read-only operator validation check the managed edge
- Scope migration relation/column/sequence privilege checks to schemas where the reader has effective `USAGE`, while rejecting `USAGE` outside `public` without changing `PUBLIC` grants
- Record the accepted Supabase `PUBLIC` temporary-object and large-object capability residual for direct PostgreSQL login; do not revoke shared PUBLIC grants
- Require verified TLS, a separate restricted archive writer, exact schema/identity/RLS checks, and pre-existing watched-market anchors
- Add a Pi-local writer-role SQL proposal with fail-closed schema, ownership, membership, effective-privilege, and grant-option checks; it remains unapplied and creates a NOLOGIN role without credentials
- Scope Pi writer relation and sequence checks to schemas with effective `USAGE`; keep rejecting extra privileges in `public` and add inaccessible-schema regressions
- Compare Pi archive decision columns by ordinal position and null-safe field equality; add local executable schema-contract regressions after the provisioning preflight failure
- Validate the archive decision primary and foreign keys through PostgreSQL catalogs and resolved relation OIDs, avoiding schema-qualification assumptions in constraint-definition text
- Preserve original IDs, `numeric(5,2)` confidence, JSONB indicators, and UTC timestamps using explicit columns and bounded keyset batches
- Add ID-based idempotent upserts, per-batch read-back validation, an atomic identity-bound checkpoint, overlap-based reruns, and an exclusive process lock
- Never modify or delete Supabase rows; never delete archive rows; do not add a schedule, API route, or database object
- Add Pi installation and validation guides for the manual copy-only CLI
- Record the user's report that the first manual sync successfully copied data to PostgreSQL on the Pi; exact row counts were not provided or independently verified
- Clarify that `archive-server/` runs on the Pi and is not deployed as a Vercel project or serverless function
- Exclude `/archive-server/` from Vercel deployment inputs with the root `.vercelignore`, while retaining the source in Git for Pi installation and updates
- Keep project validation passing in Vercel builds by skipping checks for the intentionally excluded Pi-only archive directory; retain those checks for local builds
- Remove superseded watched-market reader V1 role and standalone RLS SQL drafts; retain V2, which is used by the archive market-seed utility

### Archive Server monitoring

- Add an authenticated Archive Server dashboard card for server, PostgreSQL, database, disk usage, and database size
- Reuse the existing dashboard-data function with a bounded server-side health request and independent five-minute visible-page polling
- Render unavailable or invalid upstream health as Offline without showing a dashboard data error or affecting trading
- Add an isolated Raspberry Pi health service with bearer-token access and verified PostgreSQL TLS
- Show the last health-check timestamp and keep all database credentials on the Pi
- Document the HTTPS tunnel, environment variables, and `GET /api/health` contract

### Database AI analysis timeout headroom

- Give the database-analysis RPC a dedicated 10-second request timeout; keep all other AI-engine Supabase requests at 8 seconds
- Add regression coverage to ensure only the database-analysis RPC receives the longer timeout

### Shadow exit RPC timeout diagnostics

- Increase the bounded shadow-evaluation request timeout from 750 ms to 2.5 seconds
- Distinguish request timeouts from other Supabase transport failures in internal logs while keeping shadow failures non-blocking for paper trading
- Ignore the workspace-specific `.vscode/mcp.json` configuration file in Git

### Database AI analysis failure diagnostics

- Fix database-mode RPC authentication to use the service-role Bearer token and add a header regression assertion
- Include the failed database-analysis RPC HTTP status and a strictly validated SQLSTATE/PostgREST code in internal error logs
- For SQLSTATE `42501`, classify the permission-object type and log a target only when it matches the project's fixed object allowlist
- Never log the RPC error body, provider message, or request credentials; keep JavaScript as the default and database-mode failure closed
- Add regression tests for safe recognized/unrecognized error codes and allowlisted/unknown permission targets

### Opt-in database-side AI analysis prototype

- Add a service-role-only, additive PostgreSQL AI analysis function using the existing watched markets, snapshots, candles, and decision table
- Preserve JavaScript as the default `AI_ANALYSIS_MODE`; database mode is explicit opt-in and fails closed without JavaScript fallback
- Keep analysis bounded to 150 candles per market and interval across all six intervals, and return only aggregate counts through PostgREST
- Add PGlite exact-payload parity, rounding, input-boundary, privilege, and query-plan tests; no production migration or deployment was performed
- Use `Prefer: return=minimal` for JavaScript AI-decision inserts while preserving status-update representation validation

### Supabase response-size diagnostics

- Add per-invocation Supabase response metrics to the existing AI analysis and scheduled candle-refresh completion logs
- Group by HTTP method and pathname; report exposed `Content-Length` bytes and separately labeled re-serialized JSON body-size estimates
- Emit the summary as top-level JSON text in Vercel logs so endpoint details are visible; preserve the structured metrics in the candle-refresh HTTP response
- Exclude Bitvavo requests, query strings, headers, credentials, and response contents; do not persist metrics to Supabase or add endpoints
- Document that these diagnostics compare endpoint payloads but are not exact billed wire-byte attribution and do not cover other functions or browser-direct traffic

### Shadow exit dashboard guide

- Add a visible dashboard legend explaining fixed take-profit, trailing-stop, tracking/triggered states, and modeled net P&L assumptions
- Collapse each position's shadow scenarios by default while keeping its market and position status visible
- Keep all shadow outcomes simulation-only and separate from actual positions, trades, and portfolio metrics

### Bounded AI candle reads

- Replace paginated 1,000-row PostgREST candle reads with a service-role-only RPC that returns at most 150 latest candles per enabled market and interval
- Add `AI_Crypto_Bot_Get_Latest_AI_Candles_Compact` with per-symbol arrays of all six original values, reducing its PostgREST result to at most four top-level rows per interval while retaining the legacy function for staged rollout
- Preserve the six interval semantics, market order, freshness checks, indicator inputs, decisions, and existing AI-analysis endpoint
- Enforce uppercase enabled EUR symbols in SQL, validate RPC bounds and grants, and request exact PostgREST counts so incomplete responses fail closed
- Compare every candle field against the former REST selection across two markets and all six intervals; no API route or table was added
- Require confirmation that the intended production project's `max_rows` is at least 4 for the compact RPC; retain 600 for legacy callers. No production setting was verified or changed and the compact-response migration was not applied
- Compare legacy REST and RPC request/row counts on deterministic fixtures without claiming deployed egress savings

### Prospective shadow exit scenarios

- Add persistent, versioned, simulation-only fixed take-profit and trailing-stop scenarios for open paper positions
- Evaluate only fresh observed market marks; initialize tracking prospectively and finalize comparisons when an actual SELL closes a position
- Persist compact scenario state and append-only meaningful events using two prefixed, RLS-protected tables and a service-role-only evaluator
- Display hypothetical outcomes separately from actual P&L through the existing authenticated dashboard-data route
- Keep the actual AI SELL path, paper-trading executor, risk checks, portfolio state, endpoints, scheduler, and live-trading configuration unchanged

### Dashboard summary list scrolling

- Show two complete items in Open Positions, Activity, and Position Monitoring, with an internal scrollbar for additional items
- Keep all items rendered and reachable within each panel; remove the scroll limit when the list returns to two items or fewer

### Dashboard risk controls placement

- Place Emergency State / Risk Control beside Open Position AI Status in the dashboard summary grid
- Keep the panels side by side on wider screens and stacked on narrow screens without changing emergency-state behavior

### Dashboard market list placement

- Remove the watched-market list from the Dashboard while retaining its Tracked Markets KPI
- Show the complete prioritized active-market list on Market Scanner through the existing `/api/market-summary` endpoint
- Add UI and response-validation regression coverage without adding an API function or database schema

### AI candle history cap

- Retain each market's latest 150 candles per interval while keeping PostgREST request pages at 1,000 rows
- Preserve latest-candle selection, freshness checks, indicator and confidence formulas, decision rules, and scheduler behavior
- Add regression coverage for grouped pagination, latest-row selection, per-market cap enforcement, and freshness preservation

### Dashboard P&L clarity

- Rename the unrealized P&L KPI to “Open Positions Gain/Loss” and clarify that it is an estimate on positions still held, not realized profit or loss from a completed sale
- Update the KPI information button's accessible label and regression coverage

### Candle refresh checkpoint lookup

- Replace the capped historical-row scan and per-symbol fallback reads with a read-only RPC that returns each requested symbol's latest candle timestamp
- Restrict RPC execution to `service_role` and use the existing `(symbol, interval, timestamp)` index without changing refresh, overlap, freshness, or bootstrap behavior
- Add migration, RPC permission/result, history-depth, failure, and provider-range regression coverage

### Scheduled candle bulk upserts

- Combine validated candle rows from successful markets into one merge-duplicates upsert per scheduled refresh invocation
- Retry a failed bulk write independently per market so one persistent write failure does not block other markets
- Preserve forming-candle updates, per-market outcomes, and successful-row metrics; report bulk and fallback POST attempts
- Add regression coverage for partial provider failures, invalid candles, idempotent retry, market-level fallback failures, and aggregate metrics

### Open Position AI Status

- Show concise decision-aware AI commentary and signed EUR P&L with percentage return on each open-position status card
- Hide raw confidence and Market Strength values from the Dashboard cards while retaining them in the existing data response
- Keep the existing dashboard-data route, AI Decisions KPI, Realtime, polling, AI calculations, and trading behavior unchanged
- Add responsive status-card styling and tests for decision commentary, Market Strength boundaries, and positive/negative P&L formatting

### Phase 07 candle freshness protection

- Enforce per-interval maximum age for the latest candle and exclude stale intervals from technical analysis
- Store `WAIT` with reason `STALE_CANDLE_DATA` when fewer than two sufficiently populated fresh intervals remain
- Preserve historical indicator lookback candles when an interval's latest candle is fresh; keep snapshot freshness independent

### AI candle query batching

- Batch up to four markets per candle-interval request and paginate PostgREST responses while preserving each market's latest 1,000 candles
- Log actual candle REST request/page counts separately from logical market/interval reads
- Keep analysis calculations, decisions, database schema, API routes, and scheduler cadence unchanged

### Market display refinements

- Use the shared blue accent for market symbols across Dashboard, Portfolio, Trade History, Market Scanner, and Analytics
- Highlight fee labels and amounts in Portfolio and Trade History with the existing yellow warning tone
- Show positive P&L in green and negative P&L in red in position and activity details
- Use neutral gray Dashboard chart legend icons while preserving dataset line colors
- Use neutral gray Dashboard KPI info icons while retaining a visible blue keyboard-focus indicator
- Color BUY actions green and SELL actions red across trade, scanner, and Analytics displays
- Add a small gap between the AI Brain and live backend status

### Synchronized data refresh

- Broadcast Realtime data invalidations across open tabs and align Dashboard, Portfolio, and Trade History fallback polling to shared 30-second boundaries
- Refresh Portfolio on market-price changes and retain a follow-up refresh when an update arrives during an active request; P&L calculations remain unchanged

### iPhone home-screen icon

- Changed the shared 180×180 app icon background from dark green to deep blue while preserving the existing Bitcoin-and-hands artwork

### Dashboard overview spacing and counts

- Reduced the gap between the header and Overview
- Moved dashboard list counts next to their titles and displayed them in parentheses

### Charcoal visual theme and P&L tones

- Restyled the page background in neutral charcoal, with dark slate cards and blue accents
- Highlighted positive and negative financial values in green and red without changing labels or trading behavior
- Added a green activity strip with full local bot-run, market-data, and paper-trade timestamps; Analytics and Market Scan remain on-demand because their run history is not persisted
- Added soft blue glow accents to cards, the app icon, export controls, and Agent Status chip
- Replaced the green circuit board with blue AI-brain artwork inspired by the supplied reference; aligned all 32 animated routes and 24 pulsing pads to its visible traces, with signal fades just inside the artwork edges
- Recolored ACTIVE/ANALYZING/IDLE signals blue while retaining red ERROR and gray STOPPED/UNKNOWN states

### Paper-mode header and navigation

- Replaced the Dashboard's full-width paper-trading notice with a compact yellow PAPER MODE badge beside the app icon
- Removed redundant PAPER ACTIVE banners and auth-footer notices across app pages; the shared header remains the visible mode indicator
- Pinned Dashboard to the top of each application menu, separated the remaining alphabetically sorted links with a divider, and kept account actions at the bottom
- Added blue hover glows to menu links, closed the menu on outside click, and stacked it above sticky Analytics table headers
- Collapsed Dashboard Portfolio, Activity, Market universe, and Agent log panels by default

### Exports date filters

- Added independent 30-, 90-, and 365-day date selectors to each Performance and Recommendation report
- Removed the shared Analytics export date selector; each report count and CSV download now follows its own range
- Grouped core data exports separately from Analytics and Recommendation reports, with Trade and Position exports adjacent

### Agent Brain glow tuning

- Added a subtle static green glow around the chip in every status, retaining a brighter overlay during `ANALYZING`
- Increased neuron blur and halo strength across normal, analyzing, and error states while preserving their existing status colors and reduced-motion behavior

### Trade History and Dashboard trade visibility

- Enriched open BUY executions with the latest available market snapshot, current unrealized EUR P&L, and return percentage; SELL executions now show derived entry price and realized return percentage
- Expanded Dashboard Recent Trades with entry/exit prices, position P&L, timestamps, and OPEN/CLOSED status while retaining concise quantity formatting
- Preserved micro-priced asset precision and refreshed Trade History on Market Data Realtime updates
- Kept execution records, paper-trading logic, database calculations, API routes, and Vercel Function count unchanged

### AI Analysis logging optimization

- Replaced start and per-market informational events with one completion summary per successful run, including market and decision counts, candle reads, failed reads, runtime, and stage timings
- Preserved error/failure logs and all AI analysis behavior, persisted decisions, and database writes
- Added regression coverage for one summary per completed run, zero-market runs, decision counts, and retained failure logging

### Paper Trading confidence-threshold experiment

- Lowered the server-side paper BUY-entry confidence gate from 70 to 67 through a forward migration; all other Risk Manager checks remain in force
- Added migration-backed integration coverage for rejecting confidence 66 and accepting confidence 67
- Left AI decision generation, confidence calculations, Analytics, SELL execution, and live-trading behavior unchanged
- Documented the experiment and its 25-/50-closed-trade review checkpoints; production migration and deployment remain unverified

### AI Analysis runtime optimization

- Replaced sequential groups of eight candle reads with a bounded 24-worker queue, reducing wait barriers without changing candle filters, limits, or ordering
- Added runtime and stage timing telemetry to AI Analysis completion and failure logs
- Preserved all AI calculations, confidence, decision rules, persisted outputs, and existing API/function count
- Production verification on 2026-11-02 confirmed the first observed optimized run completed in 11.484 seconds, analyzed 102 markets, stored 102 decisions, and loaded 300,849 candles across 612 reads. All 102 stored decisions retained all six candle intervals, with no omitted symbols; sustained runtime and timeout rates remain under observation.

### Agent Brain refinement

- Increased the status-driven green chip glow during `ANALYZING`
- Reduced the circuit visualization to a 440px maximum width on desktop while preserving its full-width mobile layout
- Expanded signal routing from 16 to 32 PCB traces; `ANALYZING` now uses all 32 routes
- Extended neurons along longer trace-following paths, slowed `ANALYZING` signals, and delayed their fade until near the route end
- Added synchronized endpoint and mid-trace node glows so circuit dots light up during `ANALYZING`
- Kept each neuron on its assigned trace through crossings using route-specific SVG luminance masks
- Kept the glow static and transition-free for users who prefer reduced motion

### Green Visual Theme

- Restored the original green application palette across page surfaces, chart accents, browser theme colors, and the shared Bitcoin-in-hands app icon
- Recolored only the circuit artwork and status-driven neuron effects; preserved the chip shape, traces, layout, movement, and responsive sizing
- Reduced the circuit image opacity and strengthened neuron cores and status-specific glow so moving signals remain visible over the board
- Kept the frame-free square artwork responsive to available mobile width, bounded by 90vh, with status-driven signals fading at route ends
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
- Analytics pagination now treats a subsequent `416/PGRST103` range as end-of-results across datasets, including portfolio snapshots, while preserving earlier pages and ignoring later prefetched ranges; first-page failures remain errors
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
