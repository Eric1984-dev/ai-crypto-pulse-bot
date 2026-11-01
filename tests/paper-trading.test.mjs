import assert from "node:assert/strict";
import test from "node:test";
import { createPaperTradingHandler } from "../api/paper-trading.mjs";
import { createPaperTradingService, PaperTradingError } from "../lib/paper-trading.mjs";

const serviceEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
  CRON_SECRET: "test-cron-secret",
  ENABLE_LIVE_TRADING: "false"
};
const runResult = {
  status: "COMPLETED",
  portfoliosProcessed: 2,
  decisionsProcessed: 10,
  tradesExecuted: 1,
  duplicates: 3,
  skipped: 6
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

test("paper trading service invokes only the protected Supabase database RPC", async () => {
  const calls = [];
  const service = createPaperTradingService({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => runResult };
    }
  });

  const result = await service.runPaperTrading({
    config: { supabaseUrl: serviceEnv.SUPABASE_URL },
    serviceRoleKey: serviceEnv.SUPABASE_SERVICE_ROLE_KEY
  });

  assert.deepEqual(result, runResult);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://project.supabase.co/rest/v1/rpc/AI_Crypto_Bot_Run_Paper_Trading"
  );
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${serviceEnv.SUPABASE_SERVICE_ROLE_KEY}`);
  assert.equal(calls[0].options.headers.apikey, serviceEnv.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(calls[0].options.body, "{}");
  assert.equal(calls[0].options.cache, "no-store");
  assert.ok(calls[0].options.signal);
  assert.doesNotMatch(calls[0].url, /bitvavo|order|balance/i);
});

test("paper trading service rejects unavailable databases and malformed RPC results", async () => {
  const unavailable = createPaperTradingService({
    fetchImpl: async () => ({ ok: false, status: 500 })
  });
  await assert.rejects(
    unavailable.runPaperTrading({
      config: { supabaseUrl: serviceEnv.SUPABASE_URL },
      serviceRoleKey: serviceEnv.SUPABASE_SERVICE_ROLE_KEY
    }),
    (error) => error instanceof PaperTradingError && error.code === "PAPER_TRADING_DATABASE_FAILED"
  );

  const malformed = createPaperTradingService({
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "COMPLETED" }) })
  });
  await assert.rejects(
    malformed.runPaperTrading({
      config: { supabaseUrl: serviceEnv.SUPABASE_URL },
      serviceRoleKey: serviceEnv.SUPABASE_SERVICE_ROLE_KEY
    }),
    (error) => error instanceof PaperTradingError && error.code === "INVALID_PAPER_TRADING_RESPONSE"
  );
});

test("paper trading endpoint requires POST, cron authorization, and explicit paper-only configuration", async () => {
  let executions = 0;
  const handler = createPaperTradingHandler({
    env: serviceEnv,
    service: { runPaperTrading: async () => { executions += 1; return runResult; } },
    logger: { info() {}, error() {} }
  });

  const wrongMethod = createResponse();
  await handler({ method: "GET", headers: {} }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.allow, "POST");

  const unauthorized = createResponse();
  await handler({ method: "POST", headers: { authorization: "Bearer wrong" } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const liveEnabled = createResponse();
  await createPaperTradingHandler({
    env: { ...serviceEnv, ENABLE_LIVE_TRADING: "true" },
    service: { runPaperTrading: async () => { executions += 1; return runResult; } },
    logger: { info() {}, error() {} }
  })({
    method: "POST",
    headers: { authorization: `Bearer ${serviceEnv.CRON_SECRET}` }
  }, liveEnabled);
  assert.equal(liveEnabled.statusCode, 503);
  assert.equal(JSON.parse(liveEnabled.body).error.code, "PAPER_TRADING_ONLY");

  const missingSettingEnv = { ...serviceEnv };
  delete missingSettingEnv.ENABLE_LIVE_TRADING;
  const missingSetting = createResponse();
  await createPaperTradingHandler({
    env: missingSettingEnv,
    service: { runPaperTrading: async () => { executions += 1; return runResult; } },
    logger: { info() {}, error() {} }
  })({
    method: "POST",
    headers: { authorization: `Bearer ${serviceEnv.CRON_SECRET}` }
  }, missingSetting);
  assert.equal(missingSetting.statusCode, 503);
  assert.equal(JSON.parse(missingSetting.body).error.code, "PAPER_TRADING_ONLY");
  assert.equal(executions, 0);
});

test("paper trading endpoint returns structured run metrics without exposing configuration", async () => {
  const logs = [];
  const handler = createPaperTradingHandler({
    env: serviceEnv,
    service: {
      runPaperTrading: async ({ config, serviceRoleKey }) => {
        assert.equal(config.supabaseUrl, serviceEnv.SUPABASE_URL);
        assert.equal(serviceRoleKey, serviceEnv.SUPABASE_SERVICE_ROLE_KEY);
        return runResult;
      }
    },
    logger: { info: (...args) => logs.push(args), error() {} }
  });
  const response = createResponse();
  await handler({
    method: "POST",
    headers: { authorization: `Bearer ${serviceEnv.CRON_SECRET}` }
  }, response);

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(body.data, runResult);
  assert.equal(body.metrics.portfoliosProcessed, 2);
  assert.equal(body.metrics.decisionsProcessed, 10);
  assert.equal(body.metrics.tradesExecuted, 1);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(response.body, /server-only-test-key|test-cron-secret/);
});

test("paper trading endpoint fails closed when the database RPC fails", async () => {
  const errors = [];
  const handler = createPaperTradingHandler({
    env: serviceEnv,
    service: {
      runPaperTrading: async () => {
        throw new PaperTradingError("PAPER_TRADING_DATABASE_FAILED", "Private provider detail.");
      }
    },
    logger: { info() {}, error: (...args) => errors.push(args) }
  });
  const response = createResponse();
  await handler({
    method: "POST",
    headers: { authorization: `Bearer ${serviceEnv.CRON_SECRET}` }
  }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error.code, "PAPER_TRADING_UNAVAILABLE");
  assert.doesNotMatch(response.body, /Private provider detail|server-only-test-key/);
  assert.equal(errors[0][1], "PAPER_TRADING_DATABASE_FAILED");
});
