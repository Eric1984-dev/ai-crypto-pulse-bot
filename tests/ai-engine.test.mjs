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
const latestCandlesRpc = "AI_Crypto_Bot_Get_Latest_AI_Candles_Compact";

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

function setLatestCandleAge(candles, ageMs) {
  const latestTimestamp = fixedNow.getTime() - ageMs;
  return candles.map((candle, index) => ({
    ...candle,
    timestamp: new Date(latestTimestamp - (candles.length - index - 1) * 60_000).toISOString()
  }));
}

function simulateLegacyCandleReads(candles, symbols, interval) {
  const marketCounts = new Map(symbols.map((symbol) => [symbol, 0]));
  let activeSymbols = [...symbols];
  let offset = 0;
  let requests = 0;
  let returnedRows = 0;

  while (activeSymbols.length) {
    requests += 1;
    const rows = candles
      .filter((candle) => activeSymbols.includes(candle.symbol) && candle.interval === interval)
      .sort((left, right) => left.symbol.localeCompare(right.symbol)
        || Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(offset, offset + 1000);
    returnedRows += rows.length;
    for (const row of rows) {
      if (marketCounts.get(row.symbol) < 150) {
        marketCounts.set(row.symbol, marketCounts.get(row.symbol) + 1);
      }
    }

    if (rows.length < 1000) {
      break;
    }
    const incompleteSymbols = activeSymbols.filter((symbol) => marketCounts.get(symbol) < 150);
    if (incompleteSymbols.length === activeSymbols.length) {
      offset += rows.length;
    } else {
      activeSymbols = incompleteSymbols;
      offset = activeSymbols.reduce((total, symbol) => total + marketCounts.get(symbol), 0);
    }
  }
  return { requests, returnedRows };
}

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      }
    },
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
  candleDelayMs = 0,
  postgrestMaxRows = Number.POSITIVE_INFINITY,
  includeCandleContentRange = true,
  candleResponseTransform = (groups) => groups,
  logger = { info() {}, error() {} }
} = {}) {
  let statusRow = { status };
  const writes = [];
  const requests = [];
  let activeCandleRequests = 0;
  let maxActiveCandleRequests = 0;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const table = decodeURIComponent(url.pathname.split("/").pop());
    const method = options.method || "GET";
    const request = {
      table,
      method,
      url: url.toString(),
      body: options.body,
      headers: options.headers
    };
    requests.push(request);

    const isCandleRead = method === "POST" && table === latestCandlesRpc;
    if (isCandleRead) {
      activeCandleRequests += 1;
      maxActiveCandleRequests = Math.max(maxActiveCandleRequests, activeCandleRequests);
      if (candleDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, candleDelayMs));
      }
    }

    try {
      if (table === failReadTable) {
        return jsonResponse({ message: "provider detail must not be exposed" }, 503);
      }
      if (method === "POST" && table === latestCandlesRpc) {
        const { p_symbols: symbols, p_interval: interval } = JSON.parse(options.body);
        const groups = symbols.map((symbol) => ({
          symbol,
          candles: candles
            .filter((candle) => candle.symbol === symbol && candle.interval === interval)
            .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
            .slice(0, 150)
            .map(({ timestamp, open, high, low, close, volume }) =>
              [timestamp, open, high, low, close, volume])
        }));
        const responseGroups = candleResponseTransform(groups.slice(0, postgrestMaxRows));
        request.responseGroups = Array.isArray(responseGroups) ? responseGroups.length : null;
        request.responseCandleRows = Array.isArray(responseGroups)
          ? responseGroups.reduce((total, group) =>
            total + (Array.isArray(group && group.candles) ? group.candles.length : 0), 0)
          : null;
        const headers = includeCandleContentRange
          ? { "content-range": `0-${responseGroups.length - 1}/${groups.length}` }
          : {};
        const status = responseGroups.length < groups.length ? 206 : 200;
        return jsonResponse(responseGroups, status, headers);
      }
      if (method === "GET") {
        if (table === "AI_Crypto_Bot_Status") {
          return jsonResponse([statusRow]);
        }
        if (table === "AI_Crypto_Bot_Watched_Markets") {
          return jsonResponse(markets);
        }
        if (table === "AI_Crypto_Bot_Market_Data") {
          return jsonResponse(marketData);
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
    } finally {
      if (isCandleRead) {
        activeCandleRequests -= 1;
      }
    }
  };
  const service = createAIEngineService({ fetchImpl, now: () => fixedNow, logger });
  return {
    service,
    writes,
    requests,
    getStatus: () => statusRow,
    getMaxActiveCandleRequests: () => maxActiveCandleRequests
  };
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

test("candle freshness thresholds are inclusive and apply to the latest candle per timeframe", () => {
  const maxAgeByInterval = {
    "1m": 30 * 60 * 1000,
    "5m": 2 * 60 * 60 * 1000,
    "15m": 6 * 60 * 60 * 1000,
    "1h": 12 * 60 * 60 * 1000,
    "4h": 24 * 60 * 60 * 1000,
    "1d": 72 * 60 * 60 * 1000
  };

  for (const [interval, maxAgeMs] of Object.entries(maxAgeByInterval)) {
    const candles = createCandles("BTC-EUR", interval);
    const freshResult = analyzeMarket({
      symbol: "BTC-EUR",
      marketData: createSnapshot(),
      candles: setLatestCandleAge(candles, maxAgeMs),
      now: fixedNow
    });
    const staleResult = analyzeMarket({
      symbol: "BTC-EUR",
      marketData: createSnapshot(),
      candles: setLatestCandleAge(candles, maxAgeMs + 1),
      now: fixedNow
    });

    assert.deepEqual(
      freshResult.indicators.dataQuality.candleIntervalsAvailable,
      [interval],
      `${interval} should be fresh at its maximum age`
    );
    assert.deepEqual(freshResult.indicators.dataQuality.staleCandleIntervals, []);
    assert.equal(freshResult.indicators.timeframes[interval].analyzedCandleCount, 60);
    assert.deepEqual(
      staleResult.indicators.dataQuality.candleIntervalsAvailable,
      [],
      `${interval} should be stale one millisecond beyond its maximum age`
    );
    assert.deepEqual(staleResult.indicators.dataQuality.staleCandleIntervals, [interval]);
    assert.equal(staleResult.indicators.timeframes[interval].analyzedCandleCount, 0);
    assert.equal(staleResult.indicators.dataQuality.staleCandlesIgnored, 60);
    assert.equal(staleResult.decision, "WAIT");
    assert.equal(staleResult.reason, "STALE_CANDLE_DATA");
  }

  const recentOneMinuteRows = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: createCandles("BTC-EUR", "1m"),
    now: fixedNow
  });
  assert.equal(recentOneMinuteRows.indicators.timeframes["1m"].candleCount, 60);
  assert.equal(recentOneMinuteRows.indicators.timeframes["1m"].analyzedCandleCount, 60);
  assert.equal(recentOneMinuteRows.indicators.timeframes["1m"].stale, false);
});

