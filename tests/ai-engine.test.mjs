import assert from "node:assert/strict";
import test from "node:test";
import { createAIAnalysisHandler } from "../api/ai-analysis.mjs";
import { analyzeMarket, createAIEngineService } from "../lib/ai-engine.mjs";

const fixedNow = new Date("2026-03-20T12:00:00.000Z");
const config = {
  supabaseUrl: "https://supabase.example",
  supabaseAnonKey: "test-anon-key"
};
const serviceRoleKey = "test-service-role-key";
const activeMarket = { symbol: "BTC-EUR", enabled: true, priority: 1 };

function createCandles(symbol, interval, count = 60, direction = "up", now = fixedNow) {
  return Array.from({ length: count }, (_, index) => {
    const close = direction === "up"
      ? 100 + index * 0.5
      : direction === "down"
        ? 130 - index * 0.5
        : 100;
    const open = direction === "down" ? close + 0.1 : close - 0.1;
    return {
      symbol,
      interval,
      open,
      high: Math.max(open, close) + 0.3,
      low: Math.min(open, close) - 0.3,
      close,
      volume: 100 + index,
      timestamp: new Date(now.getTime() - (count - index) * 60_000).toISOString()
    };
  });
}

function createSnapshot(now = fixedNow, direction = "up") {
  return {
    symbol: "BTC-EUR",
    price: direction === "down" ? 100 : 130,
    volume: 159,
    daily_change: direction === "down" ? -5 : 5,
    high_24h: 135,
    low_24h: 95,
    captured_at: new Date(now.getTime() - 30_000).toISOString()
  };
}

function buildCandles(direction = "up", now = fixedNow, intervals = ["5m", "15m", "1h", "4h"]) {
  return intervals.flatMap((interval) => createCandles("BTC-EUR", interval, 60, direction, now));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function createEngineHarness({
  status = "IDLE",
  markets = [activeMarket],
  marketData = [createSnapshot()],
  candles = buildCandles(),
  failReadTable = null,
  logger = { info() {}, error() {} }
} = {}) {
  let statusRow = { status };
  const writes = [];
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const table = decodeURIComponent(url.pathname.split("/").pop());
    const method = options.method || "GET";
    requests.push({ table, method, url: url.toString() });

    if (method === "GET") {
      if (table === failReadTable) {
        return jsonResponse({ message: "provider detail must not be exposed" }, 503);
      }
      if (table === "AI_Crypto_Bot_Status") {
        return jsonResponse([statusRow]);
      }
      if (table === "AI_Crypto_Bot_Watched_Markets") {
        return jsonResponse(markets);
      }
      if (table === "AI_Crypto_Bot_Market_Data") {
        return jsonResponse(marketData);
      }
      if (table === "AI_Crypto_Bot_Candles") {
        const symbolFilter = url.searchParams.get("symbol");
        const symbol = symbolFilter?.startsWith("eq.") ? symbolFilter.slice(3) : null;
        return jsonResponse(candles.filter((candle) => !symbol || candle.symbol === symbol));
      }
      throw new Error(`Unexpected read table: ${table}`);
    }

    if (table === "AI_Crypto_Bot_Status" && method === "PATCH") {
      statusRow = { ...statusRow, ...JSON.parse(options.body) };
      writes.push({ table, method, body: JSON.parse(options.body) });
      return jsonResponse([statusRow]);
    }
    if (table === "AI_Crypto_Bot_AI_Decisions" && method === "POST") {
      const body = JSON.parse(options.body);
      writes.push({ table, method, body });
      return jsonResponse(body);
    }
    throw new Error(`Unexpected database operation: ${method} ${table}`);
  };
  const service = createAIEngineService({ fetchImpl, now: () => fixedNow, logger });
  return { service, writes, requests, getStatus: () => statusRow };
}

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = "") {
      this.body = body;
    }
  };
}

test("technical analysis exposes deterministic EMA, RSI, MACD, momentum, volume, and volatility", () => {
  const result = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: buildCandles(),
    now: fixedNow
  });
  const hourly = result.indicators.timeframes["1h"];

  assert.equal(result.symbol, "BTC-EUR");
  assert.equal(hourly.trend.direction, "bullish");
  assert.equal(typeof hourly.trend.ema12, "number");
  assert.equal(typeof hourly.rsi14, "number");
  assert.equal(typeof hourly.macd.histogram, "number");
  assert.equal(typeof hourly.momentum.changePct, "number");
  assert.equal(typeof hourly.volume.ratio, "number");
  assert.equal(typeof hourly.volatility.atrPct, "number");
  assert.equal(result.indicators.marketData.rangePositionPct, 87.5);
  assert.equal(result.indicators.dataQuality.sufficientForDirectionalSignal, true);
});

