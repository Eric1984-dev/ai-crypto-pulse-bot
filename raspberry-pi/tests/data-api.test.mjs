import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/api/server.mjs";
import { buildDashboardAnalytics } from "../src/services/dashboard-analytics.mjs";
import { AiDecisionsRepository } from "../src/repositories/ai-decisions-repository.mjs";
import { MarketDataRepository } from "../src/repositories/market-data-repository.mjs";
import { RuntimeStatusRepository } from "../src/repositories/runtime-status-repository.mjs";
import {
  RepositoryDataError,
  RepositoryUnavailableError
} from "../src/repositories/postgres-read.mjs";
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
    indicators: {},
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
            if (sql.includes("COUNT(*)")) {
              return { rows: [{ total_count: decisions.length }] };
            }
            if (sql.includes("OFFSET $2")) {
              return {
                rows: decisions.slice(values[1], values[1] + values[0])
              };
            }
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

function createRepositories(pool, logger = { error() {} }, dashboardOverrides = {}) {
  return {
    watchedMarkets: new WatchedMarketsRepository(pool, { logger }),
    marketData: new MarketDataRepository(pool, { logger }),
    aiDecisions: new AiDecisionsRepository(pool, { logger }),
    dashboard: {
      async getSystemDashboardData() {
        return {
          portfolio: {
            count: 0,
            portfolioValue: null,
            totalPnl: null,
            realizedPnl: null,
            unrealizedPnl: null,
            dailyPnl: 0,
            dailyPnlTradeCount: 0,
            availableBalance: null,
            winRate: null,
            winRateTradeCount: 0
          },
          openPositions: { count: 0, items: [] },
          openPositionAiStatus: { count: 0, items: [] },
          recentTrades: { count: 0, items: [] },
          portfolioSnapshots: [],
          emergencyState: { status: "NORMAL" },
          lastMarketDataAt: null
        };
      },
      async getShadowExitScenarios() {
        return { status: "AVAILABLE", positions: [] };
      },
      async getTradeHistory({ page, pageSize }) {
        return {
          page,
          pageSize: pageSize || 25,
          totalCount: 0,
          totalPages: 0,
          items: [],
          stats: {
            closedTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            averageProfit: null,
            averageLoss: null,
            bestTrade: null,
            worstTrade: null
          }
        };
      },
      async getAnalytics() {
        return {
          generatedAt: capturedAt,
          period: "30d",
          periodStart: capturedAt,
          tradePerformance: { closedTrades: 0 },
          aiPerformance: { decisionCount: 0, confidenceBuckets: [] },
          portfolio: { equityCurve: [] },
          dataQuality: {}
        };
      },
      async getExportRecordCount() {
        return 1;
      },
      async getExportRecords() {
        return [{
          created_at: capturedAt,
          symbol: "BTC-EUR",
          side: "BUY",
          price: "90000.25",
          quantity: "0.5",
          fees: "10.00",
          realized_pnl: "0"
        }];
      },
      async getMonitoringMetrics() {
        return {
          databaseSizeBytes: 1024,
          estimatedRows: {
            candles: 200000,
            decisions: 5000,
            trades: 12,
            positions: 3
          }
        };
      },
      ...dashboardOverrides
    },
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

test("dashboard data routes allow anonymous read-only access when Access is disabled", async () => {
  const pool = createPool();
  await withServer({
    dataRepositories: createRepositories(pool),
    authenticationProvider: undefined,
    cloudflareAccess: { enabled: false },
    allowedOrigins: ["https://dashboard.example.com"]
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/markets`, {
      headers: { Origin: "https://dashboard.example.com" }
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://dashboard.example.com"
    );
    assert.deepEqual(await response.json(), {
      data: { count: markets.length, items: markets }
    });
    assert.ok(pool.queries.every(({ sql }) => sql !== "BEGIN READ WRITE"));
    const write = await fetch(`${baseUrl}/api/v1/markets`, { method: "POST" });
    assert.equal(write.status, 405);
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

test("AI decision history is paginated and includes reasoning and indicators", async () => {
  const history = [
    { ...decisionRows[0], reason: "Recent decision", indicators: { rsi: 54 } },
    {
      ...decisionRows[0],
      id: "00000000-0000-0000-0000-000000000011",
      symbol: "ETH-EUR",
      reason: "Earlier decision",
      indicators: { rsi: 48 }
    }
  ];
  const pool = createPool({ decisions: history });
  await withServer({ dataRepositories: createRepositories(pool) }, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=ai-history&page=2&pageSize=1`
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
      page: 2,
      pageSize: 1,
      totalCount: 2,
      totalPages: 2,
      items: [{
        ...history[1],
        confidence: 72.5
      }]
    });
    const select = pool.queries.find(({ sql }) =>
      sql.includes('FROM public."AI_Crypto_Bot_AI_Decisions"')
      && sql.includes("OFFSET $2"));
    assert.deepEqual(select.values, [1, 1]);
  });

  await withServer({ dataRepositories: createRepositories(createPool()) }, async (baseUrl) => {
    for (const query of ["page=0", "pageSize=0", "pageSize=101"]) {
      const response = await fetch(
        `${baseUrl}/api/v1/dashboard-data?view=ai-history&${query}`
      );
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).error.code, "INVALID_QUERY", query);
    }
  });
});