test("stale timeframes are excluded while sufficient fresh timeframes retain existing calculations", () => {
  const freshCandles = buildCandles();
  const staleMinuteCandles = setLatestCandleAge(
    createCandles("BTC-EUR", "1m"),
    30 * 60 * 1000 + 1
  );
  const baseline = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: freshCandles,
    now: fixedNow
  });
  const withStaleTimeframe = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: [...freshCandles, ...staleMinuteCandles],
    now: fixedNow
  });

  assert.equal(withStaleTimeframe.decision, baseline.decision);
  assert.equal(withStaleTimeframe.confidence, baseline.confidence);
  assert.equal(withStaleTimeframe.indicators.marketStrength, baseline.indicators.marketStrength);
  assert.deepEqual(withStaleTimeframe.indicators.dataQuality.candleIntervalsAvailable, [
    "5m", "15m", "1h", "4h"
  ]);
  assert.deepEqual(withStaleTimeframe.indicators.dataQuality.staleCandleIntervals, ["1m"]);
  assert.equal(withStaleTimeframe.indicators.timeframes["1m"].stale, true);
  assert.equal(withStaleTimeframe.indicators.timeframes["1m"].analyzedCandleCount, 0);
});

test("insufficient fresh timeframes wait with the stale candle reason", () => {
  const freshFiveMinuteCandles = setLatestCandleAge(
    createCandles("BTC-EUR", "5m"),
    60_000
  );
  const staleFifteenMinuteCandles = setLatestCandleAge(
    createCandles("BTC-EUR", "15m"),
    6 * 60 * 60 * 1000 + 1
  );
  const result = analyzeMarket({
    symbol: "BTC-EUR",
    marketData: createSnapshot(),
    candles: [...freshFiveMinuteCandles, ...staleFifteenMinuteCandles],
    now: fixedNow
  });

  assert.equal(result.decision, "WAIT");
  assert.equal(result.reason, "STALE_CANDLE_DATA");
  assert.deepEqual(result.indicators.dataQuality.candleIntervalsAvailable, ["5m"]);
  assert.deepEqual(result.indicators.dataQuality.staleCandleIntervals, ["15m"]);
});

