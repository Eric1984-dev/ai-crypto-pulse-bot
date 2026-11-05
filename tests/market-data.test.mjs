import assert from "node:assert/strict";
import test from "node:test";
import { createCandleRefreshHandler } from "../api/candle-refresh.mjs";
import { createMarketHandler, createMarketSummaryHandler } from "../lib/market-handler.mjs";
import { createMarketRefreshHandler } from "../api/market-refresh.mjs";
import { createMarketDataService } from "../lib/market-data.mjs";

const config = {
  supabaseUrl: "https://supabase.example",
  supabaseAnonKey: "test-anon-key"
};
const serviceRoleKey = "test-service-role-key";
const fixedNow = new Date("2026-03-20T12:00:00.000Z");
const validMarket = { market: "BTC-EUR", status: "trading", quote: "EUR" };
const validTicker = {
  market: "BTC-EUR",
  open: "100",
  last: "110",
  high: "115",
  low: "95",
  volume: "20"
};
const storedMarket = {
  symbol: "BTC-EUR",
  price: 105,
  volume: 18,
  daily_change: 5,
  high_24h: 110,
  low_24h: 90,
  captured_at: "2026-03-20T11:59:30.000Z"
};
const staleMarket = { ...storedMarket, captured_at: "2026-03-20T11:50:00.000Z" };
const watchedMarket = { symbol: "BTC-EUR", enabled: true, priority: 1 };

function createHarness({
  configured = [{ symbol: "BTC-EUR", enabled: true, priority: 1 }],
  watched = [watchedMarket],
  marketData = [],
  candles = [],
  decisions = [],
  catalog = [validMarket],
  tickers = [validTicker],
  candleRows = [],
  providerError = null,
  failRead = null,
  failMarketDataWrite = false,
  failCandleInterval = null,
  failCandleIntervalStatus = 503,
  failCandleStorage = false,
  failCandleSymbol = null,
  failCandleWriteSymbols = [],
  failBulkCandleStorage = false,
  applyBulkCandleStorageBeforeFailure = false,
  providerDelayMs = 0
} = {}) {
  const writes = [];
  const providerCalls = [];
  const rpcCalls = [];
  const clock = { value: fixedNow };
  let activeCandleRequests = 0;
  let maxConcurrentCandleRequests = 0;
  const database = {
    "AI_Crypto_Bot_Watched_Markets": [...watched],
    "AI_Crypto_Bot_Market_Data": [...marketData],
    "AI_Crypto_Bot_Candles": [...candles],
    "AI_Crypto_Bot_AI_Decisions": [...decisions],
    "AI_Crypto_Bot_Scanner_Events": []
  };
  const databaseCalls = [];
  function persistRows(table, rows) {
    for (const row of rows) {
      const key = table === "AI_Crypto_Bot_Candles"
        ? `${row.symbol}:${row.interval}:${row.timestamp}`
        : row.symbol || row.event_type;
      const existingIndex = database[table].findIndex((item) => {
        const itemKey = table === "AI_Crypto_Bot_Candles"
          ? `${item.symbol}:${item.interval}:${item.timestamp}`
          : item.symbol || item.event_type;
        return itemKey === key;
      });
      if (existingIndex < 0) {
        database[table].push(row);
      } else {
        database[table][existingIndex] = { ...database[table][existingIndex], ...row };
      }
    }
  }
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.bitvavo.com") {
      providerCalls.push(url.pathname + url.search);
      if (providerError && (!providerError.path || url.pathname === providerError.path)) {
        if (providerError.status) {
          return jsonResponse({}, providerError.status);
        }
        throw providerError.error;
      }
      if (url.pathname === "/v2/markets") {
        return jsonResponse(catalog);
      }
      if (url.pathname === "/v2/ticker/24h") {
        return jsonResponse(tickers);
      }
      if (url.pathname.endsWith("/candles")) {
        activeCandleRequests += 1;
        maxConcurrentCandleRequests = Math.max(maxConcurrentCandleRequests, activeCandleRequests);
        if (providerError && (!providerError.path || url.pathname === providerError.path)) {
          activeCandleRequests -= 1;
          if (providerError.status) {
            return jsonResponse({}, providerError.status);
          }
          throw providerError.error;
        }
        try {
          if (providerDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
          }
          if (failCandleInterval === url.searchParams.get("interval")) {
            return jsonResponse({}, failCandleIntervalStatus);
          }
          if (failCandleSymbol && url.pathname === `/v2/${failCandleSymbol}/candles`) {
            return jsonResponse({}, failCandleIntervalStatus);
          }
          return jsonResponse(typeof candleRows === "function" ? candleRows(url) : candleRows);
        } finally {
          activeCandleRequests -= 1;
        }
      }
      throw new Error(`Unexpected Bitvavo URL: ${url.pathname}`);
    }

    const rpcFunction = url.pathname.startsWith("/rest/v1/rpc/")
      ? decodeURIComponent(url.pathname.slice("/rest/v1/rpc/".length))
      : null;
    const table = rpcFunction || decodeURIComponent(url.pathname.split("/").pop());
    if (rpcFunction) {
      databaseCalls.push({ table, url, options });
      rpcCalls.push({ functionName: rpcFunction, url, options });
      if (typeof failRead === "function") {
        const failure = failRead({ table, url, options });
        if (failure) {
          return failure.response || jsonResponse(failure.body || {}, failure.status || 500);
        }
      }
      if (rpcFunction !== "AI_Crypto_Bot_Get_Latest_Candle_Checkpoints") {
        throw new Error(`Unexpected Supabase RPC: ${rpcFunction}`);
      }
      const { p_symbols: symbols, p_interval: interval } = JSON.parse(options.body);
      const latestBySymbol = new Map();
      for (const candle of database["AI_Crypto_Bot_Candles"]) {
        if (!symbols.includes(candle.symbol) || candle.interval !== interval) {
          continue;
        }
        const current = latestBySymbol.get(candle.symbol);
        if (!current || Date.parse(candle.timestamp) > Date.parse(current)) {
          latestBySymbol.set(candle.symbol, candle.timestamp);
        }
      }
      return jsonResponse([...latestBySymbol].map(([symbol, latest_timestamp]) => ({
        symbol,
        latest_timestamp
      })));
    }
    if (!database[table]) {
      throw new Error(`Unexpected Supabase table: ${table}`);
    }
    databaseCalls.push({ table, url, options });
    if (options.method === "POST") {
      const rows = JSON.parse(options.body);
      writes.push({ table, rows });
      if (table === "AI_Crypto_Bot_Market_Data" && failMarketDataWrite) {
        return jsonResponse({}, 500);
      }
      if (table === "AI_Crypto_Bot_Candles" && failCandleStorage) {
        return jsonResponse({}, 500);
      }
      if (table === "AI_Crypto_Bot_Candles") {
        const hasFailingMarket = rows.some(({ symbol }) => failCandleWriteSymbols.includes(symbol));
        if (failBulkCandleStorage && new Set(rows.map(({ symbol }) => symbol)).size > 1) {
          if (applyBulkCandleStorageBeforeFailure) {
            persistRows(table, rows);
          }
          return jsonResponse({}, 500);
        }
        if (hasFailingMarket) {
          return jsonResponse({}, 500);
        }
      }
      persistRows(table, rows);
      return jsonResponse({}, 201);
    }
    if (typeof failRead === "function") {
      const failure = failRead({ table, url, options });
      if (failure) {
        return failure.response || jsonResponse(failure.body || {}, failure.status || 500);
      }
    }
    const symbolFilter = url.searchParams.get("symbol");
    let rows = database[table];
    if (symbolFilter && symbolFilter.startsWith("eq.")) {
      rows = rows.filter((row) => row.symbol === symbolFilter.slice(3));
    } else if (symbolFilter && symbolFilter.startsWith("in.(")) {
      const symbols = symbolFilter.slice(4, -1).split(",");
      rows = rows.filter((row) => symbols.includes(row.symbol));
    }
    const intervalFilter = url.searchParams.get("interval");
    if (intervalFilter && intervalFilter.startsWith("eq.")) {
      rows = rows.filter((row) => row.interval === intervalFilter.slice(3));
    }
    for (const column of ["timestamp", "created_at"]) {
      const filter = url.searchParams.get(column);
      if (filter && filter.startsWith("gte.")) {
        rows = rows.filter((row) => Date.parse(row[column]) >= Date.parse(filter.slice(4)));
      }
    }
    const order = url.searchParams.get("order");
    if (order) {
      const [column, direction] = order.split(".").slice(0, 2);
      const secondaryOrder = order.split(",")[1];
      rows = [...rows].sort((left, right) => {
        const leftValue = left[column];
        const rightValue = right[column];
        const comparison = typeof leftValue === "string" && typeof rightValue === "string"
          ? leftValue.localeCompare(rightValue)
          : Number(leftValue) - Number(rightValue);
        const ordered = direction === "desc" ? -comparison : comparison;
        if (ordered || !secondaryOrder) {
          return ordered;
        }
        const [secondaryColumn, secondaryDirection] = secondaryOrder.split(".");
        const secondaryComparison = String(left[secondaryColumn] || "")
          .localeCompare(String(right[secondaryColumn] || ""));
        return secondaryDirection === "desc" ? -secondaryComparison : secondaryComparison;
      });
    }
    const range = options.headers && options.headers.Range;
    if (range) {
      const [from, to] = range.split("-").map(Number);
      rows = rows.slice(from, to + 1);
    } else {
      const limit = Number(url.searchParams.get("limit"));
      if (Number.isInteger(limit) && limit >= 0) {
        rows = rows.slice(0, limit);
      }
    }
    return jsonResponse(rows);
  };
  const service = createMarketDataService({
    fetchImpl,
    now: () => clock.value,
    logger: { error() {} },
    markets: configured
  });
  return {
    service,
    writes,
    providerCalls,
    databaseCalls,
    rpcCalls,
    database,
    clock,
    getMaxConcurrentCandleRequests: () => maxConcurrentCandleRequests
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function authenticatedRequest(url) {
  return {
    method: "GET",
    url,
    headers: { cookie: "cp_access_token=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl" }
  };
}

function responseCapture() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: "",
    setHeader(name, value) {
      headers[name] = value;
    },
    end(body = "") {
      this.body = body;
    }
  };
}