test("market summary and dashboard expose bounded stored data without synthesizing absent dashboard metrics", async () => {
  const pool = createPool();
  await withServer({
    dataRepositories: createRepositories(pool),
    now: () => new Date("2026-11-10T19:00:00.000Z")
  }, async (baseUrl) => {
    const summary = await fetch(`${baseUrl}/api/v1/market-summary`);
    assert.equal(summary.status, 200);
    const scanner = (await summary.json()).data.scanner;
    assert.equal(scanner.activeMarkets, 2);
    assert.equal(scanner.generatedAt, "2026-11-10T19:00:00.000Z");
    assert.equal(scanner.marketsWithFreshData, 0);
    assert.equal(scanner.marketsWithDecisions, 1);
    assert.equal(scanner.timeframes["24h"].aiOpportunities[0].symbol, "BTC-EUR");

    const dashboard = await fetch(`${baseUrl}/api/v1/dashboard-data`);
    assert.equal(dashboard.status, 200);
    const body = await dashboard.json();
    assert.equal(body.data.generatedAt, "2026-11-10T19:00:00.000Z");
    assert.deepEqual(body.data.agentStatus, statusRow);
    assert.equal(body.data.watchedMarkets.count, 2);
    assert.equal(body.data.aiDecisions.count, 1);
    assert.equal(body.data.marketData.count, 1);
    assert.equal(body.data.portfolio.count, 0);
    assert.equal(body.data.openPositions.count, 0);
    assert.deepEqual(body.data.shadowExitScenarios, {
      status: "AVAILABLE",
      positions: []
    });
    assert.equal(body.data.recentTrades.count, 0);
    assert.equal(body.data.emergencyState.status, "NORMAL");
  });
});

test("shadow-exit dashboard read failures are explicit without failing dashboard data", async () => {
  const pool = createPool();
  await withServer({
    dataRepositories: createRepositories(pool, { error() {} }, {
      async getShadowExitScenarios() {
        throw new RepositoryUnavailableError(new Error("permission denied"));
      }
    })
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/dashboard-data`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.shadowExitScenarios, {
      status: "UNAVAILABLE",
      positions: []
    });
    assert.equal(body.data.portfolio.count, 0);
  });
});

test("analytics endpoint returns the page's chart and metric contract", async () => {
  const now = new Date("2026-11-10T19:00:00.000Z");
  const analytics = buildDashboardAnalytics({
    period: "30d",
    now,
    portfolio: { starting_balance: 10000, portfolio_value: 10100 },
    positions: [{ symbol: "BTC-EUR", status: "OPEN", unrealized_pnl: 10 }],
    trades: [{
      id: "trade-1",
      ai_decision_id: "decision-1",
      symbol: "BTC-EUR",
      side: "SELL",
      price: 51000,
      quantity: 0.01,
      fees: 0.25,
      realized_pnl: 5,
      created_at: "2026-11-10T18:30:00.000Z"
    }],
    decisions: [{
      id: "decision-1",
      symbol: "BTC-EUR",
      decision: "BUY",
      confidence: 82,
      strategy_name: null,
      strategy_version: null,
      created_at: "2026-11-10T18:00:00.000Z"
    }],
    snapshots: [{
      id: "snapshot-1",
      portfolio_id: "portfolio-1",
      portfolio_value: 10100,
      available_balance: 8000,
      open_positions: 1,
      captured_at: "2026-11-10T18:00:00.000Z"
    }]
  });
  let requestedPeriod;
  const repositories = createRepositories(createPool(), undefined, {
    async getAnalytics(options) {
      requestedPeriod = options.period;
      return analytics;
    }
  });

  await withServer({ dataRepositories: repositories }, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=analytics&period=30d`
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(requestedPeriod, "30d");
    assert.equal(body.data.period, "30d");
    assert.ok(body.data.tradePerformance);
    assert.ok(body.data.aiPerformance);
    assert.ok(Array.isArray(body.data.aiPerformance.confidenceBuckets));
    assert.ok(body.data.aiPerformance.actions.BUY);
    assert.equal(body.data.aiPerformance.bySymbol[0].label, "BTC-EUR");
    assert.equal(body.data.aiPerformance.bySymbol[0].netPnl, 5);
    assert.ok(Array.isArray(body.data.portfolio.equityCurve));
    assert.ok(Array.isArray(body.data.portfolio.drawdownHistory));
    assert.ok(Array.isArray(body.data.portfolio.dailyPerformance));
    assert.ok(body.data.exportCounts);
  });
});

