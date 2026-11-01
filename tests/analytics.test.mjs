import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../api/dashboard-data.mjs";
import {
  createAnalyticsService
} from "../lib/analytics.mjs";
import {
  createAnalyticsExportsService,
  getAnalyticsExportCounts,
  getAnalyticsExportRows
} from "../lib/analytics-exports.mjs";

const config = {
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "test-anon-key"
};
const accessToken = "header.payload.signature";
const now = new Date("2026-03-21T12:00:00.000Z");

function createAnalyticsRows() {
  return {
    AI_Crypto_Bot_Portfolios: [{
      id: "portfolio-1",
      starting_balance: "1000",
      portfolio_value: "1015"
    }],
    AI_Crypto_Bot_Positions: [
      {
        portfolio_id: "portfolio-1",
        symbol: "BTC-EUR",
        unrealized_pnl: "0",
        status: "CLOSED"
      },
      {
        portfolio_id: "portfolio-1",
        symbol: "ETH-EUR",
        unrealized_pnl: "-5",
        status: "OPEN"
      }
    ],
    AI_Crypto_Bot_Trades: [
      {
        id: "btc-buy",
        portfolio_id: "portfolio-1",
        ai_decision_id: "decision-btc-buy",
        symbol: "BTC-EUR",
        side: "BUY",
        realized_pnl: "0",
        created_at: "2026-03-19T10:01:00.000Z"
      },
      {
        id: "btc-sell",
        portfolio_id: "portfolio-1",
        ai_decision_id: "decision-btc-sell",
        symbol: "BTC-EUR",
        side: "SELL",
        realized_pnl: "20",
        created_at: "2026-03-20T10:01:00.000Z"
      },
      {
        id: "eth-buy",
        portfolio_id: "portfolio-1",
        ai_decision_id: "decision-eth-buy",
        symbol: "ETH-EUR",
        side: "BUY",
        realized_pnl: "0",
        created_at: "2026-03-20T11:00:00.000Z"
      }
    ],
    AI_Crypto_Bot_AI_Decisions: [
      {
        id: "decision-btc-buy",
        symbol: "BTC-EUR",
        decision: "BUY",
        confidence: "72",
        strategy_name: "Momentum",
        strategy_version: "1.0",
        created_at: "2026-03-19T10:00:00.000Z"
      },
      {
        id: "decision-btc-hold",
        symbol: "BTC-EUR",
        decision: "HOLD",
        confidence: "77",
        strategy_name: "Momentum",
        strategy_version: "1.0",
        created_at: "2026-03-19T12:00:00.000Z"
      },
      {
        id: "decision-btc-sell",
        symbol: "BTC-EUR",
        decision: "SELL",
        confidence: "86",
        strategy_name: "Momentum",
        strategy_version: "1.0",
        created_at: "2026-03-20T10:00:00.000Z"
      },
      {
        id: "decision-eth-idle-hold",
        symbol: "ETH-EUR",
        decision: "HOLD",
        confidence: "65",
        strategy_name: null,
        strategy_version: null,
        created_at: "2026-03-20T10:30:00.000Z"
      },
      {
        id: "decision-eth-buy",
        symbol: "ETH-EUR",
        decision: "BUY",
        confidence: "89",
        strategy_name: "Trend",
        strategy_version: "2.0",
        created_at: "2026-03-20T10:59:00.000Z"
      },
      {
        id: "decision-eth-hold",
        symbol: "ETH-EUR",
        decision: "HOLD",
        confidence: "83",
        strategy_name: "Trend",
        strategy_version: "2.0",
        created_at: "2026-03-20T11:30:00.000Z"
      }
    ],
    AI_Crypto_Bot_Portfolio_Snapshots: [
      {
        id: "snapshot-1",
        portfolio_id: "portfolio-1",
        portfolio_value: "1000",
        captured_at: "2026-03-18T00:00:00.000Z"
      },
      {
        id: "snapshot-2",
        portfolio_id: "portfolio-1",
        portfolio_value: "1100",
        captured_at: "2026-03-19T10:00:00.000Z"
      },
      {
        id: "snapshot-3",
        portfolio_id: "portfolio-1",
        portfolio_value: "1050",
        captured_at: "2026-03-20T10:00:00.000Z"
      }
    ]
  };
}