test("market summary validates configured markets and persists real ticker data", async () => {
  const { service, writes, database } = createHarness();
  const summary = await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });

  assert.equal(summary.activeMarkets, 1);
  assert.equal(summary.marketsWithData, 1);
  assert.equal(summary.items[0].price, 110);
  assert.equal(summary.refreshStatus, "refreshed");
  assert.ok(writes.some(({ table }) => table === "AI_Crypto_Bot_Market_Data"));
  assert.equal(database["AI_Crypto_Bot_Market_Data"][0].daily_change, 10);
});

test("empty Bitvavo responses safely return stored data and log the missing data event", async () => {
  const { service, writes } = createHarness({ tickers: [], marketData: [staleMarket] });
  const summary = await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });

  assert.equal(summary.items[0].price, storedMarket.price);
  assert.equal(summary.refreshStatus, "PROVIDER_EMPTY");
  assert.ok(writes.some(({ table, rows }) =>
    table === "AI_Crypto_Bot_Scanner_Events"
      && rows.some(({ event_type }) => event_type === "PROVIDER_EMPTY")
  ));
});

for (const [label, error, expectedStatus] of [
  ["timeout", { error: Object.assign(new Error("timed out"), { name: "TimeoutError" }) }, "PROVIDER_TIMEOUT"],
  ["rate limit", { status: 429 }, "RATE_LIMITED"],
  ["offline", { error: new Error("network unavailable") }, "PROVIDER_UNAVAILABLE"]
]) {
  test(`Bitvavo ${label} safely falls back to the last stored market snapshot`, async () => {
    const { service, writes } = createHarness({
      marketData: [staleMarket],
      providerError: { path: "/v2/markets", ...error }
    });
    const summary = await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });

    assert.equal(summary.items[0].price, storedMarket.price);
    assert.equal(summary.refreshStatus, expectedStatus);
    assert.ok(writes.some(({ table }) => table === "AI_Crypto_Bot_Scanner_Events"));
  });
}

test("invalid configured markets are logged and never inserted into watched markets", async () => {
  const { service, writes, database } = createHarness({
    configured: [
      { symbol: "BTC-EUR", enabled: true, priority: 1 },
      { symbol: "INVALID-EUR", enabled: true, priority: 2 }
    ]
  });
  await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });

  assert.ok(!database["AI_Crypto_Bot_Watched_Markets"].some(({ symbol }) => symbol === "INVALID-EUR"));
  assert.ok(writes.some(({ table, rows }) =>
    table === "AI_Crypto_Bot_Scanner_Events"
      && rows.some(({ event_type, reason }) =>
        event_type === "MARKET_VALIDATION_ERROR" && reason.includes("INVALID-EUR")
      )
  ));
});

test("market-data database write failures retain safe fallback state and log scanner errors", async () => {
  const { service, writes } = createHarness({ failMarketDataWrite: true });
  const summary = await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });

  assert.equal(summary.marketsWithData, 0);
  assert.equal(summary.refreshStatus, "storage-unavailable");
  assert.ok(writes.some(({ table, rows }) =>
    table === "AI_Crypto_Bot_Scanner_Events"
      && rows.some(({ event_type }) => event_type === "MARKET_DATA_STORAGE_ERROR")
  ));
});