test("AI candle RPC reads every interval without PostgREST global-row truncation", async () => {
  const candleCounts = {
    "1m": 549,
    "5m": 510,
    "15m": 518,
    "1h": 501,
    "4h": 500,
    "1d": 500
  };
  const candles = Object.entries(candleCounts).flatMap(([interval, count]) =>
    createCandles("BTC-EUR", interval, count)
  );
  const harness = createEngineHarness({ candles });
  await harness.service.runAnalysis({ config, serviceRoleKey });

  const decision = harness.writes.find(({ table }) => table === "AI_Crypto_Bot_AI_Decisions").body[0];
  const candleRequests = harness.requests
    .filter(({ table }) => table === latestCandlesRpc);

  assert.deepEqual(decision.indicators.dataQuality.candleIntervalsAvailable, [
    "1m", "5m", "15m", "1h", "4h", "1d"
  ]);
  for (const [interval, count] of Object.entries(candleCounts)) {
    assert.equal(decision.indicators.timeframes[interval].candleCount, Math.min(count, 150));
  }
  assert.equal(candleRequests.length, 6);
  assert.deepEqual(
    candleRequests.map(({ body }) => JSON.parse(body).p_interval).sort(),
    Object.keys(candleCounts).sort()
  );
  assert.ok(candleRequests.every(({ body }) => (
    JSON.stringify(JSON.parse(body).p_symbols) === JSON.stringify(["BTC-EUR"])
  )));
  assert.equal(candleRequests.reduce((total, { responseCandleRows }) =>
    total + responseCandleRows, 0), 900);
  const legacyMetrics = Object.keys(candleCounts).reduce((total, interval) => {
    const intervalMetrics = simulateLegacyCandleReads(candles, ["BTC-EUR"], interval);
    return {
      requests: total.requests + intervalMetrics.requests,
      returnedRows: total.returnedRows + intervalMetrics.returnedRows
    };
  }, { requests: 0, returnedRows: 0 });
  assert.deepEqual(legacyMetrics, { requests: 6, returnedRows: 3078 });
  assert.equal(candleRequests.length, 6);
});

test("AI candle RPC requests exact counts and rejects incomplete or uncounted responses", async () => {
  const markets = ["ALPHA-EUR", "BETA-EUR", "GAMMA-EUR", "DELTA-EUR"].map((symbol, index) => ({
    symbol,
    enabled: true,
    priority: index + 1
  }));
  const marketData = markets.map((market) => ({
    ...createSnapshot(),
    symbol: market.symbol
  }));
  const candles = markets.flatMap(({ symbol }) => createCandles(symbol, "1m", 150));
  const truncatedHarness = createEngineHarness({
    markets,
    marketData,
    candles,
    postgrestMaxRows: 2
  });

  await assert.rejects(
    truncatedHarness.service.runAnalysis({ config, serviceRoleKey }),
    { code: "INVALID_DATABASE_RESPONSE" }
  );
  const candleRequest = truncatedHarness.requests.find(({ table }) => table === latestCandlesRpc);
  assert.equal(candleRequest.headers.prefer, "count=exact");
  assert.equal(candleRequest.responseGroups, 2);
  assert.equal(candleRequest.responseCandleRows, 300);
  assert.equal(
    truncatedHarness.writes.some(({ table }) => table === "AI_Crypto_Bot_AI_Decisions"),
    false
  );

  const uncountedHarness = createEngineHarness({
    includeCandleContentRange: false
  });
  await assert.rejects(
    uncountedHarness.service.runAnalysis({ config, serviceRoleKey }),
    { code: "INVALID_DATABASE_RESPONSE" }
  );
  assert.equal(
    uncountedHarness.writes.some(({ table }) => table === "AI_Crypto_Bot_AI_Decisions"),
    false
  );
});