function createSupabaseFetch({ rows = createAnalyticsRows(), calls = [], failTable = null } = {}) {
  return async (url, options) => {
    const parsedUrl = new URL(url);
    const table = parsedUrl.pathname.split("/").pop();
    const query = parsedUrl.searchParams;
    calls.push({ table, query: new URLSearchParams(query), options });
    if (table === failTable) {
      return { status: 500, ok: false };
    }

    let matchingRows = [...(rows[table] || [])];
    const order = query.get("order");
    if (order) {
      const sortFields = order.split(",");
      matchingRows.sort((left, right) => {
        for (const sortField of sortFields) {
          const [field, direction] = sortField.split(".");
          const comparison = String(left[field] ?? "").localeCompare(String(right[field] ?? ""));
          if (comparison !== 0) {
            return direction === "desc" ? -comparison : comparison;
          }
        }
        return 0;
      });
    }

    const [start, end] = options.headers.range.split("-").map(Number);
    const pageRows = matchingRows.slice(start, end + 1);
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      async json() { return pageRows; }
    };
  };
}

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    write(chunk) {
      this.body += chunk;
      return true;
    },
    end(chunk = "") {
      this.body += chunk;
      this.ended = true;
    },
    destroy() {
      this.destroyed = true;
    }
  };
}

function loadAnalytics(rows = createAnalyticsRows(), calls = []) {
  const service = createAnalyticsService({ fetchImpl: createSupabaseFetch({ rows, calls }) });
  return service.load({ config, accessToken, now });
}

test("analytics calculates trade P&L, win/loss rates, profit factor, and hold time", async () => {
  const analytics = await loadAnalytics();
  const trades = analytics.tradePerformance;

  assert.equal(trades.closedTrades, 1);
  assert.equal(trades.winningTrades, 1);
  assert.equal(trades.losingTrades, 0);
  assert.equal(trades.breakevenTrades, 0);
  assert.equal(trades.winRate, 100);
  assert.equal(trades.lossRate, 0);
  assert.equal(trades.averageWin, 20);
  assert.equal(trades.averageLoss, null);
  assert.equal(trades.profitFactor, null);
  assert.equal(trades.realizedPnl, 20);
  assert.equal(trades.unrealizedPnl, -5);
  assert.equal(trades.totalPnl, 15);
  assert.equal(trades.averageHoldTimeSeconds, 86400);
  assert.deepEqual(trades.bestTrade, {
    symbol: "BTC-EUR",
    date: "2026-03-20T10:01:00.000Z",
    realizedPnl: 20
  });
  assert.deepEqual(trades.largestWinner, trades.bestTrade);
  assert.equal(trades.openPositions, 1);
  assert.equal(trades.closedPositions, 1);
});

test("confidence boundaries and BUY, SELL, HOLD outcome attribution are explicit", async () => {
  const analytics = await loadAnalytics();
  const ai = analytics.aiPerformance;

  assert.equal(ai.decisionCount, 6);
  assert.equal(ai.below70Count, 1);
  assert.deepEqual(ai.confidenceBuckets.map(({ label, decisionCount }) => [label, decisionCount]), [
    ["70–75", 1],
    ["75–80", 1],
    ["80–85", 1],
    ["85+", 2]
  ]);
  assert.equal(ai.actions.BUY.scoredCount, 2);
  assert.equal(ai.actions.BUY.wins, 1);
  assert.equal(ai.actions.BUY.losses, 1);
  assert.equal(ai.actions.BUY.netPnl, 15);
  assert.equal(ai.actions.SELL.scoredCount, 1);
  assert.equal(ai.actions.HOLD.scoredCount, 2);
  assert.equal(ai.actions.HOLD.unscoredCount, 1);
  assert.equal(ai.actions.HOLD.winRate, 50);
  assert.equal(ai.bestConfidenceRange.label, "70–75");
  assert.equal(ai.worstConfidenceRange.label, "80–85");
  assert.equal(ai.strategies.length, 2);
  assert.equal(analytics.dataQuality.unpairedBuyTrades, 0);
  assert.equal(analytics.dataQuality.unmatchedSellTrades, 0);
  assert.equal(analytics.dataQuality.unmatchedDecisionTrades, 0);
});