test("provider catalog and ticker requests are cached for 60 seconds", async () => {
  const { service, providerCalls, clock } = createHarness();
  await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });
  const callsAfterFirstRequest = providerCalls.length;
  await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });

  assert.equal(callsAfterFirstRequest, 2);
  assert.equal(providerCalls.length, callsAfterFirstRequest);

  clock.value = new Date(fixedNow.getTime() + 60_001);
  await service.getMarketSummary({ config, accessToken: "user-jwt", serviceRoleKey });
  assert.equal(providerCalls.length, callsAfterFirstRequest + 2);
});

test("market endpoint validates and persists requested OHLCV candles", async () => {
  const candleTime = fixedNow.getTime();
  const { service, writes, database } = createHarness({
    marketData: [storedMarket],
    candleRows: [[candleTime, "100", "120", "90", "110", "25"]]
  });
  const market = await service.getMarket({
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    symbol: "BTC-EUR",
    interval: "5m",
    limit: 1
  });

  assert.equal(market.found, true);
  assert.equal(market.data.candles.length, 1);
  assert.equal(market.data.candles[0].close, 110);
  assert.ok(writes.some(({ table }) => table === "AI_Crypto_Bot_Candles"));
  assert.equal(database["AI_Crypto_Bot_Candles"][0].interval, "5m");
});

test("candle provider failures return cached stored candles without retrying within the TTL", async () => {
  const savedCandle = {
    symbol: "BTC-EUR",
    interval: "1m",
    open: 100,
    high: 120,
    low: 90,
    close: 110,
    volume: 25,
    timestamp: "2026-03-20T11:59:00.000Z"
  };
  const { service, providerCalls } = createHarness({
    marketData: [storedMarket],
    candles: [savedCandle],
    providerError: {
      path: "/v2/BTC-EUR/candles",
      error: new Error("Bitvavo unavailable")
    }
  });
  const input = {
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    symbol: "BTC-EUR",
    interval: "1m",
    limit: 1
  };

  const first = await service.getMarket(input);
  const second = await service.getMarket(input);

  assert.equal(first.data.candles[0].close, savedCandle.close);
  assert.equal(first.data.refreshStatus, "PROVIDER_UNAVAILABLE");
  assert.equal(second.data.candles[0].close, savedCandle.close);
  assert.equal(providerCalls.filter((path) => path.includes("/candles")).length, 1);
});

test("market endpoint validates symbols, protects access, and returns real stored data", async () => {
  const harness = createHarness({ marketData: [storedMarket] });
  const handler = createMarketHandler({
    env: {
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
    },
    verify: async () => true,
    service: harness.service,
    logger: { error() {} }
  });

  const invalidResponse = responseCapture();
  await handler(authenticatedRequest("/api/market?symbol=bad"), invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);

  const response = responseCapture();
  await handler(authenticatedRequest("/api/market?symbol=BTC-EUR"), response);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).data.marketData.price, storedMarket.price);

  const unauthorized = responseCapture();
  await handler({ method: "GET", url: "/api/market?symbol=BTC-EUR", headers: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
});

test("market summary endpoint returns active and data-bearing market counts", async () => {
  const handler = createMarketSummaryHandler({
    env: {
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
    },
    verify: async () => true,
    service: {
      async getMarketSummary() {
        return {
          activeMarkets: 4,
          marketsWithData: 3,
          items: [],
          enabledMarketRows: [{ symbol: "BTC-EUR", enabled: true, priority: 1 }]
        };
      },
      async getMarketScannerSummary({ activeMarkets }) {
        assert.deepEqual(activeMarkets, [{ symbol: "BTC-EUR", enabled: true, priority: 1 }]);
        return { timeframes: { "24h": { aiOpportunities: [] } } };
      }
    }
  });
  const response = responseCapture();
  await handler(authenticatedRequest("/api/market-summary"), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).data, {
    activeMarkets: 4,
    marketsWithData: 3,
    items: [],
    scanner: { timeframes: { "24h": { aiOpportunities: [] } } }
  });
});

test("scanner read diagnostics identify permission failures, schema failures, and malformed responses", async () => {
  const cases = [
    {
      name: "RLS/permission rejection",
      query: "AI_Crypto_Bot_Candles",
      matches: ({ url }) => url.searchParams.get("interval") === "eq.1d",
      failure: { status: 403, body: { code: "42501" } },
      expected: {
        queryName: "scanner.daily-candles",
        tableName: "AI_Crypto_Bot_Candles",
        operationName: "SELECT",
        pageNumber: 1,
        paginationRange: "0-33",
        failureKind: "RLS_OR_PERMISSION",
        httpStatus: 403
      }
    },
    {
      name: "schema mismatch",
      query: "AI_Crypto_Bot_AI_Decisions",
      matches: () => true,
      failure: { status: 404, body: { code: "PGRST205" } },
      expected: {
        queryName: "scanner.ai-decisions",
        tableName: "AI_Crypto_Bot_AI_Decisions",
        operationName: "SELECT",
        pageNumber: 1,
        paginationRange: "0-999",
        failureKind: "SCHEMA_MISMATCH",
        httpStatus: 404
      }
    },
    {
      name: "malformed successful response",
      query: "AI_Crypto_Bot_Candles",
      matches: ({ url }) => url.searchParams.get("interval") === "eq.1h",
      failure: {
        response: {
          ok: true,
          status: 200,
          json: async () => ({ data: [] })
        }
      },
      expected: {
        queryName: "scanner.hourly-candles",
        tableName: "AI_Crypto_Bot_Candles",
        operationName: "SELECT",
        pageNumber: 1,
        paginationRange: "0-11",
        failureKind: "MALFORMED_RESPONSE",
        httpStatus: 200
      }
    }
  ];

  for (const entry of cases) {
    const { service } = createHarness({
      failRead({ table, url }) {
        if (table === entry.query && entry.matches({ url })) {
          return entry.failure;
        }
        return null;
      }
    });
    await assert.rejects(
      service.getMarketScannerSummary({
        config,
        accessToken: "user-jwt",
        serviceRoleKey,
        activeMarkets: [watchedMarket],
        marketData: []
      }),
      (error) => {
        assert.equal(error.code, "STORAGE_UNAVAILABLE", entry.name);
        assert.deepEqual({
          queryName: error.queryName,
          tableName: error.tableName,
          operationName: error.operationName,
          pageNumber: error.pageNumber,
          paginationRange: error.paginationRange,
          failureKind: error.failureKind,
          httpStatus: error.httpStatus
        }, entry.expected, entry.name);
        return true;
      }
    );
  }
});

