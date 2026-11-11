import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_ANALYSIS_INTERVALS,
  AI_DECISION_INTERVAL,
  analyzeMarket,
  calculateEma,
  calculateMacd,
  calculateRsi
} from "../src/services/ai-engine.mjs";
import { createAiAnalysisService } from "../src/services/ai-analysis-service.mjs";
import { createDeterministicDecisionId } from "../src/services/ai-decision-identity.mjs";
import { readRuntimeConfig } from "../src/config/runtime-config.mjs";
import {
  createAiAnalysisDatabaseConfig,
  createFailureDiagnostic
} from "../src/analyze-ai.mjs";

const fixedNow = new Date("2026-03-20T12:00:00.000Z");
const symbols = ["BTC-EUR", "ETH-EUR", "SOL-EUR", "ADA-EUR", "XRP-EUR"];

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

function createSnapshot(symbol = "BTC-EUR", now = fixedNow, direction = "up") {
  return {
    symbol,
    price: direction === "down" ? 100 : 130,
    volume: 159,
    daily_change: direction === "down" ? -5 : 5,
    high_24h: 135,
    low_24h: 95,
    captured_at: new Date(now.getTime() - 30_000).toISOString()
  };
}

function buildCandles(symbol = "BTC-EUR", direction = "up", now = fixedNow,
  intervals = ["5m", "15m", "1h", "4h", "1d"]) {
  return intervals.flatMap((interval) => createCandles(symbol, interval, 60, direction, now));
}

function makeMarket(symbol, priority) {
  return {
    id: `00000000-0000-0000-0000-${String(priority).padStart(12, "0")}`,
    symbol,
    enabled: true,
    priority
  };
}

function createServiceFixture({
  marketSymbols = ["BTC-EUR"],
  missingCandlesFor = [],
  invalidCandleFor = [],
  failInterval = null
} = {}) {
  const markets = marketSymbols.map((symbol, index) => makeMarket(symbol, index + 1));
  const candles = new Map(marketSymbols.map((symbol) =>
    [symbol, buildCandles(symbol)]
  ));
  for (const symbol of missingCandlesFor) {
    candles.set(symbol, []);
  }
  for (const symbol of invalidCandleFor) {
    const existing = candles.get(symbol);
    existing.push({
      ...createCandles(symbol, "1h", 1)[0],
      close: "invalid"
    });
  }
  const calls = [];
  const persisted = [];
  let persistCalls = 0;
  const watchedMarketsRepository = {
    async listEnabled() {
      return markets;
    }
  };
  const aiAnalysisRepository = {
    async listSnapshots(requestedSymbols) {
      return requestedSymbols.map((symbol) => createSnapshot(symbol));
    },
    async listLatestCandles(requestedSymbols, interval, { limit }) {
      calls.push({ symbols: [...requestedSymbols], interval, limit });
      if (interval === failInterval) {
        throw new Error("database failure");
      }
      return requestedSymbols.flatMap((symbol) =>
        candles.get(symbol).filter((candle) => candle.interval === interval)
      );
    },
    async insertDecisions(decisions) {
      persistCalls += 1;
      persisted.push(decisions);
      return { stored: decisions.length, duplicates: 0 };
    }
  };
  return {
    service: createAiAnalysisService({
      watchedMarketsRepository,
      aiAnalysisRepository,
      now: () => fixedNow
    }),
    calls,
    persisted,
    get persistCalls() {
      return persistCalls;
    }
  };
}

