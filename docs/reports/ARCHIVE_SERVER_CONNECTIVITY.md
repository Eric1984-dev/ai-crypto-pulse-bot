# Archive Server Connectivity

## Summary

The existing Archive Server dashboard card now consumes a Pi-side health service through the existing authenticated `GET /api/dashboard-data?view=archive-health` route. No additional Vercel Function is introduced. Vercel calls the configured HTTPS tunnel URL and sends a server-only bearer token; the browser receives neither the token nor PostgreSQL connection details.

The standalone service in `archive-server/` binds to loopback by default. It probes PostgreSQL TCP reachability, connects to the configured database using certificate-verified TLS, checks the current database name and measured database size, and reports filesystem usage and an ISO last-check timestamp. Failures are represented as Offline/null health values without exposing driver errors.

## Environment variables

Configure these only on the Raspberry Pi service:

| Variable | Purpose |
|---|---|
| `ARCHIVE_DB_HOST` | PostgreSQL host |
| `ARCHIVE_DB_PORT` | PostgreSQL port; defaults to `5432` |
| `ARCHIVE_DB_NAME` | Expected archive database |
| `ARCHIVE_DB_USER` | Read-only health-check database user |
| `ARCHIVE_DB_PASSWORD` | Database password |
| `ARCHIVE_HEALTH_TOKEN` | Shared random token, at least 32 bytes |

Optional Pi settings:

- `ARCHIVE_HEALTH_HOST` defaults to `127.0.0.1`.
- `ARCHIVE_HEALTH_PORT` defaults to `3001`.
- `ARCHIVE_DB_SSL_CA` supplies a trusted CA certificate when it is not in the system trust store.
- `ARCHIVE_DB_SSL_SERVERNAME` supplies the DNS name on the verified certificate when it differs from the configured database host.
- `ARCHIVE_DISK_PATH` selects the filesystem whose usage is reported; it defaults to `/`.

Configure `ARCHIVE_SERVER_URL` and the same `ARCHIVE_HEALTH_TOKEN` in Vercel. The URL must be the HTTPS base URL exposed by the trusted tunnel/reverse proxy. Vercel cannot directly reach a private LAN address. The `ARCHIVE_DB_*` variables must not be copied to Vercel, the browser, source control, or logs. Both environment templates contain blank secret placeholders only.

Generate a distinct high-entropy token on the Pi and transfer it through the operators' approved secret-management process; do not paste it into source files or reports. The PostgreSQL health role should have only the connection and database-inspection permissions needed for the read-only size query.

## Health endpoint

`GET /api/health` requires `Authorization: Bearer <ARCHIVE_HEALTH_TOKEN>`. Other methods receive `405`; unauthenticated requests receive `401`; unrelated paths receive `404`. Responses use `Cache-Control: no-store` and contain no host, username, password, SQL error, or connection string.

```json
{
  "server": "online",
  "postgresql": "online",
  "database": "online",
  "diskUsage": 12,
  "databaseSize": "2.3 GB",
  "lastHealthCheck": "2026-11-06T12:00:00.000Z"
}
```

`server` means the authorized Pi health service responded. `postgresql` reports TCP reachability (or a successful database connection). `database` is online only if verified-TLS SQL succeeds against the configured database and returns a valid database size. Disk usage is a percentage or `null`; size is a display string or `null`; the timestamp is the service check time in UTC.

The Vercel proxy fails closed to Offline when the URL/token is absent, upstream is unreachable, the response is invalid, or the endpoint returns a non-success status. Its timeout and polling remain bounded; this view does not call paper-trading or AI-analysis paths.

## TLS and network prerequisites

The user-provided PostgreSQL TLS state was **not confirmed**. The implementation always sets `rejectUnauthorized: true` and does not provide a plaintext or insecure-certificate fallback. Before the database status can be online, PostgreSQL must have TLS enabled and its certificate must validate using the Pi system trust store or `ARCHIVE_DB_SSL_CA`. If the host is configured as an IP but the certificate identifies a DNS name, configure the matching `ARCHIVE_DB_SSL_SERVERNAME`.

The Pi health service binds to loopback by default. Configure a trusted HTTPS tunnel/reverse proxy to forward the health endpoint to `127.0.0.1:3001`, preserve the Authorization header, restrict access to the intended Vercel caller where supported, and retain bearer-token verification at the service. Do not expose port 3001 or PostgreSQL directly to the public internet.

## Validation and deployment status

Validation completed:

- `node --test tests/dashboard.test.js tests/archive-server.test.mjs` — 42 tests passed.
- `npm.cmd test` — 310 tests passed.
- `npm.cmd run build` — static project validation and database migration validation passed.
- The archive service dependency installation/audit reported zero vulnerabilities.
- Vercel API handlers remain at 12 `.mjs` functions; `api/README.md` is documentation, not a function. No file was added under `api/`.

The endpoint, tunnel, Pi environment, PostgreSQL TLS, and Vercel environment have **not** been configured or verified by this code change. Local tests and builds cannot establish production connectivity. The archive PostgreSQL credentials were not read or added to the repository.

This change reuses `/api/dashboard-data` and adds no file under `api/`.
