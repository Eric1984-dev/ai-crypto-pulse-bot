import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { DashboardRepository } from "../src/repositories/dashboard-repository.mjs";
import { SYSTEM_PROFILE_ID } from "../src/repositories/paper-trading-repository.mjs";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."AI_Crypto_Bot_Profiles" (
      id uuid PRIMARY KEY,
      email text
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolios" (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      starting_balance numeric NOT NULL,
      available_balance numeric NOT NULL,
      portfolio_value numeric NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Positions" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL,
      symbol text NOT NULL,
      amount numeric NOT NULL,
      entry_price numeric NOT NULL,
      current_price numeric NOT NULL,
      unrealized_pnl numeric NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Trades" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL,
      ai_decision_id uuid,
      symbol text NOT NULL,
      side text NOT NULL,
      price numeric NOT NULL,
      quantity numeric NOT NULL,
      fees numeric NOT NULL,
      realized_pnl numeric NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL,
      portfolio_value numeric NOT NULL,
      available_balance numeric NOT NULL,
      open_positions integer NOT NULL,
      captured_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Emergency_State" (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      reason text,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Market_Data" (
      symbol text PRIMARY KEY,
      price numeric NOT NULL,
      captured_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
      id uuid PRIMARY KEY,
      symbol text NOT NULL,
      decision text NOT NULL,
      confidence numeric NOT NULL,
      reason text NOT NULL,
      indicators jsonb NOT NULL,
      strategy_name text,
      strategy_version text,
      created_at timestamptz NOT NULL
    );
    INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
    VALUES ('${SYSTEM_PROFILE_ID}', NULL);
    INSERT INTO public."AI_Crypto_Bot_Portfolios"
      (id, user_id, starting_balance, available_balance, portfolio_value, created_at)
    VALUES ('00000000-0000-4000-8000-000000000200', '${SYSTEM_PROFILE_ID}', 10000, 8000, 10100, NOW());
    INSERT INTO public."AI_Crypto_Bot_Positions"
      (id, portfolio_id, symbol, amount, entry_price, current_price, unrealized_pnl, status, created_at)
    VALUES ('00000000-0000-4000-8000-000000000300',
      '00000000-0000-4000-8000-000000000200', 'BTC-EUR', 0.02, 50000, 50500, 10, 'OPEN', NOW());
    INSERT INTO public."AI_Crypto_Bot_Trades"
      (id, portfolio_id, symbol, side, price, quantity, fees, realized_pnl, created_at)
    VALUES ('00000000-0000-4000-8000-000000000400',
      '00000000-0000-4000-8000-000000000200', 'BTC-EUR', 'SELL', 51000, 0.01, 1, 9, NOW());
    INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
      (id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at)
    VALUES ('00000000-0000-4000-8000-000000000500',
      '00000000-0000-4000-8000-000000000200', 10100, 8000, 1, NOW());
    INSERT INTO public."AI_Crypto_Bot_Emergency_State" (id, status, reason, created_at)
    VALUES ('00000000-0000-4000-8000-000000000600', 'NORMAL', NULL, NOW());
    INSERT INTO public."AI_Crypto_Bot_Market_Data" (symbol, price, captured_at)
    VALUES ('BTC-EUR', 50600, NOW());
    INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
      (id, symbol, decision, confidence, reason, indicators, created_at)
    VALUES ('00000000-0000-4000-8000-000000000700',
      'BTC-EUR', 'HOLD', 82, 'Consolidating.', '{"marketStrength": 12.5}', NOW());
  `);
  return database;
}

test("dashboard repository reads only the standalone system portfolio and bounded history", async () => {
  const database = await createDatabase();
  try {
    const pool = {
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    };
    const repository = new DashboardRepository(pool, { logger: { error() {} } });
    const result = await repository.getSystemDashboardData();
    const history = await repository.getTradeHistory({
      page: 1,
      side: "SELL",
      period: "all",
      search: "BTC",
      sort: "newest",
      now: new Date()
    });
    const analytics = await repository.getAnalytics({ period: "30d", now: new Date() });
    const exportCount = await repository.getExportRecordCount({
      exportType: "trades",
      period: "all",
      now: new Date()
    });
    const exportRows = await repository.getExportRecords({
      exportType: "trades",
      period: "all",
      now: new Date()
    });

    assert.equal(result.portfolio.count, 1);
    assert.equal(result.portfolio.portfolioValue, 10100);
    assert.equal(result.portfolio.totalPnl, 100);
    assert.equal(result.portfolio.realizedPnl, 9);
    assert.equal(result.portfolio.unrealizedPnl, 10);
    assert.equal(result.portfolio.winRate, 100);
    assert.equal(result.openPositions.items[0].current_market_price, 50600);
    assert.equal(result.openPositionAiStatus.items[0].amount, 0.02);
    assert.equal(result.openPositionAiStatus.items[0].entry_price, 50000);
    assert.equal(result.openPositionAiStatus.items[0].current_market_price, 50600);
    assert.equal(result.openPositionAiStatus.items[0].unrealized_pnl, 10);
    assert.ok(result.openPositionAiStatus.items[0].current_market_captured_at);
    assert.equal(result.openPositionAiStatus.items[0].latestAiDecision.decision, "HOLD");
    assert.equal(result.recentTrades.items[0].side, "SELL");
    assert.equal(result.portfolioSnapshots.length, 1);
    assert.equal(result.emergencyState.status, "NORMAL");
    assert.equal(history.totalCount, 1);
    assert.equal(history.stats.winningTrades, 1);
    assert.equal(history.items[0].symbol, "BTC-EUR");
    assert.equal(analytics.tradePerformance.closedTrades, 1);
    assert.ok(Array.isArray(analytics.tradePerformance.bestSymbols));
    assert.equal(analytics.aiPerformance.decisionCount, 1);
    assert.ok(["BUY", "SELL", "HOLD", "WAIT"].every((action) =>
      analytics.aiPerformance.actions[action]));
    assert.equal(analytics.portfolio.equityCurve.length, 1);
    assert.ok(Array.isArray(analytics.portfolio.drawdownHistory));
    assert.equal(exportCount, 1);
    assert.equal(exportRows[0].symbol, "BTC-EUR");
  } finally {
    await database.close();
  }
});

test("trade history filtering and pagination preserve all-time sell statistics", async () => {
  const database = await createDatabase();
  try {
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Trades"
        (id, portfolio_id, symbol, side, price, quantity, fees, realized_pnl, created_at)
      VALUES
        ('00000000-0000-4000-8000-000000000401',
         '00000000-0000-4000-8000-000000000200', 'ETH-EUR', 'BUY', 200, 1, 0.5, 0,
         '2026-03-20T10:00:00.000Z'),
        ('00000000-0000-4000-8000-000000000402',
         '00000000-0000-4000-8000-000000000200', 'SOL-EUR', 'BUY', 300, 1, 0.5, 0,
         '2026-03-20T11:00:00.000Z')
    `);
    const pool = {
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    };
    const repository = new DashboardRepository(pool, { logger: { error() {} } });
    const firstPage = await repository.getTradeHistory({
      page: 1,
      pageSize: 1,
      side: "BUY",
      sort: "price-high",
      now: new Date("2026-03-21T00:00:00.000Z")
    });
    const secondPage = await repository.getTradeHistory({
      page: 2,
      pageSize: 1,
      side: "BUY",
      sort: "price-high",
      now: new Date("2026-03-21T00:00:00.000Z")
    });
    const searched = await repository.getTradeHistory({
      page: 1,
      side: "BUY",
      search: "ETH",
      sort: "oldest",
      now: new Date("2026-03-21T00:00:00.000Z")
    });

    assert.equal(firstPage.totalCount, 2);
    assert.equal(firstPage.totalPages, 2);
    assert.equal(firstPage.items[0].symbol, "SOL-EUR");
    assert.equal(secondPage.items[0].symbol, "ETH-EUR");
    assert.equal(searched.totalCount, 1);
    assert.equal(searched.items[0].symbol, "ETH-EUR");
    for (const result of [firstPage, secondPage, searched]) {
      assert.equal(result.stats.closedTrades, 1);
      assert.equal(result.stats.winningTrades, 1);
      assert.equal(result.stats.averageProfit, 9);
    }
  } finally {
    await database.close();
  }
});
