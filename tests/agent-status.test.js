const assert = require("node:assert/strict");
const test = require("node:test");
const agentStatusModule = import("../api/agent-status.mjs");

const authEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  NODE_ENV: "production"
};
const accessToken = "header.payload.signature";

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

test("agent status API verifies the session and reads the database status with the user JWT", async () => {
  const module = await agentStatusModule;
  const calls = [];
  const handler = module.createHandler({
    env: authEnv,
    verify: async (token) => token === accessToken,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => [{ status: "ANALYZING" }]
      };
    }
  });
  const res = createResponse();

  await handler({
    method: "GET",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), { data: { status: "ANALYZING" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://project.supabase.co/rest/v1/AI_Crypto_Bot_Status?select=status&limit=1");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${accessToken}`);
  assert.equal(calls[0].options.headers.apikey, authEnv.SUPABASE_ANON_KEY);
  assert.equal(calls[0].options.cache, "no-store");
});

test("agent status API returns a neutral status for missing or invalid database states", async () => {
  const module = await agentStatusModule;
  for (const rows of [[], [{ status: "NOT_A_STATUS" }], [{ status: null }]]) {
    const handler = module.createHandler({
      env: authEnv,
      verify: async () => true,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => rows })
    });
    const res = createResponse();

    await handler({ method: "GET", headers: { cookie: `cp_access_token=${accessToken}` } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { data: { status: null } });
  }
});

test("agent status API rejects anonymous requests and fails safely on provider errors", async () => {
  const module = await agentStatusModule;
  let fetchCalls = 0;
  const handler = module.createHandler({
    env: authEnv,
    verify: async () => true,
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: false, status: 503 };
    }
  });
  const anonymousResponse = createResponse();
  await handler({ method: "GET", headers: {} }, anonymousResponse);
  assert.equal(anonymousResponse.statusCode, 401);
  assert.equal(fetchCalls, 0);
  assert.match(anonymousResponse.headers["set-cookie"], /Max-Age=0/);

  const providerResponse = createResponse();
  await handler({
    method: "GET",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, providerResponse);
  assert.equal(providerResponse.statusCode, 503);
  assert.equal(JSON.parse(providerResponse.body).error.code, "AGENT_STATUS_UNAVAILABLE");
});

test("agent status API rejects unsupported methods and invalid sessions", async () => {
  const module = await agentStatusModule;
  const handler = module.createHandler({
    env: authEnv,
    verify: async () => false,
    fetchImpl: async () => { throw new Error("status query must not happen"); }
  });
  const methodResponse = createResponse();
  await handler({ method: "POST", headers: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.allow, "GET");

  const invalidSessionResponse = createResponse();
  await handler({
    method: "GET",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, invalidSessionResponse);
  assert.equal(invalidSessionResponse.statusCode, 401);
  assert.equal(JSON.parse(invalidSessionResponse.body).error.code, "INVALID_SESSION");
});