test("confidence bucket boundaries are non-overlapping and include 100", async () => {
  const confidenceValues = [69.99, 70, 74.99, 75, 79.99, 80, 84.99, 85, 100];
  const rows = {
    AI_Crypto_Bot_Portfolios: [],
    AI_Crypto_Bot_Positions: [],
    AI_Crypto_Bot_Trades: [],
    AI_Crypto_Bot_Portfolio_Snapshots: [],
    AI_Crypto_Bot_AI_Decisions: confidenceValues.map((confidence, index) => ({
      id: `confidence-${index}`,
      symbol: `MARKET${index}-EUR`,
      decision: "WAIT",
      confidence: String(confidence),
      strategy_name: null,
      strategy_version: null,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    }))
  };
  const { aiPerformance } = await loadAnalytics(rows);

  assert.equal(aiPerformance.below70Count, 1);
  assert.deepEqual(aiPerformance.confidenceBuckets.map((bucket) => bucket.decisionCount), [2, 2, 2, 2]);
});

test("loss and breakeven calculations use SELL outcomes without treating zero as a loss", async () => {
  const rows = {
    AI_Crypto_Bot_Portfolios: [{
      id: "portfolio-1",
      starting_balance: "1000",
      portfolio_value: "1005"
    }],
    AI_Crypto_Bot_Positions: [],
    AI_Crypto_Bot_Trades: [10, -5, 0].map((pnl, index) => ({
      id: `sell-${index}`,
      portfolio_id: "portfolio-1",
      ai_decision_id: null,
      symbol: "BTC-EUR",
      side: "SELL",
      realized_pnl: String(pnl),
      created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    })),
    AI_Crypto_Bot_AI_Decisions: [],
    AI_Crypto_Bot_Portfolio_Snapshots: []
  };
  const { tradePerformance } = await loadAnalytics(rows);

  assert.equal(tradePerformance.closedTrades, 3);
  assert.ok(Math.abs(tradePerformance.winRate - 100 / 3) < 1e-10);
  assert.ok(Math.abs(tradePerformance.lossRate - 100 / 3) < 1e-10);
  assert.equal(tradePerformance.averageLoss, -5);
  assert.equal(tradePerformance.profitFactor, 2);
  assert.equal(tradePerformance.realizedPnl, 5);
  assert.equal(tradePerformance.breakevenTrades, 1);
  assert.equal(tradePerformance.largestLoser.realizedPnl, -5);
});

test("portfolio equity curve derives daily, weekly, monthly performance, growth, and drawdown", async () => {
  const { portfolio } = await loadAnalytics();

  assert.equal(portfolio.portfolioCount, 1);
  assert.equal(portfolio.startingBalance, 1000);
  assert.equal(portfolio.portfolioValue, 1015);
  assert.equal(portfolio.totalPnl, 15);
  assert.equal(portfolio.growthPercent, 1.5);
  assert.equal(portfolio.snapshotCount, 3);
  assert.ok(Math.abs(portfolio.maxDrawdown - (50 / 1100 * 100)) < 1e-10);
  assert.deepEqual(portfolio.equityCurve.map(({ period, portfolioValue }) => [period, portfolioValue]), [
    ["2026-03-18", 1000],
    ["2026-03-19", 1100],
    ["2026-03-20", 1050]
  ]);
  assert.equal(portfolio.dailyPerformance[2].pnl, -50);
  assert.deepEqual(portfolio.weeklyPerformance, [{
    period: "2026-03-16",
    portfolioValue: 1050,
    pnl: 50
  }]);
  assert.deepEqual(portfolio.monthlyPerformance, [{
    period: "2026-03",
    portfolioValue: 1050,
    pnl: 50
  }]);
});

test("empty analytics data returns safe empty metrics and valid report rows", async () => {
  const emptyRows = Object.fromEntries([
    "AI_Crypto_Bot_Portfolios",
    "AI_Crypto_Bot_Positions",
    "AI_Crypto_Bot_Trades",
    "AI_Crypto_Bot_AI_Decisions",
    "AI_Crypto_Bot_Portfolio_Snapshots"
  ].map((table) => [table, []]));
  const analytics = await loadAnalytics(emptyRows);

  assert.equal(analytics.tradePerformance.winRate, null);
  assert.equal(analytics.tradePerformance.totalPnl, null);
  assert.equal(analytics.tradePerformance.closedTrades, 0);
  assert.equal(analytics.portfolio.maxDrawdown, null);
  assert.deepEqual(analytics.portfolio.equityCurve, []);
  assert.equal(analytics.aiPerformance.decisionCount, 0);
  assert.equal(getAnalyticsExportRows("portfolio-analytics", analytics).rows.length, 0);
  assert.equal(getAnalyticsExportRows("trade-analytics", analytics).rows.length, 1);
  assert.equal(getAnalyticsExportRows("analytics-summary", analytics).rows.length, 18);
});