test("strong rising and falling data produce directional decisions", () => {
  const rising = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(fixedNow, "up"),
    candles: buildCandles("up"),
    now: fixedNow
  });
  const falling = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(fixedNow, "down"),
    candles: buildCandles("down"),
    now: fixedNow
  });

  assert.equal(rising.decision, "BUY");
  assert.equal(falling.decision, "SELL");
  assert.ok(rising.confidence >= 65 && rising.confidence <= 95);
  assert.ok(falling.confidence >= 65 && falling.confidence <= 95);
});

test("momentum, volume changes, and volatility are reflected in indicator output", () => {
  const candles = buildCandles();
  const hourlyCandles = candles.filter((candle) => candle.interval === "1h");
  hourlyCandles.at(-1).volume = 1000;
  for (const candle of hourlyCandles.slice(-15)) {
    candle.high += 5;
    candle.low -= 5;
  }
  const result = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles,
    now: fixedNow
  });
  const hourly = result.indicators.timeframes["1h"];

  assert.ok(hourly.momentum.changePct > 0);
  assert.equal(hourly.momentum.direction, "weakening");
  assert.equal(hourly.volume.classification, "increasing");
  assert.equal(hourly.volatility.level, "high");

  const acceleratingCandles = createCandles("BTC-EUR", "1h").map((candle, index) => {
    const close = 100 + index * index * 0.01;
    return {
      ...candle,
      open: close - 0.1,
      high: close + 0.3,
      low: close - 0.3,
      close
    };
  });
  const acceleratingResult = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: [...buildCandles(), ...acceleratingCandles],
    now: fixedNow
  });
  assert.equal(acceleratingResult.indicators.timeframes["1h"].momentum.direction, "accelerating");
});

test("neutral data produces HOLD rather than a directional signal", () => {
  const result = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: { ...createSnapshot(), daily_change: 0 },
    candles: buildCandles("flat"),
    now: fixedNow
  });

  assert.equal(result.decision, "HOLD");
});

test("missing and partial candles fail safely with WAIT or reduced-confidence HOLD", () => {
  const noCandles = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: [],
    now: fixedNow
  });
  const partialCandles = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: buildCandles("up", fixedNow, ["1h", "4h"]),
    now: fixedNow
  });

  assert.equal(noCandles.decision, "WAIT");
  assert.ok(noCandles.confidence < 50);
  assert.equal(noCandles.indicators.dataQuality.candleCoverage, 0);
  assert.equal(partialCandles.decision, "HOLD");
  assert.ok(partialCandles.confidence <= 64);
  assert.deepEqual(partialCandles.indicators.dataQuality.candleIntervalsAvailable, ["1h", "4h"]);
});

test("stale snapshots and invalid candle records cannot produce directional signals", () => {
  const staleSnapshot = {
    ...createSnapshot(new Date(fixedNow.getTime() - 60 * 60 * 1000)),
    captured_at: new Date(fixedNow.getTime() - 60 * 60 * 1000).toISOString()
  };
  const invalidCandles = buildCandles().map((candle) => ({ ...candle }));
  invalidCandles[0].high = 0;
  const staleResult = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: staleSnapshot,
    candles: buildCandles(),
    now: fixedNow
  });
  const invalidResult = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: invalidCandles,
    now: fixedNow
  });

  assert.equal(staleResult.decision, "WAIT");
  assert.equal(staleResult.indicators.marketData.stale, true);
  const missingSnapshotResult = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: null,
    candles: buildCandles(),
    now: fixedNow
  });
  assert.equal(missingSnapshotResult.decision, "WAIT");
  assert.equal(invalidResult.indicators.dataQuality.invalidCandlesIgnored, 1);
});

test("analysis persists real decisions and updates status with PATCH", async () => {
  const harness = createEngineHarness();
  const result = await harness.service.runAnalysis({ config, serviceRoleKey });
  const decisionWrite = harness.writes.find(({ table }) => table === "AI_Crypto_Bot_AI_Decisions");
  const statusWrites = harness.writes.filter(({ table }) => table === "AI_Crypto_Bot_Status");

  assert.equal(result.status, "ACTIVE");
  assert.equal(result.analyzedMarkets, 1);
  assert.equal(result.decisionsStored, 1);
  assert.equal(decisionWrite.method, "POST");
  assert.equal(decisionWrite.body[0].decision, "BUY");
  assert.equal(decisionWrite.body[0].strategy_name, "Deterministic Technical Analysis");
  assert.ok(statusWrites.length >= 2);
  assert.ok(statusWrites.every(({ method }) => method === "PATCH"));
  assert.ok(statusWrites.every(({ body }) => body.updated_at));
  assert.equal(harness.getStatus().status, "ACTIVE");
  assert.deepEqual(
    harness.writes.map(({ table }) => table).filter((table) =>
      table.includes("Trade") || table.includes("Position") || table.includes("Portfolio")
    ),
    []
  );
});