test("summary endpoint logs safe storage context and keeps production responses unchanged", async () => {
  const storageError = Object.assign(new Error("internal database details token=do-not-log"), {
    code: "STORAGE_UNAVAILABLE",
    queryName: "scanner.daily-candles",
    tableName: "AI_Crypto_Bot_Candles",
    operationName: "SELECT",
    pageNumber: 2,
    paginationRange: "1000-1999",
    failureKind: "RLS_OR_PERMISSION",
    httpStatus: 403,
    databaseCode: "42501"
  });
  const service = {
    async getMarketSummary() {
      throw storageError;
    }
  };
  const options = {
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_ANON_KEY: config.supabaseAnonKey
  };
  const loggedMessages = [];
  const createHandler = (nodeEnv) => createMarketSummaryHandler({
    env: { ...options, NODE_ENV: nodeEnv },
    verify: async () => true,
    service,
    logger: { error(message) { loggedMessages.push(message); } }
  });
  const development = responseCapture();
  await createHandler("development")(authenticatedRequest("/api/market-summary"), development);
  const developmentBody = JSON.parse(development.body);
  assert.equal(development.statusCode, 503);
  assert.deepEqual(developmentBody.error.diagnostics, {
    queryName: "scanner.daily-candles",
    failureKind: "RLS_OR_PERMISSION",
    httpStatus: 403,
    databaseCode: "42501"
  });
  assert.doesNotMatch(development.body, /internal database details/);

  const production = responseCapture();
  await createHandler("production")(authenticatedRequest("/api/market-summary"), production);
  assert.equal(production.statusCode, 503);
  assert.deepEqual(JSON.parse(production.body), {
    error: {
      code: "MARKET_DATA_UNAVAILABLE",
      message: "Stored market data is temporarily unavailable."
    }
  });
  assert.match(loggedMessages[1], /FAILED_QUERY=scanner\.daily-candles/);
  assert.match(loggedMessages[1], /TABLE=AI_Crypto_Bot_Candles/);
  assert.match(loggedMessages[1], /OPERATION=SELECT/);
  assert.match(loggedMessages[1], /PAGE=2/);
  assert.match(loggedMessages[1], /RANGE=1000-1999/);
  assert.match(loggedMessages[1], /HTTP_STATUS=403/);
  assert.match(loggedMessages[1], /ERROR_CODE=42501/);
  assert.match(loggedMessages[1], /FAILURE_CATEGORY=RLS_OR_PERMISSION/);
  assert.doesNotMatch(loggedMessages.join(" "), /internal database details|token=do-not-log|user-jwt/);
});