test("AI candle RPC rejects malformed compact groups and candle tuples", async () => {
  const malformedHarness = createEngineHarness({
    candleResponseTransform(groups) {
      return groups.map((group) => ({
        ...group,
        candles: group.candles.map((candle) => candle.slice(0, 5))
      }));
    }
  });
  await assert.rejects(
    malformedHarness.service.runAnalysis({ config, serviceRoleKey }),
    { code: "INVALID_DATABASE_RESPONSE" }
  );
  assert.equal(
    malformedHarness.writes.some(({ table }) => table === "AI_Crypto_Bot_AI_Decisions"),
    false
  );

  const mismatchedSymbolHarness = createEngineHarness({
    candleResponseTransform(groups) {
      return groups.map((group, index) => index === 0
        ? { ...group, symbol: "ETH-EUR" }
        : group);
    }
  });
  await assert.rejects(
    mismatchedSymbolHarness.service.runAnalysis({ config, serviceRoleKey }),
    { code: "INVALID_DATABASE_RESPONSE" }
  );
});

test("AI candle RPC returns no more than 150 latest rows for each requested market", async () => {
  const markets = ["ALPHA-EUR", "BETA-EUR", "GAMMA-EUR", "DELTA-EUR"].map((symbol, index) => ({
    symbol,
    enabled: true,
    priority: index + 1
  }));
  const marketData = markets.map((market) => ({
    ...createSnapshot(),
    symbol: market.symbol
  }));
  const candles = markets.flatMap(({ symbol }) => createCandles(symbol, "1m", 300));
  const logEntries = [];
  const harness = createEngineHarness({
    markets,
    marketData,
    candles,
    logger: {
      info(message, fields) {
        logEntries.push({ message, fields });
      },
      error() {}
    }
  });
  await harness.service.runAnalysis({ config, serviceRoleKey });

  const decisions = harness.writes
    .find(({ table }) => table === "AI_Crypto_Bot_AI_Decisions").body;
  const candleRequests = harness.requests.filter(({ table, body }) => (
    table === latestCandlesRpc && JSON.parse(body).p_interval === "1m"
  ));

  assert.equal(candleRequests.length, 1);
  assert.deepEqual(JSON.parse(candleRequests[0].body), {
    p_symbols: ["ALPHA-EUR", "BETA-EUR", "GAMMA-EUR", "DELTA-EUR"],
    p_interval: "1m"
  });
  assert.equal(candleRequests[0].responseGroups, 4);
  assert.equal(candleRequests[0].responseCandleRows, 600);
  assert.deepEqual(
    simulateLegacyCandleReads(candles, markets.map(({ symbol }) => symbol), "1m"),
    { requests: 2, returnedRows: 1200 }
  );
  assert.equal(decisions.reduce((total, { indicators }) =>
    total + indicators.timeframes["1m"].candleCount, 0), 600);
  assert.deepEqual(
    decisions.map(({ indicators }) => indicators.timeframes["1m"].candleCount),
    [150, 150, 150, 150]
  );
  assert.equal(logEntries[0].fields.candleReads, 24);
  assert.equal(logEntries[0].fields.candleQueries, 6);
});

