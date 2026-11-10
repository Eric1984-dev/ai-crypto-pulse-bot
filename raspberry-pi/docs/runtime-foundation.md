# Raspberry Pi runtime foundation

## Scope and ownership

Phase 3 adds API infrastructure only. This package is still a read-only Node.js foundation for the existing Raspberry Pi PostgreSQL database. The Raspberry Pi is intended to own runtime execution in the target architecture, but this phase does not start a scheduler, migrate AI/scanner/trading logic, expose dashboard data, or implement an execution pipeline.

The existing database and watched-market rows are retained as-is. The user-confirmed Pi findings are that the schema/data are already present, approximately 102 enabled markets exist, AI decision history exists, no runtime PostgreSQL functions are installed, and no candle history currently exists. Runtime functions and candle rows are not Phase 3 startup requirements. No function is invoked, no schema/data migration is performed, and every database connection is configured read-only.

Paper trading remains inactive in this package; no paper or live orders can be submitted. `ENABLE_LIVE_TRADING=true` prevents startup.

## Startup and failure behavior

1. Parse required database settings, loopback API bind, CORS allowlist, session limits, and rate-limit limits. Reject invalid settings and live trading.
2. Create a `pg` connection pool capped at four with TLS verification enabled by default and `default_transaction_read_only=on`.
3. Use read-only transactions to validate database identity, role privileges, required existing prefixed tables/columns/constraints, and the watched-market schema and rows. No runtime database function signatures are required.
4. If any configuration, connectivity, contract, privilege, or watched-market validation fails, do not listen; close the pool and return a nonzero startup result.
5. On success, listen only on a loopback address. No worker, timer, or scheduled job starts.
6. On `SIGINT` or `SIGTERM`, stop accepting requests and close the pool.

Readiness performs a bounded read-only database check and returns only `{"data":{"status":"ready"}}` or a generic `503` error. It does not expose database identity, schema state, function list, market count, or raw database errors.

## API routes and security

| Method | Path | Access | Response purpose |
|---|---|---|---|
| `GET` | `/api/v1/health/live` | Unauthenticated | Process liveness only. |
| `GET` | `/api/v1/health/ready` | Unauthenticated | Coarse dependency/readiness state. |
| `GET` | `/api/v1/health/operational` | `admin` role | Bounded API/process/pool counters only. Denied by default. |

Other static paths return `404`; unsupported methods return `405` with `Allow`. Query parameters are rejected unless explicitly declared by a route. Errors use `error.code`, a generic message, and `requestId`; unknown exceptions become generic `500` responses.

Security controls:

- The API continues to bind to loopback only; forwarded client-IP headers are not trusted.
- Security headers and `Cache-Control: no-store` are set for every request.
- CORS defaults to an empty allowlist. Allowed values must be HTTPS origins or loopback HTTP origins; wildcard origins, paths, credentials in origin URLs, and duplicate values are rejected.
- CORS preflight accepts only safe `GET` requests and the `Content-Type`/`X-CSRF-Token` headers.
- Unsafe methods require an exact configured Origin and a matching session-bound CSRF token. There are no unsafe/business routes in this phase.
- The default authentication provider denies access. A provider-neutral interface and an in-memory hashed-token session store are foundations only. No HTTP session-creation, login, registration, password-reset, OIDC, or other provider integration exists.
- Operational health requires the `admin` role and fails closed unless a trusted identity provider is injected.
- A fixed-window rate limiter uses the socket peer address, has bounded key storage, and never derives identity from untrusted forwarding headers.
- Request logs contain request ID, method, path, status, and duration only. They do not log cookies, authorization headers, secrets, or bodies.

There are no dashboard data, admin action, trading, or market-management endpoints. Vercel/dashboard communication is not enabled by Phase 3.

## Configuration and resource bounds

The API host remains loopback-only and defaults to `127.0.0.1:3002`. CORS origins default to empty. Session storage is process-local, limited by `API_SESSION_MAX`, and expires entries using `API_SESSION_TTL_MS`; the store is not persistent and no endpoint creates sessions. Rate limiting defaults to 60 requests per 60 seconds with a bounded 10,000-key table.

PostgreSQL pool size remains at most four, with bounded connection/query/idle timeouts. Request counters are in-memory aggregate counts, and operational health exposes only aggregate counts, process memory/uptime, and pool counts after authorization. This foundation is suitable for testing the Pi runtime's wiring, not a production capacity claim.

## Database validation scope

Catalog and watched-market queries execute inside read-only transactions. They preserve and validate the existing `public."AI_Crypto_Bot_Watched_Markets"` data; they do not insert, update, delete, normalize, seed, or print individual market symbols. The enabled set must be nonempty and valid.

The database contract checks the existing expected prefixed tables, selected columns and keys, read-only role/transaction settings, and absence of write privileges. Runtime functions are not required and never called. Candle history is not required for this API-only foundation.

## Tests and verification limits

`npm test` covers configuration, read-only preflight behavior, routes, middleware ordering, error responses, CORS/CSRF, session bounds/expiry, deny-by-default authentication, role checks, rate limiting, and operational-health access. The tests use local mocks and do not prove connectivity, schema state, ARM compatibility, or resource headroom on the production Raspberry Pi.

The API remains loopback-only and there is no production deployment or Vercel connection in this phase. Authentication integration and external exposure require explicit future scope and a security design before implementation.
