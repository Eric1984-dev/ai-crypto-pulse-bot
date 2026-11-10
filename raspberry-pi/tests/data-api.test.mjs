import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/api/server.mjs";
import { AiDecisionsRepository } from "../src/repositories/ai-decisions-repository.mjs";
import { MarketDataRepository } from "../src/repositories/market-data-repository.mjs";
import { RuntimeStatusRepository } from "../src/repositories/runtime-status-repository.mjs";
import {
  MAX_ENABLED_MARKETS,
  WatchedMarketsRepository
} from "../src/repositories/watched-markets-repository.mjs";

const markets = [
  { id: "00000000-0000-0000-0000-000000000001", symbol: "BTC-EUR", enabled: true, priority: 1 },
  { id: "00000000-0000-0000-0000-000000000002", symbol: "ETH-EUR", enabled: true, priority: 2 }
];
const capturedAt = "2026-11-10T18:00:00.000Z";
const marketDataRows = [
  {
    symbol: "BTC-EUR",
    price: "90000.25",
    volume: "10.5",
    daily_change: "2.25",
    high_24h: "92000",
    low_24h: "88000",
    captured_at: capturedAt
  }
];
const candleRows = [
  {
    symbol: "BTC-EUR",
    interval: "1m",
    open: "89900",
    high: "90100",
    low: "89800",
    close: "90000",
    volume: "0.5",
    timestamp: capturedAt
  }
];
const decisionRows = [
  {
    id: "00000000-0000-0000-0000-000000000010",
    symbol: "BTC-EUR",
    decision: "HOLD",
    confidence: "72.5",
    reason: "Trend is consolidating.",
    strategy_name: null,
    strategy_version: null,
    created_at: capturedAt
  }
];
const statusRow = {
  status: "ANALYZING",
  is_active: true,
  is_analyzing: true,
  last_run: capturedAt,
  updated_at: capturedAt
};
const trustedAuthenticationProvider = {
  async authenticate() {
    return { principal: { subject: "read-only-test-user", roles: ["reader"] } };
  }
};

function createPool({
  marketRows = markets,
  snapshots = marketDataRows,
  candles = candleRows,
  decisions = decisionRows,
  status = statusRow,
  failOn
} = {}) {
  const queries = [];
  const pool = {
    queries,
    async connect() {
      return {
        async query(sql, values = []) {
          queries.push({ sql, values });
          if (sql === "BEGIN READ ONLY" || sql === "COMMIT" || sql === "ROLLBACK") {
            return { rows: [] };
          }
          if (failOn && sql.includes(failOn)) {
            const error = new Error("database credentials and query text must not escape");
            error.code = "ECONNREFUSED";
            throw error;
          }
          if (sql.includes('FROM public."AI_Crypto_Bot_AI_Decisions"')) {
            return { rows: decisions.slice(0, values[0]) };
          }
          if (sql.includes('FROM public."AI_Crypto_Bot_Status"')) {
            return { rows: status ? [status] : [] };
          }
          if (sql.includes('FROM public."AI_Crypto_Bot_Candles"')) {
            return {
              rows: candles.filter((row) => row.symbol === values[0] && row.interval === values[1])
                .slice(0, values[2])
            };
          }
          if (sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets" AS watched_market')
            && sql.includes("ANY($1::text[])")) {
            return {
              rows: snapshots.filter((snapshot) =>
                marketRows.some((market) =>
                  market.enabled === true
                  && market.symbol === snapshot.symbol
                  && values[0].includes(snapshot.symbol)))
                .slice(0, values[1])
            };
          }
          if (sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets" AS watched_market')
            && sql.includes("AND watched_market.symbol = $1")) {
            const enabled = marketRows.some((market) =>
              market.enabled === true && market.symbol === values[0]);
            return {
              rows: enabled
                ? snapshots.filter((row) => row.symbol === values[0]).slice(0, values[1])
                : []
            };
          }
          if (sql.includes('FROM public."AI_Crypto_Bot_Market_Data"')) {
            const symbol = values[0];
            const enabled = marketRows.some((market) =>
              market.enabled === true && market.symbol === symbol);
            return { rows: enabled ? snapshots.filter((row) => row.symbol === symbol).slice(0, 1) : [] };
          }
          if (sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets"')) {
            if (sql.includes("AND symbol = $1")) {
              const found = marketRows.find((market) =>
                market.symbol === values[0] && market.enabled === true);
              return { rows: found ? [found] : [] };
            }
            return { rows: marketRows.filter(({ enabled }) => enabled === true).slice(0, values[0]) };
          }
          throw new Error(`Unexpected SQL in read-only API test: ${sql}`);
        },
        release() {}
      };
    }
  };
  return pool;
}

