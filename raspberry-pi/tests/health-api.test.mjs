import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/api/server.mjs";

const logger = Object.freeze({
  info() {},
  error() {}
});

async function withServer(options, run) {
  const server = createApiServer({
    readiness: { async check() { return true; } },
    getOperationalHealth: () => ({ status: "foundation_only" }),
    authenticationProvider: { async authenticate() { return null; } },
    logger,
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
}

test("health endpoints have bounded payloads and security headers", async () => {
  let checks = 0;
  const metrics = {
    record() {},
    getSnapshot() { return { totalRequests: 2, clientFailures: 0, serverFailures: 0 }; }
  };
  await withServer({
    readiness: {
      async check() {
        checks += 1;
        return true;
      }
    },
    metrics
  }, async (baseUrl) => {
    const live = await fetch(`${baseUrl}/api/v1/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { data: { status: "live" } });
    assert.equal(live.headers.get("cache-control"), "no-store");
    assert.equal(live.headers.get("x-content-type-options"), "nosniff");
    assert.equal(live.headers.get("x-frame-options"), "DENY");
    assert.ok(live.headers.get("x-request-id"));

    const ready = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { data: { status: "ready" } });

    const invalidQuery = await fetch(`${baseUrl}/api/v1/health/live?detail=true`);
    assert.equal(invalidQuery.status, 400);
    assert.equal((await invalidQuery.json()).error.code, "INVALID_QUERY");

    const operational = await fetch(`${baseUrl}/api/v1/health/operational`);
    assert.equal(operational.status, 401);
    assert.equal((await operational.json()).error.code, "UNAUTHENTICATED");

    const post = await fetch(`${baseUrl}/api/v1/health/live`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, OPTIONS");
    assert.equal(checks, 1);
  });
});

test("API server refuses to start without an authentication provider", () => {
  assert.throws(() => createApiServer({
    readiness: { async check() { return true; } },
    getOperationalHealth: () => ({ status: "foundation_only" }),
    logger
  }), /Cloudflare Access authentication provider is required/);
});

test("readiness and protected operational health fail closed", async () => {
  await withServer({
    readiness: { async check() { return false; } },
    authenticationProvider: { async authenticate() { return null; } }
  }, async (baseUrl) => {
    const ready = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).error.code, "SERVICE_NOT_READY");

    const operational = await fetch(`${baseUrl}/api/v1/health/operational`);
    assert.equal(operational.status, 401);
  });
});

test("operational health requires an admin identity and CORS is allowlisted", async () => {
  await withServer({
    allowedOrigins: ["https://dashboard.example.com"],
    authenticationProvider: {
      async authenticate() {
        return { principal: { subject: "admin-1", roles: ["admin"] } };
      }
    },
    getOperationalHealth: () => ({ status: "foundation_only" })
  }, async (baseUrl) => {
    const deniedOrigin = await fetch(`${baseUrl}/api/v1/health/live`, {
      headers: { Origin: "https://attacker.example" }
    });
    assert.equal(deniedOrigin.status, 403);

    const live = await fetch(`${baseUrl}/api/v1/health/live`, {
      headers: { Origin: "https://dashboard.example.com" }
    });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("access-control-allow-origin"), "https://dashboard.example.com");

    const operational = await fetch(`${baseUrl}/api/v1/health/operational`);
    assert.equal(operational.status, 200);
    assert.deepEqual(await operational.json(), {
      data: { status: "foundation_only" }
    });
  });
});

test("non-admin identities cannot read operational health", async () => {
  await withServer({
    authenticationProvider: {
      async authenticate() {
        return { principal: { subject: "reader-1", roles: ["reader"] } };
      }
    }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health/operational`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
  });
});

test("unexpected errors use a generic request-correlated response and are logged", async () => {
  const loggedErrors = [];
  await withServer({
    logger: {
      info() {},
      error(message) { loggedErrors.push(JSON.parse(message)); }
    },
    authenticationProvider: {
      async authenticate() {
        return { principal: { subject: "admin-1", roles: ["admin"] } };
      }
    },
    getOperationalHealth() {
      throw new Error("sensitive internal details");
    }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health/operational`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(body.error.message.includes("sensitive"), false);
    assert.equal(body.error.requestId, response.headers.get("x-request-id"));
    assert.equal(loggedErrors[0].requestId, body.error.requestId);
  });
});

test("rate limit returns a retryable error after the configured request count", async () => {
  await withServer({
    rateLimitMaxRequests: 1
  }, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/v1/health/live`);
    assert.equal(first.status, 200);
    const limited = await fetch(`${baseUrl}/api/v1/health/live`);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal((await limited.json()).error.code, "RATE_LIMITED");
  });
});

test("CORS preflight permits only safe methods and approved headers", async () => {
  await withServer({
    allowedOrigins: ["https://dashboard.example.com"]
  }, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/api/v1/health/live`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://dashboard.example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-methods"), "GET, OPTIONS");

    const denied = await fetch(`${baseUrl}/api/v1/health/live`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://dashboard.example.com",
        "Access-Control-Request-Method": "POST"
      }
    });
    assert.equal(denied.status, 403);
  });
});
