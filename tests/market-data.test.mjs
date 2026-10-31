import assert from "node:assert/strict";
import test from "node:test";
import { createMarketHandler, createMarketSummaryHandler } from "../api/market-handler.mjs";
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
  catalog = [validMarket],
  tickers = [validTicker],
  candleRows = [],
  providerError = null,
  failMarketDataWrite = false
} = {}) {
  const writes = [];
  const providerCalls = [];
  const clock = { value: fixedNow };
  const database = {
    "AI_Crypto_Bot_Watched_Markets": [...watched],
    "AI_Crypto_Bot_Market_Data": [...marketData],
    "AI_Crypto_Bot_Candles": [...candles],
    "AI_Crypto_Bot_Scanner_Events": []
  };
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
        if (providerError && (!providerError.path || url.pathname === providerError.path)) {
          throw providerError.error;
        }
        return jsonResponse(candleRows);
      }
      throw new Error(`Unexpected Bitvavo URL: ${url.pathname}`);
    }

    const table = decodeURIComponent(url.pathname.split("/").pop());
    if (!database[table]) {
      throw new Error(`Unexpected Supabase table: ${table}`);
    }
    if (options.method === "POST") {
      const rows = JSON.parse(options.body);
      writes.push({ table, rows });
      if (table === "AI_Crypto_Bot_Market_Data" && failMarketDataWrite) {
        return jsonResponse({}, 500);
      }
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
      return jsonResponse({}, 201);
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
    return jsonResponse(rows);
  };
  const service = createMarketDataService({
    fetchImpl,
    now: () => clock.value,
    logger: { error() {} },
    markets: configured
  });
  return { service, writes, providerCalls, database, clock };
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
        return { activeMarkets: 4, marketsWithData: 3, items: [] };
      }
    }
  });
  const response = responseCapture();
  await handler(authenticatedRequest("/api/market-summary"), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).data, {
    activeMarkets: 4,
    marketsWithData: 3,
    items: []
  });
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
