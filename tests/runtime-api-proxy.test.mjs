import test from "node:test";
import assert from "node:assert/strict";
import { createHandler as createAuthSessionHandler } from "../api/auth-session.mjs";
import { createHandler as createDashboardDataHandler } from "../api/dashboard-data.mjs";
import { createHandler as createProtectedPageHandler } from "../api/protected-page.mjs";
import {
  createRuntimeApiUrl,
  proxyRuntimeApiRequest
} from "../lib/runtime-api-proxy.mjs";

const token = "A".repeat(43);
const cookie = `__Host-cp_session=${token}`;
const env = {
  NODE_ENV: "production",
  CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com"
};

function createResponse() {
  const headers = new Map();
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = "") { this.body = value; }
  };
}

test("runtime proxy URLs are constrained to the configured HTTPS API", () => {
  assert.equal(
    createRuntimeApiUrl(env, "/api/v1/dashboard-data?view=analytics").toString(),
    "https://api.example.com/api/v1/dashboard-data?view=analytics"
  );
  assert.throws(() => createRuntimeApiUrl(env, "//attacker.example/api/v1/data"), /path/);
  assert.throws(() => createRuntimeApiUrl(env, "/api/v1/../../auth/login"), /path/);
  assert.throws(() => createRuntimeApiUrl({
    ...env,
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "http://api.example.com"
  }, "/api/v1/markets"), /origin/);
});

test("Vercel login endpoint forwards credentials and sets the opaque HttpOnly session cookie", async () => {
  let upstream;
  const handler = createAuthSessionHandler({
    env,
    fetchImpl: async (url, options) => {
      upstream = { url: url.toString(), options };
      return new Response(JSON.stringify({
        data: { csrfToken: "B".repeat(43), expiresAt: 123456 }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `${cookie}; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }
  });
  const response = createResponse();
  await handler({
    method: "POST",
    headers: { origin: "https://dashboard.example.com" },
    body: { username: "operator", password: "example" }
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(upstream.url, "https://api.example.com/api/v1/auth/login");
  assert.equal(upstream.options.headers.get("origin"), "https://dashboard.example.com");
  assert.equal(await new Response(response.body).text(), JSON.stringify({
    data: { csrfToken: "B".repeat(43), expiresAt: 123456 }
  }));
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(upstream.options.headers.has("cookie"), false);
});

test("Vercel logout forwards only the dashboard session and CSRF token", async () => {
  let upstream;
  const handler = createAuthSessionHandler({
    env,
    fetchImpl: async (_url, options) => {
      upstream = options;
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": "__Host-cp_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax" }
      });
    }
  });
  const response = createResponse();
  await handler({
    method: "DELETE",
    headers: {
      cookie: `unrelated=value; ${cookie}`,
      origin: "https://dashboard.example.com",
      "x-csrf-token": "C".repeat(43)
    }
  }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(upstream.headers.get("cookie"), cookie);
  assert.equal(upstream.headers.get("x-csrf-token"), "C".repeat(43));
  assert.equal(response.headers.get("set-cookie"), "__Host-cp_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
});

test("dashboard data function proxies same-origin runtime reads without Supabase configuration", async () => {
  let upstreamUrl;
  const handler = createDashboardDataHandler({
    env,
    fetchImpl: async (url, options) => {
      upstreamUrl = url.toString();
      assert.equal(options.headers.get("cookie"), cookie);
      return Response.json({ data: { status: "live" } });
    }
  });
  const response = createResponse();
  await handler({
    method: "GET",
    url: `/api/dashboard-data?path=${encodeURIComponent("/api/v1/health/live")}`,
    headers: { cookie }
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(upstreamUrl, "https://api.example.com/api/v1/health/live");
  assert.deepEqual(JSON.parse(response.body), { data: { status: "live" } });
});

test("dashboard data function rejects missing, duplicate, and unsupported legacy view paths", async () => {
  let upstreamCalls = 0;
  const handler = createDashboardDataHandler({
    env,
    fetchImpl: async () => {
      upstreamCalls += 1;
      return Response.json({ data: {} });
    }
  });

  for (const url of [
    "/api/dashboard-data",
    "/api/dashboard-data?path=%2Fapi%2Fv1%2Fmarkets&path=%2Fapi%2Fv1%2Fmonitoring",
    "/api/dashboard-data?view=analytics"
  ]) {
    const response = createResponse();
    await handler({ method: "GET", url, headers: { cookie } }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error.code, "INVALID_RUNTIME_API_PATH");
  }
  assert.equal(upstreamCalls, 0);
});

test("protected dashboard pages redirect without a session and serve only after Pi verification", async () => {
  let reads = 0;
  const handler = createProtectedPageHandler({
    env,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.cookie, cookie);
      return Response.json({ data: { csrfToken: "D".repeat(43), expiresAt: 123456 } });
    },
    readFile() {
      reads += 1;
      return "<!doctype html><h1>Dashboard</h1>";
    },
    projectRoot: "C:\\dashboard"
  });
  const denied = createResponse();
  await handler({
    method: "GET",
    url: "/api/protected-page?page=dashboard",
    query: { page: "dashboard" },
    headers: {}
  }, denied);
  assert.equal(denied.statusCode, 302);
  assert.match(denied.headers.get("location"), /login\.html/);
  assert.equal(reads, 0);

  const allowed = createResponse();
  await handler({
    method: "GET",
    url: "/api/protected-page?page=dashboard",
    query: { page: "dashboard" },
    headers: { cookie }
  }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(reads, 1);
});

test("runtime proxy fails closed when there is no session cookie", async () => {
  let calls = 0;
  const response = createResponse();
  await proxyRuntimeApiRequest({
    method: "GET",
    headers: {}
  }, response, {
    env,
    fetchImpl: async () => { calls += 1; },
    path: "/api/v1/markets"
  });
  assert.equal(response.statusCode, 401);
  assert.equal(calls, 0);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});