function createRepositories(pool, logger = { error() {} }) {
  return {
    watchedMarkets: new WatchedMarketsRepository(pool, { logger }),
    marketData: new MarketDataRepository(pool, { logger }),
    aiDecisions: new AiDecisionsRepository(pool, { logger }),
    runtimeStatus: new RuntimeStatusRepository(pool, { logger })
  };
}

async function withServer(options, run) {
  const server = createApiServer({
    readiness: { async check() { return true; } },
    getOperationalHealth: () => ({}),
    authenticationProvider: trustedAuthenticationProvider,
    logger: { info() {}, error() {} },
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
}

test("repositories select explicit columns with bounded parameterized queries", async () => {
  const pool = createPool();
  const repositories = createRepositories(pool);

  assert.deepEqual(await repositories.watchedMarkets.listEnabled(), markets);
  assert.equal((await repositories.watchedMarkets.findEnabledBySymbol("BTC-EUR")).symbol, "BTC-EUR");
  assert.equal((await repositories.marketData.findForEnabledSymbol("BTC-EUR")).price, 90000.25);
  assert.equal((await repositories.marketData.listForEnabledMarkets(markets))[0].volume, 10.5);
  assert.equal((await repositories.marketData.listCandles("BTC-EUR", "1m"))[0].close, 90000);
  assert.equal((await repositories.aiDecisions.listRecent())[0].confidence, 72.5);
  assert.equal((await repositories.runtimeStatus.getStatus()).status, "ANALYZING");

  const statements = pool.queries
    .map(({ sql }) => sql.trim())
    .filter((sql) => sql !== "BEGIN READ ONLY" && sql !== "COMMIT");
  assert.ok(statements.every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert.ok(statements.every((sql) => !/\bSELECT\s+\*/i.test(sql)));
  assert.ok(statements.every((sql) => /\bLIMIT\s+\$\d+/i.test(sql)));
  assert.ok(pool.queries.some(({ values }) => values.includes("BTC-EUR")));
  assert.ok(pool.queries.every(({ sql }) =>
    sql === "BEGIN READ ONLY" || sql === "COMMIT" || /^\s*SELECT\b/i.test(sql)));
});

test("watched market repository caps its enabled-market query", async () => {
  const pool = createPool();
  await new WatchedMarketsRepository(pool).listEnabled();
  const query = pool.queries.find(({ sql }) =>
    sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets"'));
  assert.equal(query.values[0], MAX_ENABLED_MARKETS + 1);
});

test("GET /api/v1/markets returns only existing enabled watched markets", async () => {
  const pool = createPool({
    marketRows: [markets[0], { ...markets[1], enabled: false }]
  });
  await withServer({ dataRepositories: createRepositories(pool) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/markets`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { count: 1, items: [markets[0]] }
    });
    assert.equal(pool.queries.some(({ sql }) => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER)\b/i.test(sql)), false);
  });
});

test("GET /api/v1/market validates symbol, interval, limit, and tracked state", async () => {
  const pool = createPool();
  await withServer({ dataRepositories: createRepositories(pool) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/market?symbol=BTC-EUR`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: {
        symbol: "BTC-EUR",
        interval: "1m",
        marketData: {
          ...marketDataRows[0],
          price: 90000.25,
          volume: 10.5,
          daily_change: 2.25,
          high_24h: 92000,
          low_24h: 88000
        },
        candles: [{
          ...candleRows[0],
          open: 89900,
          high: 90100,
          low: 89800,
          close: 90000,
          volume: 0.5
        }],
        refreshStatus: "read-only"
      }
    });
    const candleQuery = pool.queries.find(({ sql }) =>
      sql.includes('FROM public."AI_Crypto_Bot_Candles"'));
    assert.deepEqual(candleQuery.values, ["BTC-EUR", "1m", 200]);
  });

  await withServer({
    dataRepositories: createRepositories(createPool({
      marketRows: [markets[0], { ...markets[1], enabled: false }]
    }))
  }, async (baseUrl) => {
    const cases = [
      ["/api/v1/market", 400, "INVALID_MARKET"],
      ["/api/v1/market?symbol=btc-eur", 400, "INVALID_MARKET"],
      ["/api/v1/market?symbol=BTC-EUR&interval=2m", 400, "INVALID_INTERVAL"],
      ["/api/v1/market?symbol=BTC-EUR&limit=501", 400, "INVALID_LIMIT"],
      ["/api/v1/market?symbol=BTC-EUR&limit=1&limit=2", 400, "INVALID_QUERY"],
      ["/api/v1/market?symbol=ETH-EUR", 404, "MARKET_NOT_TRACKED"],
      ["/api/v1/market?symbol=NOPE-EUR", 404, "MARKET_NOT_TRACKED"]
    ];
    for (const [path, status, code] of cases) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, status, path);
      assert.equal((await response.json()).error.code, code);
    }
  });
});