test("market scanner completes a single-page daily candle result", async () => {
  const candles = Array.from({ length: 20 }, (_, daysAgo) => ({
    symbol: "BTC-EUR",
    interval: "1d",
    close: 100 + daysAgo,
    volume: 1,
    timestamp: new Date(fixedNow.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  }));
  const { service, databaseCalls } = createHarness({ candles });
  const summary = await service.getMarketScannerSummary({
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    activeMarkets: [watchedMarket],
    marketData: []
  });

  const dailyCalls = databaseCalls.filter(({ table, url }) =>
    table === "AI_Crypto_Bot_Candles" && url.searchParams.get("interval") === "eq.1d"
  );
  assert.equal(dailyCalls.length, 1);
  assert.equal(dailyCalls[0].options.headers.Range, "0-33");
  assert.equal(summary.activeMarkets, 1);
});

test("market scanner treats PGRST103 on a later candle page as end-of-pagination", async () => {
  const activeMarkets = [];
  const candles = [];
  const marketData = [];
  for (let marketIndex = 0; marketIndex < 40; marketIndex += 1) {
    const symbol = `M${String(marketIndex).padStart(3, "0")}-EUR`;
    activeMarkets.push({ symbol, enabled: true, priority: marketIndex + 1 });
    marketData.push({
      symbol,
      price: 100,
      volume: 1,
      daily_change: marketIndex,
      captured_at: "2026-03-20T11:59:30.000Z"
    });
    for (let daysAgo = 0; daysAgo < 25; daysAgo += 1) {
      candles.push({
        symbol,
        interval: "1d",
        close: 100,
        volume: 1,
        timestamp: new Date(fixedNow.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
      });
    }
  }
  const { service, databaseCalls } = createHarness({
    watched: activeMarkets,
    candles,
    failRead({ table, url, options }) {
      if (table === "AI_Crypto_Bot_Candles"
        && url.searchParams.get("interval") === "eq.1d"
        && options.headers.Range === "1000-1359") {
        return { status: 416, body: { code: "PGRST103" } };
      }
      return null;
    }
  });

  const summary = await service.getMarketScannerSummary({
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    activeMarkets,
    marketData
  });
  const dailyCalls = databaseCalls.filter(({ table, url }) =>
    table === "AI_Crypto_Bot_Candles" && url.searchParams.get("interval") === "eq.1d"
  );

  assert.equal(dailyCalls.length, 2);
  assert.equal(dailyCalls[1].options.headers.Range, "1000-1359");
  assert.equal(summary.marketsWithFreshData, 40);
  assert.equal(summary.timeframes["24h"].topGainers[0].symbol, "M039-EUR");
});

test("market scanner stops after an incomplete final daily candle page", async () => {
  const activeMarkets = [];
  const candles = [];
  for (let marketIndex = 0; marketIndex < 40; marketIndex += 1) {
    const symbol = `M${String(marketIndex).padStart(3, "0")}-EUR`;
    activeMarkets.push({ symbol, enabled: true, priority: marketIndex + 1 });
  }
  for (let index = 0; index < 1100; index += 1) {
    const marketIndex = index % activeMarkets.length;
    const daysAgo = Math.floor(index / activeMarkets.length);
    candles.push({
      symbol: activeMarkets[marketIndex].symbol,
      interval: "1d",
      close: 100,
      volume: 1,
      timestamp: new Date(fixedNow.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
    });
  }
  const { service, databaseCalls } = createHarness({ watched: activeMarkets, candles });
  const summary = await service.getMarketScannerSummary({
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    activeMarkets,
    marketData: []
  });
  const dailyCalls = databaseCalls.filter(({ table, url }) =>
    table === "AI_Crypto_Bot_Candles" && url.searchParams.get("interval") === "eq.1d"
  );

  assert.equal(dailyCalls.length, 2);
  assert.equal(dailyCalls[0].options.headers.Range, "0-999");
  assert.equal(dailyCalls[1].options.headers.Range, "1000-1359");
  assert.equal(summary.activeMarkets, 40);
});

test("market scanner pages candle history and includes markets beyond the first database page", async () => {
  const activeMarkets = [];
  const marketData = [];
  const candles = [];
  for (let marketIndex = 0; marketIndex < 40; marketIndex += 1) {
    const symbol = `M${String(marketIndex).padStart(3, "0")}-EUR`;
    activeMarkets.push({ symbol, enabled: true, priority: marketIndex + 1 });
    marketData.push({
      symbol,
      price: marketIndex === 39 ? 200 : 100,
      volume: 10,
      daily_change: 0,
      captured_at: "2026-03-20T11:59:00.000Z"
    });
    for (let daysAgo = 33; daysAgo >= 0; daysAgo -= 1) {
      candles.push({
        symbol,
        interval: "1d",
        close: daysAgo === 30 ? 100 : 100,
        volume: 1,
        timestamp: new Date(fixedNow.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
      });
    }
  }
  const { service, databaseCalls } = createHarness({ candles });
  const summary = await service.getMarketScannerSummary({
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    activeMarkets,
    marketData
  });

  const dailyCalls = databaseCalls.filter(({ table, url }) =>
    table === "AI_Crypto_Bot_Candles" && url.searchParams.get("interval") === "eq.1d"
  );
  assert.equal(dailyCalls.length, 2);
  assert.equal(dailyCalls[0].options.headers.Range, "0-999");
  assert.equal(dailyCalls[1].options.headers.Range, "1000-1359");
  assert.equal(summary.timeframes["30d"].topGainers[0].symbol, "M039-EUR");
});

test("market scanner pages recent decisions when the active market universe exceeds one page", async () => {
  const activeMarkets = [];
  const decisions = [];
  for (let marketIndex = 0; marketIndex < 1200; marketIndex += 1) {
    const symbol = `M${String(marketIndex).padStart(4, "0")}-EUR`;
    activeMarkets.push({ symbol, enabled: true, priority: marketIndex + 1 });
    decisions.push({
      id: `decision-${marketIndex}`,
      symbol,
      decision: "BUY",
      confidence: 70,
      reason: "Recent stored decision.",
      created_at: "2026-03-20T11:59:00.000Z"
    });
  }
  const { service, databaseCalls } = createHarness({ decisions });
  const summary = await service.getMarketScannerSummary({
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    activeMarkets,
    marketData: []
  });

  const decisionCalls = databaseCalls.filter(({ table }) => table === "AI_Crypto_Bot_AI_Decisions");
  assert.equal(decisionCalls.length, 2);
  assert.equal(decisionCalls[0].options.headers.Range, "0-999");
  assert.equal(decisionCalls[1].options.headers.Range, "1000-1999");
  assert.equal(summary.marketsWithDecisions, 1200);
});

test("scheduled refresh requires the cron secret and keeps server credentials out of responses", async () => {
  let received;
  const handler = createMarketRefreshHandler({
    env: {
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      CRON_SECRET: "test-cron-secret"
    },
    service: {
      async refreshScheduledMarkets(options) {
        received = options;
        return { activeMarkets: 1, marketsWithData: 1, items: [] };
      }
    }
  });
  const request = {
    method: "GET",
    url: "/api/market-refresh",
    headers: { authorization: "Bearer test-cron-secret" }
  };
  const response = responseCapture();
  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(received.serviceRoleKey, serviceRoleKey);
  assert.doesNotMatch(response.body, /test-cron-secret|test-service-role-key/);

  const unauthorized = responseCapture();
  await handler({ ...request, headers: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
});

test("scheduled market refresh updates ticker snapshots without starting candle ingestion", async () => {
  const { service, writes, providerCalls, database } = createHarness({
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]]
  });
  const result = await service.refreshScheduledMarkets({ config, serviceRoleKey });

  assert.equal(result.refreshStatus, "refreshed");
  assert.equal(result.candleRefresh, undefined);
  assert.equal(result.metrics.recordsProcessed.marketData, 1);
  assert.equal(result.metrics.recordsProcessed.total, 1);
  assert.ok(result.metrics.marketRefreshDurationMs >= 0);
  assert.equal(providerCalls.some((path) => path.includes("/candles")), false);
  assert.ok(writes.some(({ table }) => table === "AI_Crypto_Bot_Market_Data"));
  assert.equal(writes.some(({ table }) => table === "AI_Crypto_Bot_Candles"), false);
  assert.equal(database["AI_Crypto_Bot_Candles"].length, 0);
});

test("market refresh API logs snapshot metrics and does not run candle collection", async () => {
  const harness = createHarness({
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]]
  });
  let loggedMetrics;
  const handler = createMarketRefreshHandler({
    env: {
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      CRON_SECRET: "test-cron-secret"
    },
    service: harness.service,
    logger: {
      error() {},
      info(_message, metrics) {
        loggedMetrics = metrics;
      }
    }
  });
  const response = responseCapture();
  await handler({
    method: "GET",
    url: "/api/market-refresh",
    headers: { authorization: `Bearer ${"test-cron-secret"}` }
  }, response);
  const data = JSON.parse(response.body).data;

  assert.equal(response.statusCode, 200);
  assert.equal(data.candleRefresh, undefined);
  assert.equal(loggedMetrics.marketRefreshDurationMs, data.metrics.marketRefreshDurationMs);
  assert.equal(loggedMetrics.recordsProcessed.total, 1);
  assert.equal(harness.providerCalls.some((path) => path.includes("/candles")), false);
  assert.equal(harness.database["AI_Crypto_Bot_Candles"].length, 0);
});

test("candle refresh requires scheduler authorization and valid bounded request parameters", async () => {
  let received;
  const handler = createCandleRefreshHandler({
    logger: { error() {}, info() {} },
    env: {
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      CRON_SECRET: "test-cron-secret"
    },
    service: {
      async refreshScheduledCandleBatch(options) {
        received = options;
        if (options.batch === 1) {
          const error = new Error("Batch index is outside the active market range.");
          error.code = "INVALID_CANDLE_REFRESH_REQUEST";
          throw error;
        }
        return { status: "refreshed", metrics: { candleRefreshDurationMs: 3 } };
      }
    }
  });
  const request = {
    method: "GET",
    url: "/api/candle-refresh?interval=1m&batch=0",
    headers: { authorization: "Bearer test-cron-secret" }
  };
  const response = responseCapture();
  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  assert.doesNotMatch(response.body, /test-cron-secret|test-service-role-key/);

  const unauthorized = responseCapture();
  await handler({ ...request, headers: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const invalid = responseCapture();
  await handler({ ...request, url: "/api/candle-refresh?interval=1m&batch=-1" }, invalid);
  assert.equal(invalid.statusCode, 400);

  const outOfRange = responseCapture();
  await handler({ ...request, url: "/api/candle-refresh?interval=1m&batch=1" }, outOfRange);
  assert.equal(outOfRange.statusCode, 400);
});

test("scheduled candle refresh refetches a range when an earlier request cached less history", async () => {
  const harness = createHarness({
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]]
  });
  await harness.service.getMarket({
    config,
    accessToken: "user-jwt",
    serviceRoleKey,
    symbol: "BTC-EUR",
    interval: "1m",
    limit: 1
  });
  harness.clock.value = new Date(fixedNow.getTime() + 2 * 60_000);
  const scheduled = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(scheduled.refreshed, 1);
  assert.equal(harness.providerCalls.filter((path) => path.includes("/candles")).length, 2);
  assert.equal(harness.database["AI_Crypto_Bot_Candles"].length, 1);
});

test("scheduled candle refresh uses bounded market batches and reuses the 60-second cache", async () => {
  const secondMarket = { market: "ETH-EUR", status: "trading", quote: "EUR" };
  const secondWatchedMarket = { symbol: "ETH-EUR", enabled: true, priority: 2 };
  const { service, providerCalls, getMaxConcurrentCandleRequests } = createHarness({
    watched: [watchedMarket, secondWatchedMarket],
    catalog: [validMarket, secondMarket],
    tickers: [
      validTicker,
      { ...validTicker, market: "ETH-EUR", open: "50", last: "55", high: "60", low: "45" }
    ],
    candleRows: [[fixedNow.getTime() - 10 * 60_000, "100", "120", "90", "110", "25"]],
    providerDelayMs: 2
  });
  const first = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const candleCalls = providerCalls.filter((path) => path.includes("/candles")).length;
  const second = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(first.markets, 2);
  assert.equal(first.selectedMarkets, 2);
  assert.equal(first.batchCount, 1);
  assert.equal(first.attempted, 2);
  assert.ok(getMaxConcurrentCandleRequests() > 1);
  assert.ok(getMaxConcurrentCandleRequests() <= 4);
  assert.equal(second.cached, 2);
  assert.equal(second.unchanged, 0);
  assert.equal(providerCalls.filter((path) => path.includes("/candles")).length, candleCalls);
});

test("scheduled candle refresh bulk upserts validated candles once with per-market and aggregate metrics", async () => {
  const secondMarket = { market: "ETH-EUR", status: "trading", quote: "EUR" };
  const secondWatchedMarket = { symbol: "ETH-EUR", enabled: true, priority: 2 };
  const harness = createHarness({
    watched: [watchedMarket, secondWatchedMarket],
    catalog: [validMarket, secondMarket],
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]]
  });

  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const candleWrites = harness.writes.filter(({ table }) => table === "AI_Crypto_Bot_Candles");
  const candleWriteCalls = harness.databaseCalls.filter(({ table, options }) =>
    table === "AI_Crypto_Bot_Candles" && options.method === "POST"
  );

  assert.equal(candleWrites.length, 1);
  assert.equal(candleWrites[0].rows.length, 2);
  assert.equal(candleWriteCalls[0].url.searchParams.get("on_conflict"), "symbol,interval,timestamp");
  assert.equal(candleWriteCalls[0].options.headers.prefer, "resolution=merge-duplicates,return=minimal");
  assert.equal(result.refreshed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.candlesUpserted, 2);
  assert.equal(result.metrics.recordsProcessed.candles, 2);
  assert.equal(result.metrics.candleWriteRequests, 1);
  assert.equal(result.metrics.candleWriteFallbacks, 0);
  const trafficEndpoints = result.metrics.supabaseResponseTraffic.endpoints;
  assert.ok(trafficEndpoints.some(({ endpoint, requests, jsonResponsesMeasured }) =>
    endpoint === "POST /rest/v1/rpc/AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"
      && requests === 1
      && jsonResponsesMeasured === 1));
  assert.ok(trafficEndpoints.some(({ endpoint, requests }) =>
    endpoint === "POST /rest/v1/AI_Crypto_Bot_Candles" && requests === 1));
  assert.deepEqual(result.marketOutcomes, [
    { symbol: "BTC-EUR", status: "refreshed", candlesUpserted: 1 },
    { symbol: "ETH-EUR", status: "refreshed", candlesUpserted: 1 }
  ]);
});