test("Pi V2 analysis returns the expected directional and safe outcomes", () => {
  const scenarios = [
    { direction: "up", market: createSnapshot("BTC-EUR", fixedNow, "up"), candles: buildCandles() },
    { direction: "down", market: createSnapshot("BTC-EUR", fixedNow, "down"), candles: buildCandles("BTC-EUR", "down") },
    { direction: "flat", market: createSnapshot(), candles: buildCandles("BTC-EUR", "flat") },
    { direction: "partial", market: createSnapshot(), candles: buildCandles("BTC-EUR", "up", fixedNow, ["1h", "1d"]) },
    { direction: "empty", market: createSnapshot(), candles: [] },
    {
      direction: "stale",
      market: createSnapshot("BTC-EUR", new Date(fixedNow.getTime() - 60 * 60 * 1000)),
      candles: buildCandles("BTC-EUR", "up", fixedNow)
        .map((candle) => ({ ...candle, timestamp: new Date(fixedNow.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString() }))
    }
  ];

  const expectedDecisions = ["BUY", "SELL", "HOLD", "HOLD", "WAIT", "WAIT"];
  for (const [index, { market, candles }] of scenarios.entries()) {
    const actual = analyzeMarket({
      symbol: "BTC-EUR",
      marketData: market,
      candles,
      now: fixedNow
    });
    assert.equal(actual.decision, expectedDecisions[index]);
    assert.equal(actual.interval, AI_DECISION_INTERVAL);
    assert.equal(actual.timestamp, fixedNow.toISOString());
    assert.equal(actual.indicators.interval, AI_DECISION_INTERVAL);
  }
});

test("EMA, RSI, and MACD validate history and use deterministic values", () => {
  assert.equal(calculateEma([1, 2, 3, 4], 3), 3);
  assert.equal(calculateEma([1, 2], 3), null);
  assert.equal(calculateEma([1, Number.NaN, 3], 2), null);
  assert.equal(calculateRsi(Array.from({ length: 15 }, (_, index) => index + 1)), 100);
  assert.equal(calculateRsi(Array.from({ length: 15 }, (_, index) => 15 - index)), 0);
  assert.equal(calculateRsi(Array(15).fill(10)), 50);
  assert.deepEqual(calculateMacd(Array(33).fill(1)), {
    line: null,
    signal: null,
    histogram: null
  });
  assert.equal(typeof calculateMacd(Array.from({ length: 60 }, (_, index) => 100 + index)).histogram, "number");
});

test("AI service analyzes enabled markets in bounded multi-interval batches and persists once", async () => {
  const fixture = createServiceFixture({ marketSymbols: symbols });
  const result = await fixture.service.run();

  assert.equal(result.analyzedMarkets, symbols.length);
  assert.equal(result.decisionsStored, symbols.length);
  assert.equal(fixture.persistCalls, 1);
  assert.equal(fixture.persisted[0].length, symbols.length);
  assert.ok(fixture.calls.every(({ symbols: batchSymbols, limit }) => batchSymbols.length <= 4 && limit === 150));
  assert.deepEqual(fixture.calls.map(({ interval }) => interval),
    [...AI_ANALYSIS_INTERVALS, ...AI_ANALYSIS_INTERVALS]);
  assert.ok(fixture.persisted[0].every((decision) =>
    decision.interval === "1d" && decision.indicators.interval === "1d"));
});

test("identical stored inputs produce stable deterministic decision IDs", async () => {
  const first = createServiceFixture();
  const second = createServiceFixture();
  await first.service.run();
  await second.service.run();
  assert.equal(first.persisted[0][0].id, second.persisted[0][0].id);
  assert.match(first.persisted[0][0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(
    createDeterministicDecisionId({ b: 2, a: 1 }),
    createDeterministicDecisionId({ a: 1, b: 2 })
  );
});

test("missing and invalid candle inputs generate safe WAIT decisions", async () => {
  const missing = createServiceFixture({ missingCandlesFor: ["BTC-EUR"] });
  const missingResult = await missing.service.run();
  assert.equal(missingResult.waitCount, 1);
  assert.equal(missing.persisted[0][0].decision, "WAIT");

  const invalid = createServiceFixture({ invalidCandleFor: ["BTC-EUR"] });
  await invalid.service.run();
  assert.equal(invalid.persisted[0][0].indicators.dataQuality.invalidCandlesIgnored, 1);
});

test("AI analysis fails the complete run before persistence when a candle query fails", async () => {
  const fixture = createServiceFixture({ failInterval: "15m" });
  await assert.rejects(fixture.service.run(), /database failure/);
  assert.equal(fixture.persistCalls, 0);
});

test("AI database configuration requires a separate writer identity", () => {
  const env = {
    DATABASE_HOST: "127.0.0.1",
    DATABASE_NAME: "cryptopulse",
    DATABASE_USER: "runtime_reader",
    DATABASE_PASSWORD: "reader-password",
    DASHBOARD_USERNAME: "operator",
    DASHBOARD_PASSWORD_HASH: "$2a$10$mqVzXb8xEv/4khOjtskpme6LMSS9d/BQTwDX/LLAm7ig6xKOgptea",
    DATABASE_SSL: "false",
    AI_DATABASE_USER: "ai_writer",
    AI_DATABASE_PASSWORD: "writer-password"
  };
  const config = readRuntimeConfig(env);
  assert.equal(createAiAnalysisDatabaseConfig(config, env).database.user, "ai_writer");
  assert.throws(() => createAiAnalysisDatabaseConfig(
    readRuntimeConfig({ ...env, AI_DATABASE_USER: "", AI_DATABASE_PASSWORD: "" }),
    { ...env, AI_DATABASE_USER: "", AI_DATABASE_PASSWORD: "" }
  ), /AI_DATABASE_USER and AI_DATABASE_PASSWORD/);
  assert.throws(() => createAiAnalysisDatabaseConfig(
    readRuntimeConfig({ ...env, AI_DATABASE_USER: "runtime_reader" }),
    { ...env, AI_DATABASE_USER: "runtime_reader" }
  ), /distinct from the API and ingestion database users/);
  assert.throws(() => createAiAnalysisDatabaseConfig(
    config,
    { ...env, INGESTION_DATABASE_USER: "ai_writer" }
  ), /distinct from the API and ingestion database users/);
});

test("AI failure diagnostics validate error codes and never crash on missing codes", () => {
  const cause = Object.assign(new Error("database denied"), { code: "42501" });
  const error = Object.assign(new Error("internal error details"), {
    code: "AI_ANALYSIS_FAILED",
    cause
  });
  const diagnostic = createFailureDiagnostic(error, "ai-analysis", { NODE_ENV: "production" });

  assert.equal(diagnostic.code, "AI_ANALYSIS_FAILED");
  assert.equal(diagnostic.causeCode, "42501");
  assert.equal(diagnostic.category, "ai_analysis");
  assert.equal(diagnostic.message, "AI analysis failed; consult the error code and component.");
  assert.equal("stack" in diagnostic, false);

  const missingCode = createFailureDiagnostic(new Error("not exposed"), "ai-analysis", {});
  assert.equal(missingCode.code, "AI_ANALYSIS_FAILED");
  assert.equal("stack" in missingCode, false);

  const development = createFailureDiagnostic(
    new Error("development failure"),
    "ai-analysis",
    { NODE_ENV: "development" }
  );
  assert.equal(typeof development.stack, "string");
  assert.ok(development.stack.includes("development failure"));
});