test("data endpoints fail closed when no authentication provider is configured", async () => {
  const pool = createPool();
  await withServer({
    dataRepositories: createRepositories(pool),
    authenticationProvider: { async authenticate() { return null; } }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/markets`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
    assert.equal(pool.queries.length, 0);
  });
});

test("market endpoint accepts empty snapshot/candle sets for an enabled market", async () => {
  const pool = createPool({ snapshots: [], candles: [] });
  await withServer({ dataRepositories: createRepositories(pool) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/market?symbol=BTC-EUR&interval=1d&limit=10`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
      symbol: "BTC-EUR",
      interval: "1d",
      marketData: null,
      candles: [],
      refreshStatus: "read-only"
    });
  });
});

test("agent status preserves its existing status envelope and returns null for missing or unknown status", async () => {
  for (const [statusRowValue, expected] of [
    [statusRow, "ANALYZING"],
    [{ ...statusRow, status: "UNKNOWN" }, null],
    [null, null]
  ]) {
    const pool = createPool({ status: statusRowValue });
    await withServer({ dataRepositories: createRepositories(pool) }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/agent-status`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { data: { status: expected } });
    });
  }
});

test("market summary and dashboard expose bounded stored data without synthesizing absent dashboard metrics", async () => {
  const pool = createPool();
  await withServer({
    dataRepositories: createRepositories(pool),
    now: () => new Date("2026-11-10T19:00:00.000Z")
  }, async (baseUrl) => {
    const summary = await fetch(`${baseUrl}/api/v1/market-summary`);
    assert.equal(summary.status, 200);
    assert.deepEqual(await summary.json(), {
      data: {
        activeMarkets: 2,
        marketsWithData: 1,
        items: [{
          ...marketDataRows[0],
          price: 90000.25,
          volume: 10.5,
          daily_change: 2.25,
          high_24h: 92000,
          low_24h: 88000
        }],
        refreshedAt: capturedAt,
        refreshStatus: "read-only"
      }
    });

    const dashboard = await fetch(`${baseUrl}/api/v1/dashboard-data`);
    assert.equal(dashboard.status, 200);
    const body = await dashboard.json();
    assert.equal(body.data.generatedAt, "2026-11-10T19:00:00.000Z");
    assert.deepEqual(body.data.agentStatus, statusRow);
    assert.equal(body.data.watchedMarkets.count, 2);
    assert.equal(body.data.aiDecisions.count, 1);
    assert.equal(body.data.marketData.count, 1);
    assert.equal(Object.hasOwn(body.data, "portfolio"), false);
  });
});

test("data endpoints reject unknown query parameters and map database failures to safe 503s", async () => {
  const pool = createPool({ failOn: "AI_Crypto_Bot_Watched_Markets" });
  await withServer({ dataRepositories: createRepositories(pool) }, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/v1/markets?enabled=false`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_QUERY");

    const unavailable = await fetch(`${baseUrl}/api/v1/markets`);
    const body = await unavailable.json();
    assert.equal(unavailable.status, 503);
    assert.equal(body.error.code, "MARKETS_UNAVAILABLE");
    assert.equal(JSON.stringify(body).includes("credentials"), false);
    assert.equal(JSON.stringify(body).includes("SELECT"), false);
  });
});
