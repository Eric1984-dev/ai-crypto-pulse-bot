# Archive Server Monitoring

## Summary

The Dashboard now has an **Archive Server** card that shows server, PostgreSQL, and database status, disk usage, and database size. It requests health immediately after the protected dashboard session is ready, then refreshes every five minutes while the page is visible. Polling pauses while hidden and resumes with a fresh request when the page returns to the foreground.

The health check is independent from the dashboard's portfolio refresh and trading APIs. If the archive service is unreachable or returns an HTTP error, invalid JSON, or invalid health fields, the card displays Offline and unknown disk/database values. It does not show the main dashboard error banner or call a trading operation.

## Integration

The dashboard uses the existing authenticated `GET /api/dashboard-data?view=archive-health` handler. No Vercel Function, database object, migration, or trading behavior was added or changed. The handler makes a read-only server-side request to `GET {ARCHIVE_SERVER_URL}/api/health`, with a three-second timeout, no redirects, and `no-store` caching. HTTPS is required in production; local development may use HTTP.

The Raspberry Pi service implements this JSON contract:

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

Status fields accept `online` or `offline`. `diskUsage` is a percentage from 0 to 100, `databaseSize` is a short display string, and `lastHealthCheck` is an ISO timestamp. Unknown usage or size can be represented as `null`. The dashboard uses text-only DOM rendering and does not expose the archive URL or bearer token to the browser.

The Vercel-side proxy requires `ARCHIVE_HEALTH_TOKEN` and sends it only in its server-to-server request. The database connection and PostgreSQL credentials are handled exclusively by the Pi-side service. See the [connectivity report](./ARCHIVE_SERVER_CONNECTIVITY.md) for deployment prerequisites and limitations.

## Validation

- `node --test tests/dashboard.test.js` — passed, 37 tests.
- `npm.cmd test` — passed, 305 tests.
- `npm.cmd run build` — passed static project and database migration validation.
- API function count — 12; the Hobby limit remains satisfied.

Production connectivity, Vercel environment configuration, and the Raspberry Pi response have not been independently verified. No production deployment or external health request was performed.
