import { strict as assert } from "node:assert";
import test from "node:test";
import { createArchiveHealthHandler, formatDatabaseSize, getDiskUsagePercent } from "../archive-server/src/health.mjs";
import { createPoolOptions, readArchiveConfig } from "../archive-server/src/config.mjs";

const healthToken = "a".repeat(48);

function makeResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    }
  };
}

function makeRequest(overrides = {}) {
  return {
    method: "GET",
    url: "/api/health",
    headers: { authorization: `Bearer ${healthToken}` },
    ...overrides
  };
}

test("archive health endpoint reports database, disk, and timestamp status", async () => {
  const handler = createArchiveHealthHandler({
    expectedToken: healthToken,
    expectedDatabase: "archive_db",
    probePostgresql: async () => true,
    checkDatabase: async () => ({
      databaseName: "archive_db",
      sizeBytes: "2469606195"
    }),
    getDiskUsage: async () => 12,
    now: () => new Date("2026-11-06T12:00:00.000Z")
  });
  const res = makeResponse();

  await handler(makeRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), {
    server: "online",
    postgresql: "online",
    database: "online",
    diskUsage: 12,
    databaseSize: "2.3 GB",
    lastHealthCheck: "2026-11-06T12:00:00.000Z"
  });
});

test("archive health endpoint reports independent PostgreSQL and database failures", async () => {
  const handler = createArchiveHealthHandler({
    expectedToken: healthToken,
    expectedDatabase: "archive_db",
    probePostgresql: async () => true,
    checkDatabase: async () => {
      throw new Error("private connection detail");
    },
    getDiskUsage: async () => 50
  });
  const res = makeResponse();

  await handler(makeRequest(), res);

  const body = JSON.parse(res.body);
  assert.equal(body.server, "online");
  assert.equal(body.postgresql, "online");
  assert.equal(body.database, "offline");
  assert.equal(body.diskUsage, 50);
  assert.equal(body.databaseSize, null);
  assert.ok(Number.isFinite(Date.parse(body.lastHealthCheck)));
  assert.doesNotMatch(res.body, /private connection detail/);
});

test("archive health endpoint rejects unauthenticated and unsupported requests", async () => {
  let checks = 0;
  const handler = createArchiveHealthHandler({
    expectedToken: healthToken,
    expectedDatabase: "archive_db",
    probePostgresql: async () => { checks += 1; return true; },
    checkDatabase: async () => { checks += 1; return null; },
    getDiskUsage: async () => { checks += 1; return 10; }
  });
  const unauthorized = makeResponse();
  await handler(makeRequest({ headers: { authorization: "Bearer wrong" } }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(checks, 0);

  const unsupported = makeResponse();
  await handler(makeRequest({ method: "POST" }), unsupported);
  assert.equal(unsupported.statusCode, 405);
  assert.equal(unsupported.headers.Allow, "GET");
  assert.equal(checks, 0);
});

test("archive health helpers validate disk usage and format database sizes", () => {
  assert.equal(formatDatabaseSize("2469606195"), "2.3 GB");
  assert.equal(formatDatabaseSize("-1"), null);
  assert.equal(getDiskUsagePercent("/archive", () => ({
    blocks: 1000,
    bsize: 4096,
    bavail: 880
  })), 12);
});

test("archive database configuration requires credentials and always verifies TLS", () => {
  const config = readArchiveConfig({
    ARCHIVE_HEALTH_TOKEN: healthToken,
    ARCHIVE_DB_HOST: "127.0.0.1",
    ARCHIVE_DB_PORT: "5432",
    ARCHIVE_DB_NAME: "archive_db",
    ARCHIVE_DB_USER: "archive_user",
    ARCHIVE_DB_PASSWORD: "test-password",
    ARCHIVE_DB_SSL_CA: "trusted test CA",
    ARCHIVE_DB_SSL_SERVERNAME: "archive.internal"
  });
  const poolOptions = createPoolOptions(config);

  assert.equal(poolOptions.ssl.rejectUnauthorized, true);
  assert.equal(poolOptions.ssl.ca, "trusted test CA");
  assert.equal(poolOptions.ssl.servername, "archive.internal");
  assert.equal(poolOptions.password, "test-password");
  assert.throws(() => readArchiveConfig({
    ARCHIVE_HEALTH_TOKEN: healthToken
  }), /ARCHIVE_DB_HOST/);
});