test("analytics and recommendations endpoints handle recommendation generator inputs", async () => {
  const now = new Date("2026-11-10T19:00:00.000Z");
  const decisions = Array.from({ length: 12 }, (_, index) => ({
    id: `decision-${index}`,
    symbol: "BTC-EUR",
    decision: "SELL",
    confidence: index < 10 ? 72 : 82,
    strategy_name: index < 10 ? "Weak" : "Better",
    strategy_version: "1.0",
    created_at: new Date(now.getTime() - (12 - index) * 60000).toISOString()
  }));
  const trades = decisions.map((decision, index) => ({
    id: `trade-${index}`,
    ai_decision_id: decision.id,
    symbol: decision.symbol,
    side: "SELL",
    price: 100,
    quantity: 1,
    fees: 0,
    realized_pnl: index < 10 ? -10 : 10,
    created_at: decision.created_at
  }));
  const snapshots = Array.from({ length: 10 }, (_, index) => ({
    id: `snapshot-${index}`,
    portfolio_id: "portfolio-1",
    portfolio_value: index < 9 ? 1000 : 900,
    available_balance: index < 9 ? 1000 : 900,
    open_positions: 0,
    captured_at: new Date(now.getTime() - (10 - index) * 86400000).toISOString()
  }));
  const analytics = buildDashboardAnalytics({
    period: "30d",
    now,
    portfolio: { starting_balance: 1000, portfolio_value: 900 },
    positions: [],
    trades,
    decisions,
    snapshots
  });
  const repositories = createRepositories(createPool(), undefined, {
    async getAnalytics() {
      return analytics;
    }
  });

  await withServer({ dataRepositories: repositories }, async (baseUrl) => {
    const analyticsResponse = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=analytics&period=30d`
    );
    assert.equal(analyticsResponse.status, 200);
    const analyticsBody = await analyticsResponse.json();
    assert.equal(analyticsBody.data.exportCounts.recommendations, 3);
    assert.equal(analytics.aiPerformance.confidenceBuckets[0].tradeCount, 10);
    assert.equal(
      analytics.aiPerformance.strategies.find(({ label }) => label.startsWith("Weak")).tradeCount,
      10
    );
    assert.equal(analytics.portfolio.snapshotCount, 10);
    assert.equal(analytics.portfolio.maxDrawdown, 10);

    const recommendationsResponse = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=recommendations&period=30d`
    );
    assert.equal(recommendationsResponse.status, 200);
    const recommendationsBody = await recommendationsResponse.json();
    assert.equal(recommendationsBody.data.analysisPeriod, "30d");
    assert.equal(recommendationsBody.data.insufficientData, false);
    assert.equal(recommendationsBody.data.recommendations.length, 3);
    assert.equal(recommendationsBody.data.categories.length, 5);
  });
});

