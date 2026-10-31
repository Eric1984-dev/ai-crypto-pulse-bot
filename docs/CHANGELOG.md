# Changelog

All notable project changes should be documented here.

---

## [Unreleased]

### Added

- Phase 04 authenticated read-only dashboard endpoint and database-backed summaries for agent status, emergency state, portfolio, positions, trades, watched markets, and AI decisions
- Responsive dashboard KPI cards, actual-snapshot Chart.js history, and safe empty/error states
- Dashboard API and rendering tests plus Phase 04 completion report
- Three.js Agent Brain visualization mapped to the live `AI_Crypto_Bot_Status.status` value
- Authenticated status polling endpoint with UNKNOWN fallback, hidden-tab pause, bounded rendering, and explicit GPU-resource disposal
- Agent Brain status-mapping, API, dashboard integration, fallback, rendering, and performance tests plus Phase 05 completion report
- Network-first Agent Brain silhouette with 720 nodes, up to 2160 dynamically pulsing links, flowing energy particles, and WebGL-context-aware fallback behavior
- Phase 05 brain improvement report and geometry, signal-flow, and fallback-recovery regression tests
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

- Replace the single cloud-like Agent Brain surface and external aura with a recognizable bilateral brain silhouette, central fissure, restrained lower structures, internal status-colored network, and a subdued stage background
- Replace the network-cloud Agent Brain as the primary visual with a stable semi-solid organic brain volume, layered additive glow, and internal status-driven neural activity; remove continuous whole-brain rotation

### Fixed

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