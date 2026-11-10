# Phase 3 — Raspberry Pi API Foundation Implementation Report

## Result

Phase 3 implemented the API/security infrastructure in `raspberry-pi/`. The package remains an isolated, loopback-only, read-only foundation. No AI, scanner, market-ingestion, dashboard-data, analytics, scheduler, or trading business logic was migrated.

The existing Pi PostgreSQL schema and watched-market rows were not modified. No migration, database write, Vercel deployment, external scheduler, or trading order was run.

## Implemented components

- Built-in Node.js HTTP server with static route registration and an ordered async middleware pipeline.
- Required endpoints:
  - `GET /api/v1/health/live` — liveness only.
  - `GET /api/v1/health/ready` — coarse readiness state with no database/schema details.
  - `GET /api/v1/health/operational` — bounded runtime/resource counters, protected by the `admin` role.
- Standard request-correlated error envelope, query validation, security headers, `no-store` responses, and safe request logging.
- Strict CORS origin configuration, safe-method preflight handling, and an unsafe-method CSRF guard requiring an exact allowlisted Origin plus session-bound token.
- Provider-neutral authentication interface, deny-all default provider, role authorization, and bounded in-memory session store using hashed opaque session tokens.
- In-memory fixed-window rate limiter with bounded key storage. Client identity uses the socket peer address; forwarded headers are not trusted.
- Bounded API configuration for CORS, sessions, and rate limiting; API bind remains loopback-only.
- Aggregate request counters and an Admin-only operational health snapshot. Operational health returns `401` by default because authentication integration and session-creation endpoints are intentionally not implemented.

## Database/runtime behavior

- Startup remains fail-closed and uses the existing database and `AI_Crypto_Bot_Watched_Markets` rows read-only.
- Required table, selected column/key, database identity, role, read-only, and watched-market checks remain in place.
- Runtime PostgreSQL functions are no longer required. This corrects the former Phase 2 function assumption based on the user-confirmed Pi validation that no runtime functions are installed. No PostgreSQL function is invoked.
- Candle history is not required for this API-only phase; the confirmed absence of candle rows does not block startup.
- The runtime does not insert, update, delete, create, or alter database objects.

## Validation performed

| Check | Result |
|---|---|
| Raspberry Pi package tests (`npm.cmd --prefix raspberry-pi test`) | Passed: 26 tests, 0 failures |
| Complete repository tests (`npm.cmd test`) | Passed: 388 tests, 0 failures |
| Repository build (`npm.cmd run build`) | Passed: static project validation and database migration validation |
| Node syntax check for `raspberry-pi/src/**/*.mjs` | Passed: 31 modules |
| `git diff --check` | Passed |
| Lint | Not run; no lint script is configured in the root or Raspberry Pi package manifests |

Automated tests use local mocks. This phase did not connect to the live Pi database, validate ARM runtime behavior or resource headroom on the Pi, expose the API externally, or perform a Vercel-to-Pi integration test. No production deployment is claimed.

## Assumptions and limitations

- The user-confirmed Pi findings are authoritative: existing schema/data are installed, approximately 102 enabled watched markets exist, AI decision history exists, no runtime PostgreSQL functions are installed, and no candle history exists.
- `API_CORS_ORIGINS` remains empty by default. Only exact HTTPS origins or loopback HTTP origins are accepted if configured.
- The API continues to bind to loopback. It is not reachable by the Vercel dashboard and must not be exposed through a tunnel or public proxy in this phase.
- The authentication/session code is a provider-neutral foundation only. There is no OIDC, login, registration, password reset, session creation, or production identity validation.
- In-memory sessions, rate-limit buckets, and request counters reset on process restart and are not shared across instances.
- Operational health cannot be used until a trusted authentication provider is explicitly designed and supplied in a separately authorized phase.
- The root build validates the existing application/database migration assets; it is not a Raspberry Pi packaging or deployment test.

## Open items for a future phase

1. Perform the documented validation procedure on the actual Pi using the existing database, confirming the preserved watched-market count and startup/readiness behavior.
2. Before any dashboard connectivity, obtain explicit scope for the external network boundary and authentication approach. Authentication implementation remains out of scope unless separately authorized; do not infer OIDC approval.
3. Define the next phase's business scope and contracts before moving any scanner, market ingestion, AI, analytics, dashboard-data, scheduler, or paper-trading logic.
4. Validate the runtime process, Node.js build, memory/CPU headroom, and database connection behavior on Raspberry Pi 3 hardware.

Phase 3 stops here. No Phase 4 work has been started.

## Related documentation

- [Raspberry Pi runtime README](../../raspberry-pi/README.md)
- [Runtime foundation specification](../../raspberry-pi/docs/runtime-foundation.md)
- [Deployment and validation guide](../../raspberry-pi/docs/phase-2-deployment-validation.md)
