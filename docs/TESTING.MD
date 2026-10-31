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

Dashboard tests use the Node.js built-in test runner with mocked Supabase PostgREST responses; they do not depend on credentials or create simulated trading records in the database. They cover verified-session requirements, forwarding the caller JWT and anon key, RLS-compatible data requests, summary calculations, error responses, rendering, text-safe list content, empty values, persisted-snapshot chart data, authentication readiness, retry behavior, and expired-session redirects.

```powershell
node --test tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

The API reads real rows at runtime. Empty collections render as empty states and absent financial aggregates as unavailable; no positions, trades, decisions, or chart snapshots are synthesized. Mobile layout is implemented with mobile-first CSS. Automated tests validate dashboard behavior, but physical iOS/Android device testing and live Supabase smoke tests require a configured deployment and were not performed by the test suite.

## Phase 05 Agent Brain validation

Agent Brain and status API tests use the Node.js test runner and deterministic fake Three.js/browser interfaces. They cover supported and unknown-state mapping, authenticated database status reads with the caller JWT, dashboard application of initial and polled status, fallback recovery after transient renderer initialization failure, fallback suppression while a renderer remains available, neutral fallback when WebGL/Three.js is unavailable, a front-facing bilateral contour and center fissure, approximately 16% taller proportions with a stable lower anchor across resize, curved neural folds and branching connections, absence of external line geometry and mesh/surface geometry, all 720 individually pulsing nodes, the 2160-connection cap, matching hemisphere color channels, independent neuron brightness, subdued inactive pathways, sparse signal-lit connections, routed neuron-to-neuron particle movement, status-specific activity density, stable orientation, renderer setup, pixel-ratio and 30 FPS caps, hidden-tab pause/resume, and renderer/geometry/material/listener disposal.

The browser smoke check loads the actual dashboard markup and pinned Three.js renderer with local API responses. The protected Vercel route still requires an authenticated session; an unauthenticated browser is redirected to login, so this smoke check does not claim a live Supabase session.

```powershell
node --test tests/agent-brain.test.js tests/agent-status.test.js tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

Rendering uses a pinned Three.js ES module loaded on demand. Each neuron has an independent per-vertex intensity; at most 48 deterministic routes advance signals through adjacent connections. Only the current signal segments and their short trail brighten, while inactive links retain low intensity. Radial shader halos are localized to selected neuron points. Rendering is capped at 30 frames per second, device pixel ratio is capped at 1.5 (1.25 on mobile), the network is capped at 720 nodes and 2160 connections, active energy particles are capped at 48, and polling is limited to one status request every 15 seconds while the page is visible. The fallback remains hidden while the WebGL context is usable. If WebGL or Three.js initialization fails, the real status label remains visible and the visualization falls back to a safe unavailable state; later status updates may retry initialization. Automated tests validate limits and stable-orientation behavior; no device-specific GPU frame-time benchmark is implied. Browser/device GPU performance varies; physical-device profiling is a separate deployment check.

## Phase 06 Bitvavo market-data validation

Market-data tests use mocked public Bitvavo responses and mocked PostgREST calls. They verify ticker and candle parsing/persistence, invalid configured market logging and non-insertion, empty provider responses, timeouts, rate limits, offline fallbacks, storage failures, scanner-event writes, 60-second catalog/ticker/candle caching, authenticated market/summary endpoints, query validation, the cron-secret guard, and dashboard integration with stored snapshots and market counts. No private Bitvavo endpoint or API key is used.

```powershell
node --test tests/market-data.test.mjs tests/dashboard.test.js
npm.cmd test
npm.cmd run build
```

`npm run build` additionally validates the market endpoints, shared market-data service, and server-only environment template without requiring a Vercel Cron configuration. Project tests verify that `/api/market-refresh` remains available when Vercel Cron is absent. Automated tests use controlled fixtures and do not claim live-provider or deployment success. A live Bitvavo/Supabase smoke test requires deployment environment variables and a configured Supabase project.

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