test("large trade histories are paginated in 500-row batches and fully aggregated", async () => {
  const rows = {
    AI_Crypto_Bot_Portfolios: [{
      id: "portfolio-1",
      starting_balance: "10000",
      portfolio_value: "11201"
    }],
    AI_Crypto_Bot_Positions: [],
    AI_Crypto_Bot_Trades: Array.from({ length: 1201 }, (_, index) => ({
      id: `trade-${String(index).padStart(4, "0")}`,
      portfolio_id: "portfolio-1",
      ai_decision_id: null,
      symbol: "BTC-EUR",
      side: "SELL",
      realized_pnl: "1",
      created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    })),
    AI_Crypto_Bot_AI_Decisions: [],
    AI_Crypto_Bot_Portfolio_Snapshots: []
  };
  const calls = [];
  const analytics = await loadAnalytics(rows, calls);
  const tradeRanges = calls
    .filter((call) => call.table === "AI_Crypto_Bot_Trades")
    .map((call) => call.options.headers.range);

  assert.equal(analytics.tradePerformance.closedTrades, 1201);
  assert.equal(analytics.tradePerformance.realizedPnl, 1201);
  assert.deepEqual(tradeRanges, ["0-499", "500-999", "1000-1499"]);
  assert.ok(calls.every((call) => call.options.cache === "no-store"));
  assert.ok(calls.every((call) => call.options.headers.authorization === `Bearer ${accessToken}`));
});

test("analytics export definitions produce CSV-ready summary, trade, portfolio, and AI rows", async () => {
  const analytics = await loadAnalytics();
  const counts = getAnalyticsExportCounts(analytics);

  assert.equal(counts["analytics-summary"], 18);
  assert.equal(counts["trade-analytics"], 2);
  assert.equal(counts["portfolio-analytics"], 3);
  assert.equal(counts["ai-analytics"], 12);
  assert.match(
    getAnalyticsExportRows("analytics-summary", analytics).rows[0].join(","),
    /^Win Rate,100,%/
  );
  assert.match(
    getAnalyticsExportRows("trade-analytics", analytics).rows[1].join(","),
    /^BTC-EUR,1,1,0,0,100/
  );
});

test("analytics CSV reuses the authenticated streaming response", async () => {
  const service = createAnalyticsExportsService({
    analyticsService: { load: async () => loadAnalytics() }
  });
  const response = createResponse();
  await service.streamCsv({
    config,
    accessToken,
    exportType: "trade-analytics",
    period: "all",
    now,
    response
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^text\/csv/);
  assert.match(response.headers["content-disposition"], /cryptopulse-trade-analytics-all\.csv/);
  assert.equal(response.body.startsWith("\uFEFF"), true);
  assert.match(response.body, /Symbol,Closed Trades,Winning Trades/);
  assert.match(response.body, /BTC-EUR,1,1,0,0,100/);
  assert.equal(response.ended, true);
});

test("dashboard-data serves analytics and its CSV counts through existing authenticated routes", async () => {
  const rows = createAnalyticsRows();
  const handler = createHandler({
    env: {
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey
    },
    verify: async (token) => token === accessToken,
    fetchImpl: createSupabaseFetch({ rows }),
    now: () => now
  });
  const analyticsResponse = createResponse();
  await handler({
    method: "GET",
    url: "/api/dashboard-data?view=analytics",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, analyticsResponse);
  assert.equal(analyticsResponse.statusCode, 200);
  const { data } = JSON.parse(analyticsResponse.body);
  assert.equal(data.aiPerformance.decisionCount, 6);
  assert.equal(data.exportCounts["portfolio-analytics"], 3);

  const countResponse = createResponse();
  await handler({
    method: "GET",
    url: "/api/dashboard-data?view=export-count&type=ai-analytics&period=all",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, countResponse);
  assert.equal(countResponse.statusCode, 200);
  assert.equal(JSON.parse(countResponse.body).data.recordCount, 12);
});