test("scheduled candle refresh persists successful markets when another provider request fails", async () => {
  const secondMarket = { market: "ETH-EUR", status: "trading", quote: "EUR" };
  const secondWatchedMarket = { symbol: "ETH-EUR", enabled: true, priority: 2 };
  const harness = createHarness({
    watched: [watchedMarket, secondWatchedMarket],
    catalog: [validMarket, secondMarket],
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]],
    failCandleSymbol: "ETH-EUR",
    failCandleIntervalStatus: 404
  });

  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const candleWrites = harness.writes.filter(({ table }) => table === "AI_Crypto_Bot_Candles");

  assert.equal(result.status, "partial");
  assert.equal(result.attempted, 2);
  assert.equal(result.refreshed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.candlesUpserted, 1);
  assert.equal(candleWrites.length, 1);
  assert.deepEqual(candleWrites[0].rows.map(({ symbol }) => symbol), ["BTC-EUR"]);
  assert.deepEqual(result.marketOutcomes.map(({ symbol, status }) => ({ symbol, status })), [
    { symbol: "BTC-EUR", status: "refreshed" },
    { symbol: "ETH-EUR", status: "failed" }
  ]);
});

test("scheduled candle refresh retries a failed bulk upsert idempotently per market", async () => {
  const secondMarket = { market: "ETH-EUR", status: "trading", quote: "EUR" };
  const secondWatchedMarket = { symbol: "ETH-EUR", enabled: true, priority: 2 };
  const intervalMs = 60_000;
  const latestTimestamp = fixedNow.getTime() - 2 * intervalMs;
  const harness = createHarness({
    watched: [watchedMarket, secondWatchedMarket],
    catalog: [validMarket, secondMarket],
    candles: [{
      symbol: "BTC-EUR",
      interval: "1m",
      open: 100,
      high: 120,
      low: 90,
      close: 110,
      volume: 25,
      timestamp: new Date(latestTimestamp).toISOString()
    }],
    candleRows(url) {
      if (url.pathname === "/v2/BTC-EUR/candles") {
        const start = Number(url.searchParams.get("start"));
        return [
          [start, "100", "120", "90", "111", "25"],
          [start + intervalMs, "100", "120", "90", "112", "25"]
        ];
      }
      return [[fixedNow.getTime(), "50", "60", "45", "55", "12"]];
    },
    failBulkCandleStorage: true,
    applyBulkCandleStorageBeforeFailure: true
  });

  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const candleWrites = harness.writes.filter(({ table }) => table === "AI_Crypto_Bot_Candles");
  const bitcoinLatest = harness.database["AI_Crypto_Bot_Candles"].find(({ symbol, timestamp }) =>
    symbol === "BTC-EUR" && timestamp === new Date(latestTimestamp).toISOString()
  );

  assert.equal(candleWrites.length, 3);
  assert.equal(candleWrites[0].rows.length, 3);
  assert.ok(harness.databaseCalls
    .filter(({ table, options }) => table === "AI_Crypto_Bot_Candles" && options.method === "POST")
    .every(({ options }) => options.headers.prefer === "resolution=merge-duplicates,return=minimal"));
  assert.equal(result.status, "refreshed");
  assert.equal(result.refreshed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.candlesUpserted, 3);
  assert.equal(result.metrics.recordsProcessed.candles, 3);
  assert.equal(result.metrics.candleWriteRequests, 3);
  assert.equal(result.metrics.candleWriteFallbacks, 2);
  assert.equal(harness.database["AI_Crypto_Bot_Candles"].length, 3);
  assert.equal(bitcoinLatest.close, 111);
  assert.equal(harness.database["AI_Crypto_Bot_Candles"].filter(({ symbol, timestamp }) =>
    symbol === "BTC-EUR" && timestamp === new Date(latestTimestamp).toISOString()
  ).length, 1);
});

