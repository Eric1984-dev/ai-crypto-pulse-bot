import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api/api-error.mjs";
import { csrfMiddleware } from "../src/api/csrf-middleware.mjs";
import { composeMiddleware } from "../src/api/middleware-pipeline.mjs";
import { FixedWindowRateLimiter, rateLimitMiddleware } from "../src/api/rate-limiter.mjs";
import { createSessionStore } from "../src/auth/session-store.mjs";
import { createRequestMetrics } from "../src/monitoring/request-metrics.mjs";

test("session store returns opaque credentials and expires sessions within its capacity", () => {
  let timestamp = 1000;
  const token = "A".repeat(43);
  const store = createSessionStore({
    ttlMs: 60000,
    maxSessions: 1,
    now: () => timestamp,
    randomToken: () => token
  });
  const created = store.create({ subject: "admin-1", roles: ["admin"] });

  assert.equal(created.token, token);
  assert.equal(store.get(token).principal.subject, "admin-1");
  assert.equal(store.size, 1);
  assert.throws(() => store.create({ subject: "reader-1", roles: ["reader"] }), {
    code: "SESSION_CAPACITY_EXCEEDED"
  });
  timestamp += 60000;
  assert.equal(store.get(token), null);
  assert.equal(store.size, 0);
  assert.equal(store.delete(token), false);
});

test("session store rejects invalid principals and unknown token formats", () => {
  const token = "B".repeat(43);
  const store = createSessionStore({ randomToken: () => token });
  assert.throws(() => store.create({ subject: "", roles: ["admin"] }), /trusted principal/);
  store.create({ subject: "admin-1", roles: ["admin"] });
  assert.equal(store.get("invalid"), null);
});

test("CSRF requires exact allowed origin and session-bound token for unsafe methods", async () => {
  const middleware = csrfMiddleware({ allowedOrigins: ["https://dashboard.example.com"] });
  let proceeded = false;
  const next = async () => { proceeded = true; };
  const context = {
    request: {
      method: "POST",
      headers: {
        origin: "https://dashboard.example.com",
        "x-csrf-token": "token"
      }
    },
    auth: { session: { csrfToken: "token" } }
  };
  await middleware(context, next);
  assert.equal(proceeded, true);

  for (const invalidContext of [
    { ...context, request: { ...context.request, headers: { ...context.request.headers, origin: "https://evil.example" } } },
    { ...context, request: { ...context.request, headers: { origin: "https://dashboard.example.com" } } }
  ]) {
    await assert.rejects(middleware(invalidContext, next), {
      code: "CSRF_VALIDATION_FAILED"
    });
  }
});

test("middleware pipeline rejects repeated next calls", async () => {
  const run = composeMiddleware([
    async (_context, next) => {
      await next();
      await assert.rejects(next(), /more than once/);
    }
  ], async () => {});
  await run({});
});

test("fixed-window rate limiter stays bounded and returns retry timing", async () => {
  let timestamp = 10000;
  const limiter = new FixedWindowRateLimiter({
    limit: 1,
    windowMs: 1000,
    maxKeys: 1,
    now: () => timestamp
  });
  assert.deepEqual(limiter.consume("client-a"), { allowed: true, remaining: 0 });
  assert.deepEqual(limiter.consume("client-a"), { allowed: false, retryAfterSeconds: 1 });
  assert.deepEqual(limiter.consume("client-b"), { allowed: true, remaining: 0 });
  timestamp += 1000;
  assert.deepEqual(limiter.consume("client-b"), { allowed: true, remaining: 0 });

  const middleware = rateLimitMiddleware({
    consume() {
      return { allowed: false, retryAfterSeconds: 2 };
    }
  });
  await assert.rejects(middleware({ request: {} }, async () => {}), (error) =>
    error instanceof ApiError
      && error.statusCode === 429
      && error.headers["Retry-After"] === "2");
});

test("request metrics expose only bounded counters", () => {
  const metrics = createRequestMetrics();
  metrics.record(200);
  metrics.record(404);
  metrics.record(500);
  assert.deepEqual(metrics.getSnapshot(), {
    totalRequests: 3,
    clientFailures: 1,
    serverFailures: 1
  });
});