test("analysis stores WAIT decisions when market data exists but candles are absent", async () => {
  const harness = createEngineHarness({ candles: [] });
  const result = await harness.service.runAnalysis({ config, serviceRoleKey });
  const decisionWrite = harness.writes.find(({ table }) => table === "AI_Crypto_Bot_AI_Decisions");

  assert.equal(result.decisionsStored, 1);
  assert.equal(result.waitingDecisions, 1);
  assert.equal(decisionWrite.body[0].decision, "WAIT");
  assert.ok(decisionWrite.body[0].confidence < 50);
  assert.equal(harness.getStatus().status, "ACTIVE");
});

test("STOPPED agent status prevents reads and all writes beyond the status check", async () => {
  const harness = createEngineHarness({ status: "STOPPED" });
  const result = await harness.service.runAnalysis({ config, serviceRoleKey });

  assert.deepEqual(result, {
    status: "STOPPED",
    skipped: true,
    analyzedMarkets: 0,
    decisionsStored: 0
  });
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.requests.length, 1);
});

test("empty watched-market universe returns agent to IDLE without decisions", async () => {
  const harness = createEngineHarness({ markets: [] });
  const result = await harness.service.runAnalysis({ config, serviceRoleKey });

  assert.equal(result.status, "IDLE");
  assert.equal(result.decisionsStored, 0);
  assert.equal(harness.getStatus().status, "IDLE");
  assert.equal(harness.writes.some(({ table }) => table === "AI_Crypto_Bot_AI_Decisions"), false);
});

test("database failure is surfaced and attempts to persist ERROR status", async () => {
  const harness = createEngineHarness({ failReadTable: "AI_Crypto_Bot_Market_Data" });

  await assert.rejects(
    harness.service.runAnalysis({ config, serviceRoleKey }),
    (error) => error.code === "DATABASE_READ_FAILED"
  );
  assert.equal(harness.getStatus().status, "ERROR");
  assert.ok(harness.writes.some(({ table, body }) =>
    table === "AI_Crypto_Bot_Status" && body.status === "ERROR"
  ));
});

test("AI analysis endpoint rejects methods, missing configuration, and unauthorized schedulers", async () => {
  let serviceCalls = 0;
  const service = {
    async runAnalysis() {
      serviceCalls += 1;
      return { status: "ACTIVE", analyzedMarkets: 1, decisionsStored: 1 };
    }
  };
  const env = {
    CRON_SECRET: "test-cron-secret",
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_ANON_KEY: config.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
  };
  const handler = createAIAnalysisHandler({ env, service, logger: { error() {} } });

  const methodResponse = createResponse();
  await handler({ method: "GET", headers: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, "POST");

  const unauthorizedResponse = createResponse();
  await handler({ method: "POST", headers: { authorization: "Bearer wrong" } }, unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.equal(serviceCalls, 0);

  const missingConfigResponse = createResponse();
  await createAIAnalysisHandler({
    env: { CRON_SECRET: env.CRON_SECRET },
    service,
    logger: { error() {} }
  })({ method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, missingConfigResponse);
  assert.equal(missingConfigResponse.statusCode, 503);
  assert.equal(JSON.parse(missingConfigResponse.body).error.code, "AI_ENGINE_NOT_CONFIGURED");
  assert.equal(serviceCalls, 0);
});

test("AI analysis endpoint returns successful data and hides runtime error details", async () => {
  const env = {
    CRON_SECRET: "test-cron-secret",
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_ANON_KEY: config.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
  };
  const successfulHandler = createAIAnalysisHandler({
    env,
    service: { async runAnalysis() { return { status: "ACTIVE", analyzedMarkets: 1, decisionsStored: 1 }; } },
    logger: { error() {} }
  });
  const successResponse = createResponse();
  await successfulHandler({
    method: "POST",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` }
  }, successResponse);
  assert.equal(successResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(successResponse.body).data, {
    status: "ACTIVE",
    analyzedMarkets: 1,
    decisionsStored: 1
  });

  const failingHandler = createAIAnalysisHandler({
    env,
    service: { async runAnalysis() { throw new Error("sensitive provider detail"); } },
    logger: { error() {} }
  });
  const failureResponse = createResponse();
  await failingHandler({
    method: "POST",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` }
  }, failureResponse);
  assert.equal(failureResponse.statusCode, 503);
  assert.equal(JSON.parse(failureResponse.body).error.code, "AI_ANALYSIS_UNAVAILABLE");
  assert.equal(failureResponse.body.includes("sensitive provider detail"), false);
});