test("a persistently failing market does not block fallback writes for other markets", async () => {
  const secondMarket = { market: "ETH-EUR", status: "trading", quote: "EUR" };
  const secondWatchedMarket = { symbol: "ETH-EUR", enabled: true, priority: 2 };
  const harness = createHarness({
    watched: [watchedMarket, secondWatchedMarket],
    catalog: [validMarket, secondMarket],
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]],
    failCandleWriteSymbols: ["ETH-EUR"]
  });

  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const candleWrites = harness.writes.filter(({ table }) => table === "AI_Crypto_Bot_Candles");

  assert.equal(result.status, "storage-unavailable");
  assert.equal(result.refreshed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.candlesUpserted, 1);
  assert.equal(result.metrics.recordsProcessed.candles, 1);
  assert.equal(result.metrics.candleWriteRequests, 3);
  assert.equal(result.metrics.candleWriteFallbacks, 2);
  assert.deepEqual(candleWrites.slice(1).map(({ rows }) => rows[0].symbol).sort(), ["BTC-EUR", "ETH-EUR"]);
  assert.deepEqual(result.marketOutcomes.map(({ symbol, status }) => ({ symbol, status })), [
    { symbol: "BTC-EUR", status: "refreshed" },
    { symbol: "ETH-EUR", status: "failed" }
  ]);
  assert.ok(harness.writes.some(({ table, rows }) =>
    table === "AI_Crypto_Bot_Scanner_Events"
      && rows.some(({ symbol, event_type }) =>
        symbol === "ETH-EUR" && event_type === "CANDLE_DATA_STORAGE_ERROR"
      )
  ));
});

test("scheduled candle refresh excludes invalid provider candles from the bulk payload", async () => {
  const harness = createHarness({
    candleRows: [
      [fixedNow.getTime(), "100", "120", "90", "110", "25"],
      [fixedNow.getTime() + 60_000, "100", "120", "90", "130", "25"],
      [fixedNow.getTime() + 120_000, "100", "120", "90", "110", "-1"]
    ]
  });

  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const candleWrite = harness.writes.find(({ table }) => table === "AI_Crypto_Bot_Candles");

  assert.equal(result.refreshed, 1);
  assert.equal(result.candlesUpserted, 1);
  assert.equal(candleWrite.rows.length, 1);
  assert.equal(candleWrite.rows[0].close, 110);
  assert.equal(result.marketOutcomes[0].candlesUpserted, 1);
});

test("scheduled candle checkpoint RPC preserves latest-candle parity with the previous lookup", async () => {
  const secondMarket = { market: "ETH-EUR", status: "trading", quote: "EUR" };
  const secondWatchedMarket = { symbol: "ETH-EUR", enabled: true, priority: 2 };
  const storedCandles = [
    { symbol: "BTC-EUR", interval: "1m", timestamp: new Date(fixedNow.getTime() - 9 * 60_000).toISOString() },
    { symbol: "BTC-EUR", interval: "1m", timestamp: new Date(fixedNow.getTime() - 2 * 60_000).toISOString() },
    { symbol: "ETH-EUR", interval: "1m", timestamp: new Date(fixedNow.getTime() - 4 * 60_000).toISOString() }
  ];
  const symbols = ["BTC-EUR", "ETH-EUR"];
  const limitedRows = [...storedCandles]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 2000);
  const previousLookup = new Map();
  for (const { symbol, timestamp } of limitedRows) {
    const key = `${symbol}:1m`;
    const parsedTimestamp = Date.parse(timestamp);
    if (!previousLookup.has(key) || parsedTimestamp > previousLookup.get(key)) {
      previousLookup.set(key, parsedTimestamp);
    }
  }
  for (const symbol of symbols.filter((item) => !previousLookup.has(`${item}:1m`))) {
    const latest = storedCandles
      .filter((candle) => candle.symbol === symbol && candle.interval === "1m")
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
    if (latest) {
      previousLookup.set(`${symbol}:1m`, Date.parse(latest.timestamp));
    }
  }
  const harness = createHarness({
    watched: [watchedMarket, secondWatchedMarket],
    catalog: [validMarket, secondMarket],
    candles: storedCandles
  });

  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const requests = harness.providerCalls
    .filter((path) => path.includes("/candles"))
    .map((path) => new URL(path, "https://api.bitvavo.com"));

  assert.equal(result.attempted, 2);
  assert.equal(harness.rpcCalls.length, 1);
  assert.equal(harness.rpcCalls[0].functionName, "AI_Crypto_Bot_Get_Latest_Candle_Checkpoints");
  assert.equal(harness.rpcCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(harness.rpcCalls[0].options.body), {
    p_symbols: symbols,
    p_interval: "1m"
  });
  assert.equal(
    harness.databaseCalls.filter(({ table, options }) =>
      table === "AI_Crypto_Bot_Candles" && options.method !== "POST"
    ).length,
    0
  );
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const symbol = request.pathname.split("/")[2];
    const latestTimestamp = previousLookup.get(`${symbol}:1m`);
    const expectedLimit = Math.min(
      500,
      Math.max(2, Math.floor((fixedNow.getTime() - latestTimestamp) / 60_000) + 1)
    );
    assert.equal(request.searchParams.get("start"), String(latestTimestamp));
    assert.equal(request.searchParams.get("limit"), String(expectedLimit));
  }
});

test("scheduled candle checkpoint RPC bootstraps markets with no stored history", async () => {
  const harness = createHarness({
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]]
  });
  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const request = new URL(
    harness.providerCalls.find((path) => path.includes("/candles")),
    "https://api.bitvavo.com"
  );

  assert.equal(result.refreshed, 1);
  assert.equal(harness.rpcCalls.length, 1);
  assert.equal(request.searchParams.has("start"), false);
  assert.equal(request.searchParams.get("limit"), "500");
});

test("scheduled candle refresh skips checkpoint RPC for an empty batch", async () => {
  const harness = createHarness({
    watched: [{ ...watchedMarket, enabled: false }]
  });
  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(result.status, "no-markets");
  assert.equal(harness.rpcCalls.length, 0);
  assert.equal(harness.providerCalls.some((path) => path.includes("/candles")), false);
});