test("analysis caps each batched market at its latest 150 candles", async () => {
  const candleCounts = {
    "ALPHA-EUR": 1205,
    "BETA-EUR": 20,
    "DELTA-EUR": 10,
    "GAMMA-EUR": 40
  };
  const markets = Object.keys(candleCounts).map((symbol, index) => ({
    symbol,
    enabled: true,
    priority: index + 1
  }));
  const marketData = markets.map((market) => ({
    ...createSnapshot(),
    symbol: market.symbol
  }));
  const candles = Object.entries(candleCounts).flatMap(([symbol, count]) =>
    createCandles(symbol, "1m", count)
  );
  const harness = createEngineHarness({ markets, marketData, candles });
  await harness.service.runAnalysis({ config, serviceRoleKey });

  const decisions = harness.writes
    .find(({ table }) => table === "AI_Crypto_Bot_AI_Decisions").body;
  const expectedDecisions = markets.map(({ symbol }) => {
    const marketCandles = candles
      .filter((candle) => candle.symbol === symbol)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 150);
    return analyzeMarket({
      symbol,
      marketData: marketData.find((row) => row.symbol === symbol),
      candles: marketCandles,
      now: fixedNow
    });
  });
  const candleRequests = harness.requests
    .filter(({ table, body }) => table === latestCandlesRpc
      && JSON.parse(body).p_interval === "1m");

  assert.equal(candleRequests.length, 1);
  assert.deepEqual(JSON.parse(candleRequests[0].body), {
    p_symbols: ["ALPHA-EUR", "BETA-EUR", "DELTA-EUR", "GAMMA-EUR"],
    p_interval: "1m"
  });
  assert.equal(candleRequests[0].responseGroups, 4);
  assert.equal(candleRequests[0].responseCandleRows, 220);
  assert.deepEqual(
    simulateLegacyCandleReads(candles, markets.map(({ symbol }) => symbol), "1m"),
    { requests: 2, returnedRows: 1070 }
  );
  assert.deepEqual(
    decisions.map(({ indicators }) => indicators.timeframes["1m"].candleCount),
    [150, 20, 10, 40]
  );
  assert.equal(decisions.reduce((total, { indicators }) =>
    total + indicators.timeframes["1m"].candleCount, 0), 220);
  assert.equal(JSON.stringify(decisions), JSON.stringify(expectedDecisions));
});

test("150-row cap preserves latest-candle freshness classification", async () => {
  const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const candles = intervals.flatMap((interval) => {
    const intervalCandles = createCandles("BTC-EUR", interval, 200);
    return interval === "1m"
      ? setLatestCandleAge(intervalCandles, 30 * 60 * 1000 + 1)
      : intervalCandles;
  });
  const marketData = createSnapshot();
  const expectedFullHistory = analyzeMarket({
    symbol: "BTC-EUR",
    marketData,
    candles,
    now: fixedNow
  });
  const harness = createEngineHarness({ candles });
  await harness.service.runAnalysis({ config, serviceRoleKey });

  const decision = harness.writes
    .find(({ table }) => table === "AI_Crypto_Bot_AI_Decisions").body[0];
  const expectedLatestHistory = analyzeMarket({
    symbol: "BTC-EUR",
    marketData,
    candles: intervals.flatMap((interval) => candles
      .filter((candle) => candle.interval === interval)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)
        || left.symbol.localeCompare(right.symbol))
      .slice(0, 150)),
    now: fixedNow
  });

  assert.deepEqual(
    decision.indicators.dataQuality.staleCandleIntervals,
    expectedFullHistory.indicators.dataQuality.staleCandleIntervals
  );
  assert.deepEqual(
    decision.indicators.dataQuality.candleIntervalsAvailable,
    expectedFullHistory.indicators.dataQuality.candleIntervalsAvailable
  );
  assert.equal(decision.indicators.timeframes["1m"].stale, true);
  assert.equal(decision.indicators.timeframes["1m"].analyzedCandleCount, 0);
  for (const interval of intervals.filter((value) => value !== "1m")) {
    assert.equal(decision.indicators.timeframes[interval].stale, false);
    assert.equal(decision.indicators.timeframes[interval].candleCount, 150);
  }
  assert.equal(JSON.stringify(decision), JSON.stringify(expectedLatestHistory));
});

