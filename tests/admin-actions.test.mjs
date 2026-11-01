import assert from "node:assert/strict";
import test from "node:test";
import { createAdminActionsHandler } from "../api/admin-actions.mjs";

const adminId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const accessCookie = "cp_access_token=header.payload.signature";
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
  ADMIN_USER_IDS: adminId,
  ENABLE_LIVE_TRADING: "false"
};

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
    }
  };
}

function createAuthFetch(userId) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (!userId) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ id: userId }) };
    }
  };
}

test("admin actions reject missing and non-admin sessions before executing services", async () => {
  let executions = 0;
  const auth = createAuthFetch(otherId);
  const handler = createAdminActionsHandler({
    env,
    fetchImpl: auth.fetchImpl,
    aiService: { async runAnalysis() { executions += 1; } },
    paperService: { async runPaperTrading() { executions += 1; } },
    logger: { info() {}, error() {} }
  });

  const unauthenticated = createResponse();
  await handler({ method: "POST", headers: {}, body: { action: "ai-analysis" } }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);

  const forbidden = createResponse();
  await handler({
    method: "POST",
    headers: { cookie: accessCookie },
    body: { action: "ai-analysis" }
  }, forbidden);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(JSON.parse(forbidden.body).error.code, "ADMIN_ACCESS_DENIED");
  assert.equal(executions, 0);
  assert.equal(auth.calls.length, 1);
});

test("admin session status and both actions return safe summaries and execution metrics", async () => {
  const auth = createAuthFetch(adminId);
  const analysisResult = { status: "ACTIVE", analyzedMarkets: 2, decisionsStored: 2 };
  const paperResult = {
    status: "COMPLETED",
    portfoliosProcessed: 1,
    decisionsProcessed: 2,
    tradesExecuted: 1,
    duplicates: 0,
    skipped: 1
  };
  const received = [];
  const handler = createAdminActionsHandler({
    env,
    fetchImpl: auth.fetchImpl,
    aiService: {
      async runAnalysis(options) {
        received.push({ action: "ai-analysis", options });
        return analysisResult;
      }
    },
    paperService: {
      async runPaperTrading(options) {
        received.push({ action: "paper-trading", options });
        return paperResult;
      }
    },
    logger: { info() {}, error() {} }
  });

  const statusResponse = createResponse();
  await handler({ method: "GET", headers: { cookie: accessCookie } }, statusResponse);
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(statusResponse.body), { data: { isAdmin: true } });

  for (const [action, expected] of [
    ["ai-analysis", analysisResult],
    ["paper-trading", paperResult]
  ]) {
    const response = createResponse();
    await handler({
      method: "POST",
      headers: { cookie: accessCookie },
      body: { action }
    }, response);
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(body.data, expected);
    assert.ok(Number.isFinite(body.metrics.executionDurationMs));
    assert.ok(body.metrics.executionDurationMs >= 0);
  }

  assert.deepEqual(received.map(({ action }) => action), ["ai-analysis", "paper-trading"]);
  assert.ok(received.every(({ options }) =>
    options.config.supabaseUrl === env.SUPABASE_URL
      && options.serviceRoleKey === env.SUPABASE_SERVICE_ROLE_KEY
  ));
  assert.equal(auth.calls.length, 3);
  assert.ok(auth.calls.every(({ url, options }) =>
    url === `${env.SUPABASE_URL}/auth/v1/user`
      && options.headers.apikey === env.SUPABASE_ANON_KEY
      && options.headers.authorization === "Bearer header.payload.signature"
  ));
  assert.doesNotMatch(statusResponse.body, /server-only-test-key|ADMIN_USER_IDS/);
});

test("paper-trading admin action preserves the paper-only environment guard", async () => {
  const auth = createAuthFetch(adminId);
  let executions = 0;
  const handler = createAdminActionsHandler({
    env: { ...env, ENABLE_LIVE_TRADING: "true" },
    fetchImpl: auth.fetchImpl,
    paperService: { async runPaperTrading() { executions += 1; } },
    logger: { info() {}, error() {} }
  });
  const response = createResponse();

  await handler({
    method: "POST",
    headers: { cookie: accessCookie },
    body: { action: "paper-trading" }
  }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error.code, "PAPER_TRADING_ONLY");
  assert.equal(executions, 0);
});

test("admin action rejects invalid methods and action names", async () => {
  const auth = createAuthFetch(adminId);
  const handler = createAdminActionsHandler({
    env,
    fetchImpl: auth.fetchImpl,
    logger: { info() {}, error() {} }
  });
  const methodResponse = createResponse();
  await handler({ method: "DELETE", headers: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);

  const actionResponse = createResponse();
  await handler({
    method: "POST",
    headers: { cookie: accessCookie },
    body: { action: "market-refresh" }
  }, actionResponse);
  assert.equal(actionResponse.statusCode, 400);
});

test("admin actions fail closed when the server-side allowlist is missing or malformed", async () => {
  const auth = createAuthFetch(adminId);
  const handler = createAdminActionsHandler({
    env: { ...env, ADMIN_USER_IDS: `${adminId},not-a-uuid` },
    fetchImpl: auth.fetchImpl,
    logger: { info() {}, error() {} }
  });
  const response = createResponse();

  await handler({ method: "GET", headers: { cookie: accessCookie } }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error.code, "ADMIN_ACCESS_NOT_CONFIGURED");
  assert.equal(auth.calls.length, 0);
});