test("scheduled candle checkpoint RPC handles histories beyond the old 2000-row query limit", async () => {
  const secondMarket = { market: "ETH-EUR", status: "trading", quote: "EUR" };
  const secondWatchedMarket = { symbol: "ETH-EUR", enabled: true, priority: 2 };
  const storedCandles = Array.from({ length: 2001 }, (_, index) => ({
    symbol: "BTC-EUR",
    interval: "1m",
    timestamp: new Date(fixedNow.getTime() - (index + 2) * 60_000).toISOString()
  }));
  const ethTimestamp = new Date(fixedNow.getTime() - 7 * 60_000).toISOString();
  storedCandles.push({ symbol: "ETH-EUR", interval: "1m", timestamp: ethTimestamp });
  const harness = createHarness({
    watched: [watchedMarket, secondWatchedMarket],
    catalog: [validMarket, secondMarket],
    candles: storedCandles
  });

  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const requests = harness.providerCalls
    .filter((path) => path.includes("/candles"))
    .map((path) => new URL(path, "https://api.bitvavo.com"));

  assert.equal(result.attempted, 2);
  assert.equal(harness.rpcCalls.length, 1);
  assert.equal(requests.length, 2);
  const ethRequest = requests.find((request) => request.pathname.includes("/ETH-EUR/"));
  assert.equal(ethRequest.searchParams.get("start"), String(Date.parse(ethTimestamp)));
  assert.equal(ethRequest.searchParams.get("limit"), "8");
});

test("checkpoint RPC failures skip provider requests and candle writes", async () => {
  const harness = createHarness({
    failRead: ({ table }) => table === "AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"
      ? { status: 500, body: { code: "XX000" } }
      : null
  });
  const result = await harness.service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(result.status, "storage-unavailable");
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(harness.providerCalls.some((path) => path.includes("/candles")), false);
  assert.equal(harness.writes.some(({ table }) => table === "AI_Crypto_Bot_Candles"), false);
});

test("scheduled candle refresh requests only the incremental range for its requested interval", async () => {
  const intervalMs = 60_000;
  const latestTimestamp = Math.floor(fixedNow.getTime() / intervalMs) * intervalMs - intervalMs * 2;
  const storedCandles = [{
    symbol: "BTC-EUR",
    interval: "1m",
    open: 100,
    high: 120,
    low: 90,
    close: 110,
    volume: 25,
    timestamp: new Date(latestTimestamp).toISOString()
  }];
  const { service, providerCalls, database, rpcCalls } = createHarness({
    candles: storedCandles,
    candleRows(url) {
      const start = Number(url.searchParams.get("start"));
      return [
        [start, "100", "120", "90", "111", "25"],
        [start + intervalMs, "100", "120", "90", "112", "25"]
      ];
    }
  });

  const result = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });
  const candleRequests = providerCalls
    .filter((path) => path.includes("/candles"))
    .map((path) => new URL(path, "https://api.bitvavo.com"));

  assert.equal(candleRequests.length, 1);
  assert.equal(candleRequests[0].searchParams.get("interval"), "1m");
  assert.equal(candleRequests[0].searchParams.get("start"), String(Date.parse(storedCandles[0].timestamp)));
  assert.equal(candleRequests[0].searchParams.get("limit"), "3");
  assert.equal(rpcCalls.length, 1);
  assert.equal(JSON.parse(rpcCalls[0].options.body).p_interval, "1m");
  assert.equal(result.candlesUpserted, 2);
  assert.equal(result.metrics.recordsProcessed.candles, 2);
  assert.equal(database["AI_Crypto_Bot_Candles"].length, 2);
  assert.equal(database["AI_Crypto_Bot_Candles"].filter(({ close }) => close === 112).length, 1);
});

test("scheduled candle refresh skips an interval with no completed candle", async () => {
  const candles = [{
    symbol: "BTC-EUR",
    interval: "1m",
    open: 100,
    high: 120,
    low: 90,
    close: 110,
    volume: 25,
    timestamp: new Date(Math.floor(fixedNow.getTime() / 60_000) * 60_000).toISOString()
  }];
  const { service, providerCalls, writes } = createHarness({ candles });
  const result = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(result.status, "up-to-date");
  assert.equal(result.unchanged, 1);
  assert.equal(result.providerRequests, 0);
  assert.equal(providerCalls.filter((path) => path.includes("/candles")).length, 0);
  assert.equal(writes.some(({ table }) => table === "AI_Crypto_Bot_Candles"), false);
});

test("scheduled candle refresh records provider failures without changing stored candle data", async () => {
  const { service, writes, providerCalls } = createHarness({
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]],
    failCandleInterval: "1m",
    failCandleIntervalStatus: 404
  });
  const result = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(result.status, "partial");
  assert.equal(result.failed, 1);
  assert.equal(providerCalls.filter((path) => path.includes("/candles")).length, 1);
  assert.ok(writes.some(({ table, rows }) =>
    table === "AI_Crypto_Bot_Scanner_Events"
      && rows.some(({ event_type }) => event_type === "INVALID_MARKET")
  ));
});

test("scheduled candle refresh reports a provider rate limit", async () => {
  const { service, providerCalls } = createHarness({
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]],
    failCandleInterval: "1m",
    failCandleIntervalStatus: 429
  });
  const result = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(result.status, "provider-unavailable");
  assert.ok(result.failed >= 1);
  assert.equal(providerCalls.filter((path) => path.includes("/candles")).length, 1);
});

test("scheduled candle refresh records empty interval responses without failing the batch", async () => {
  const { service, writes, database } = createHarness({ candleRows: [] });
  const result = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(result.status, "partial");
  assert.equal(result.missing, 1);
  assert.equal(result.failed, 0);
  assert.equal(database["AI_Crypto_Bot_Candles"].length, 0);
  assert.ok(writes.some(({ table, rows }) =>
    table === "AI_Crypto_Bot_Scanner_Events"
      && rows.some(({ event_type }) => event_type === "CANDLE_DATA_MISSING")
  ));
});

test("scheduled candle refresh returns a storage failure without claiming successful writes", async () => {
  const { service } = createHarness({
    candleRows: [[fixedNow.getTime(), "100", "120", "90", "110", "25"]],
    failCandleStorage: true
  });
  const result = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "1m",
    batch: 0
  });

  assert.equal(result.status, "storage-unavailable");
  assert.ok(result.failed >= 1);
  assert.equal(result.candlesUpserted, 0);
});

test("scheduled candle refresh processes deterministic bounded batches", async () => {
  const watched = Array.from({ length: 6 }, (_, index) => ({
    symbol: `M${index}-EUR`,
    enabled: true,
    priority: index + 1
  }));
  const catalog = watched.map(({ symbol }) => ({ market: symbol, status: "trading", quote: "EUR" }));
  const { service, providerCalls } = createHarness({ watched, catalog });
  const first = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "5m",
    batch: 0
  });
  const second = await service.refreshScheduledCandleBatch({
    config,
    serviceRoleKey,
    interval: "5m",
    batch: 1
  });

  assert.equal(first.markets, 6);
  assert.equal(first.batchCount, 2);
  assert.equal(first.selectedMarkets, 5);
  assert.equal(first.attempted, 5);
  assert.equal(second.batch, 1);
  assert.equal(second.selectedMarkets, 1);
  assert.equal(second.attempted, 1);
  assert.equal(providerCalls.filter((path) => path.includes("/candles")).length, 6);
});