test("analytics failures retain a safe diagnostic linked to the response request ID", async () => {
  const logs = [];
  const repositories = createRepositories(createPool(), undefined, {
    async getAnalytics() {
      throw new RepositoryDataError("analytics decisions exceed the bounded query limit");
    }
  });
  await withServer({
    dataRepositories: repositories,
    logger: {
      info() {},
      error(message) { logs.push(JSON.parse(message)); }
    }
  }, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=analytics&period=30d`
    );
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "ANALYTICS_UNAVAILABLE");
    const diagnostic = logs.find(({ event }) => event === "dashboard_repository_failed");
    assert.equal(diagnostic.requestId, body.error.requestId);
    assert.equal(diagnostic.view, "analytics");
    assert.equal(diagnostic.reason, "analytics decisions exceed the bounded query limit");
  });
});

test("trade history endpoint normalizes browser side filters and returns pagination data", async () => {
  let requested;
  const history = {
    page: 2,
    pageSize: 25,
    totalCount: 26,
    totalPages: 2,
    items: [{
      id: "trade-1",
      symbol: "BTC-EUR",
      side: "SELL",
      price: 51000,
      quantity: 0.01,
      fees: 0.25,
      realized_pnl: 9,
      created_at: "2026-11-10T18:00:00.000Z"
    }],
    stats: {
      closedTrades: 1,
      winningTrades: 1,
      losingTrades: 0,
      averageProfit: 9,
      averageLoss: null,
      bestTrade: 9,
      worstTrade: 9
    }
  };
  const repositories = createRepositories(createPool(), undefined, {
    async getTradeHistory(options) {
      requested = options;
      return history;
    }
  });

  await withServer({ dataRepositories: repositories }, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=trade-history&page=2&side=sell&period=7d&search=BTC&sort=pnl-low`
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual({
      page: body.data.page,
      pageSize: body.data.pageSize,
      totalCount: body.data.totalCount,
      totalPages: body.data.totalPages,
      itemCount: body.data.items.length
    }, {
      page: 2,
      pageSize: 25,
      totalCount: 26,
      totalPages: 2,
      itemCount: 1
    });
    assert.equal(requested.page, 2);
    assert.equal(requested.side, "SELL");
    assert.equal(requested.period, "7d");
    assert.equal(requested.search, "BTC");
    assert.equal(requested.sort, "pnl-low");
    assert.ok(requested.now instanceof Date);
  });
});

test("export routes provide bounded counts and read-only CSV output", async () => {
  const pool = createPool();
  await withServer({
    dataRepositories: createRepositories(pool),
    now: () => new Date("2026-11-10T19:00:00.000Z")
  }, async (baseUrl) => {
    const countResponse = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=export-count&type=trades&period=7d`
    );
    assert.equal(countResponse.status, 200);
    assert.deepEqual(await countResponse.json(), {
      data: { exportType: "trades", period: "7d", recordCount: 1 }
    });

    const csvResponse = await fetch(
      `${baseUrl}/api/v1/dashboard-data?view=export&type=trades&period=7d`
    );
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get("content-type"), /text\/csv/);
    assert.equal(csvResponse.headers.get("x-export-record-count"), "1");
    const csv = await csvResponse.text();
    assert.match(csv, /Date,Symbol,Action,Entry Price/);
    assert.match(csv, /BTC-EUR,BUY,90000\.25,0\.5/);
    assert.equal(pool.queries.some(({ sql }) => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)), false);
  });
});

test("monitoring route returns runtime, system, and estimated database metrics", async () => {
  const pool = createPool();
  await withServer({
    dataRepositories: createRepositories(pool),
    getOperationalHealth: () => ({ status: "healthy" }),
    getSystemMetrics: async () => ({
      cpuUsagePercent: 12.5,
      loadAverage: [0.1, 0.2, 0.3],
      memory: { totalBytes: 1000, availableBytes: 400, usedPercent: 60 },
      temperatureC: 42.5,
      disk: { totalBytes: 2000, availableBytes: 500, usedPercent: 75 }
    }),
    now: () => new Date("2026-11-10T19:00:00.000Z")
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/monitoring`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, {
      server: "online",
      postgresql: "online",
      database: "online",
      diskUsage: 75,
      databaseSize: "1.0 KB",
      lastHealthCheck: "2026-11-10T19:00:00.000Z",
      runtime: { status: "healthy" },
      system: {
        cpuUsagePercent: 12.5,
        loadAverage: [0.1, 0.2, 0.3],
        memory: { totalBytes: 1000, availableBytes: 400, usedPercent: 60 },
        temperatureC: 42.5,
        disk: { totalBytes: 2000, availableBytes: 500, usedPercent: 75 }
      },
      databaseSizeBytes: 1024,
      tableRowsAreEstimated: true,
      tableCounts: { candles: 200000, decisions: 5000, trades: 12, positions: 3 },
      stages: null,
      agentStatus: "ANALYZING"
    });
    assert.equal(pool.queries.some(({ sql }) => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)), false);
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