test("analysis uses bounded candle workers and preserves every market decision", async () => {
  const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const markets = Array.from({ length: 102 }, (_, index) => ({
    symbol: `ASSET${index}-EUR`,
    enabled: true,
    priority: index + 1
  }));
  const marketData = markets.map((market) => ({
    ...createSnapshot(),
    symbol: market.symbol
  }));
  const logEntries = [];
  const candles = markets.flatMap(({ symbol }) =>
    intervals.map((interval) => createCandles(symbol, interval, 1)[0])
  );
  const harness = createEngineHarness({
    markets,
    marketData,
    candles,
    candleDelayMs: 2,
    logger: {
      info(message, fields) {
        logEntries.push({ message, fields });
      },
      error() {}
    }
  });

  const result = await harness.service.runAnalysis({ config, serviceRoleKey });
  const decisions = harness.writes
    .find(({ table }) => table === "AI_Crypto_Bot_AI_Decisions").body;
  const expectedDecisions = markets.map((market) => analyzeMarket({
    symbol: market.symbol,
    marketData: marketData.find(({ symbol }) => symbol === market.symbol),
    candles: candles.filter((candle) => candle.symbol === market.symbol),
    now: fixedNow
  }));
  const candleRequests = harness.requests.filter(({ table }) =>
    table === latestCandlesRpc
  );
  const uniqueCandleQueries = new Set(candleRequests.map(({ body }) => {
    const request = JSON.parse(body);
    return `${request.p_symbols.join(",")}|${request.p_interval}`;
  }));

  assert.equal(result.analyzedMarkets, markets.length);
  assert.equal(result.decisionsStored, markets.length);
  assert.equal(candleRequests.length, Math.ceil(markets.length / 4) * intervals.length);
  assert.equal(uniqueCandleQueries.size, candleRequests.length);
  assert.equal(harness.getMaxActiveCandleRequests(), 24);
  assert.deepEqual(decisions, expectedDecisions);
  assert.equal(logEntries.length, 1);
  const completionLog = logEntries[0];
  const expectedDecisionCounts = expectedDecisions.reduce((counts, { decision }) => {
    counts[decision] += 1;
    return counts;
  }, { BUY: 0, SELL: 0, HOLD: 0, WAIT: 0 });
  assert.equal(completionLog.message, "AI analysis completed.");
  assert.equal(completionLog.fields.analyzedMarkets, markets.length);
  assert.equal(completionLog.fields.buyCount, expectedDecisionCounts.BUY);
  assert.equal(completionLog.fields.sellCount, expectedDecisionCounts.SELL);
  assert.equal(completionLog.fields.holdCount, expectedDecisionCounts.HOLD);
  assert.equal(completionLog.fields.waitCount, expectedDecisionCounts.WAIT);
  assert.equal(completionLog.fields.candleReads, 612);
  assert.equal(completionLog.fields.candleQueries, 156);
  assert.equal(completionLog.fields.failedReads, 0);
  assert.equal(completionLog.fields.candlesLoaded, candles.length);
  assert.ok(completionLog.fields.runtimeMs >= 0);
  assert.ok(completionLog.fields.timingMs.candleLoad >= 0);
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
  const logEntries = [];
  const harness = createEngineHarness({
    markets: [],
    logger: {
      info(message, fields) {
        logEntries.push({ message, fields });
      },
      error() {}
    }
  });
  const result = await harness.service.runAnalysis({ config, serviceRoleKey });

  assert.equal(result.status, "IDLE");
  assert.equal(result.decisionsStored, 0);
  assert.equal(harness.getStatus().status, "IDLE");
  assert.equal(harness.writes.some(({ table }) => table === "AI_Crypto_Bot_AI_Decisions"), false);
  assert.equal(logEntries.length, 1);
  assert.equal(logEntries[0].message, "AI analysis completed.");
  assert.equal(logEntries[0].fields.analyzedMarkets, 0);
  assert.equal(logEntries[0].fields.buyCount, 0);
  assert.equal(logEntries[0].fields.sellCount, 0);
  assert.equal(logEntries[0].fields.holdCount, 0);
  assert.equal(logEntries[0].fields.waitCount, 0);
  assert.equal(logEntries[0].fields.candleReads, 0);
  assert.equal(logEntries[0].fields.failedReads, 0);
});

test("database failure is surfaced and attempts to persist ERROR status", async () => {
  const logEntries = [];
  const harness = createEngineHarness({
    failReadTable: "AI_Crypto_Bot_Market_Data",
    logger: {
      info(message, fields) {
        logEntries.push({ level: "info", message, fields });
      },
      error(message, fields) {
        logEntries.push({ level: "error", message, fields });
      }
    }
  });

  await assert.rejects(
    harness.service.runAnalysis({ config, serviceRoleKey }),
    (error) => error.code === "DATABASE_READ_FAILED"
  );
  assert.equal(harness.getStatus().status, "ERROR");
  assert.ok(harness.writes.some(({ table, body }) =>
    table === "AI_Crypto_Bot_Status" && body.status === "ERROR"
  ));
  assert.ok(logEntries.some(({ level, message }) =>
    level === "error" && message === "AI analysis failed."
  ));
  assert.equal(logEntries.some(({ message }) => message === "AI analysis completed."), false);
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
