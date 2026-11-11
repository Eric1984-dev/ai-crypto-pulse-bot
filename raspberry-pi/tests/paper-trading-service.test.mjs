import assert from "node:assert/strict";
import test from "node:test";
import {
  createPaperTradingDatabaseConfig,
  createPaperTradingService,
  createTradeIdempotencyKey
} from "../src/services/paper-trading-service.mjs";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const PORTFOLIO_ID = "00000000-0000-4000-8000-000000000001";
const DECISION_ID = "00000000-0000-4000-8000-000000000002";
const SYMBOL = "BTC-EUR";

function makeRepository(overrides = {}) {
  const calls = [];
  let state = {
    startingBalance: "10000",
    availableBalance: "10000",
    portfolioValue: "10000",
    peakValue: "10000",
    dailyStartValue: "10000",
    openPositions: 0
  };
  let positions = [];
  const repository = {
    calls,
    withTransaction: (operation) => operation({}),
    tryAcquireRunLock: async () => true,
    getAgentStatus: async () => ({ status: "ACTIVE" }),
    ensureDefaultPortfolios: async () => 1,
    listPortfolios: async () => [{
      id: PORTFOLIO_ID,
      starting_balance: "10000",
      available_balance: state.availableBalance,
      portfolio_value: state.portfolioValue
    }],
    listLatestDecisions: async () => [{
      id: DECISION_ID,
      symbol: SYMBOL,
      decision: "BUY",
      confidence: "90",
      created_at: NOW
    }],
    listOpenPositions: async () => positions,
    listMarketData: async () => [{
      symbol: SYMBOL,
      price: "100",
      captured_at: NOW
    }],
    getLatestEmergencyStatus: async () => "NORMAL",
    refreshOpenPositionPrices: async () => {},
    refreshPortfolioState: async () => Object.freeze({ ...state }),
    listExistingTradeKeys: async () => new Set(),
    listCooldowns: async () => new Map(),
    quoteBuy: async () => ({
      amount: "1",
      execution_price: "100.1",
      cash_required: "100.35025",
      affordable: true
    }),
    insertBuy: async () => {
      calls.push("buy");
      state = {
        ...state,
        availableBalance: "9899.64975",
        portfolioValue: "9999.64975",
        openPositions: 1
      };
      return Object.freeze({ ...state });
    },
    getOpenPositionTotals: async () => ({
      amount: "2",
      entryCostBasis: "200"
    }),
    quoteSell: async () => ({
      amount: "2",
      execution_price: "99.9",
      net_proceeds: "199.5",
      realized_pnl: "-0.5"
    }),
    insertSell: async () => {
      calls.push("sell");
      state = {
        ...state,
        availableBalance: "10199.5",
        portfolioValue: "10199.5",
        openPositions: 0
      };
      return Object.freeze({ ...state });
    },
    setEmergencyStop: async () => calls.push("emergency-stop"),
    updateStatusInTransaction: async (_client, { status }) => {
      calls.push(`status:${status}`);
      return status;
    },
    readAgentStatus: async () => ({ status: "IDLE" }),
    updateAgentStatus: async ({ status }) => status
  };
  Object.assign(repository, overrides);
  return repository;
}

function makeService(repository, logs = []) {
  return createPaperTradingService({
    repository,
    now: () => NOW,
    logger: { error: (message) => logs.push(JSON.parse(message)) }
  });
}

test("paper trading config requires a distinct writer identity", () => {
  const config = {
    database: { user: "api_reader", password: "api-password" },
    aiAnalysis: { databaseUser: "ai_writer" },
    paperTrading: {
      databaseUser: "paper_writer",
      databasePassword: "paper-password"
    }
  };
  assert.equal(
    createPaperTradingDatabaseConfig(config, {
      INGESTION_DATABASE_USER: "ingestion_writer"
    }).database.user,
    "paper_writer"
  );
  assert.throws(() => createPaperTradingDatabaseConfig({
    ...config,
    paperTrading: { ...config.paperTrading, databaseUser: "ai_writer" }
  }), { code: "PAPER_TRADING_CONFIGURATION_INVALID" });
});

test("BUY decisions pass through confidence, freshness, portfolio, and duplicate checks", async () => {
  const repository = makeRepository();
  const service = makeService(repository);

  const result = await service.run();

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.tradesExecuted, 1);
  assert.deepEqual(repository.calls, ["buy"]);
});

test("SELL decisions close an existing virtual position without opening a short", async () => {
  const position = {
    id: "00000000-0000-4000-8000-000000000003",
    symbol: SYMBOL,
    amount: "2",
    entry_price: "100",
    current_price: "100",
    unrealized_pnl: "0"
  };
  const repository = makeRepository({
    listLatestDecisions: async () => [{
      id: DECISION_ID,
      symbol: SYMBOL,
      decision: "SELL",
      confidence: "80",
      created_at: NOW
    }],
    listOpenPositions: async () => [position]
  });

  const result = await makeService(repository).run();

  assert.equal(result.tradesExecuted, 1);
  assert.deepEqual(repository.calls, ["sell"]);
});

test("stale and duplicate decisions are skipped without writing trades", async () => {
  const idempotencyKey = createTradeIdempotencyKey(PORTFOLIO_ID, DECISION_ID);
  const repository = makeRepository({
    listExistingTradeKeys: async () => new Set([idempotencyKey])
  });

  const result = await makeService(repository).run();

  assert.equal(result.duplicates, 1);
  assert.equal(result.tradesExecuted, 0);
  assert.deepEqual(repository.calls, []);
});

test("risk and freshness gates reject ineligible BUY decisions", async (t) => {
  const cases = [
    ["low confidence", {
      listLatestDecisions: async () => [{
        id: DECISION_ID,
        symbol: SYMBOL,
        decision: "BUY",
        confidence: "69",
        created_at: NOW
      }]
    }],
    ["stale decision", {
      listLatestDecisions: async () => [{
        id: DECISION_ID,
        symbol: SYMBOL,
        decision: "BUY",
        confidence: "90",
        created_at: new Date(NOW.getTime() - 16 * 60 * 1000)
      }]
    }],
    ["stale market data", {
      listMarketData: async () => [{
        symbol: SYMBOL,
        price: "100",
        captured_at: new Date(NOW.getTime() - 16 * 60 * 1000)
      }]
    }],
    ["cooldown", {
      listCooldowns: async () => new Map([
        [SYMBOL, new Date(NOW.getTime() - 60 * 1000)]
      ])
    }],
    ["emergency pause", {
      getLatestEmergencyStatus: async () => "PAUSED"
    }],
    ["daily drawdown", {
      refreshPortfolioState: async () => ({
        startingBalance: "10000",
        availableBalance: "9400",
        portfolioValue: "9400",
        peakValue: "10000",
        dailyStartValue: "10000",
        openPositions: 0
      })
    }],
    ["portfolio drawdown", {
      refreshPortfolioState: async () => ({
        startingBalance: "10000",
        availableBalance: "8400",
        portfolioValue: "8400",
        peakValue: "10000",
        dailyStartValue: "10000",
        openPositions: 0
      })
    }]
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const repository = makeRepository(overrides);
      const result = await makeService(repository).run();
      assert.equal(result.tradesExecuted, 0);
      assert.deepEqual(repository.calls, []);
    });
  }
});

test("maximum open positions prevents a sixth virtual position", async () => {
  const symbols = ["AAA-EUR", "BBB-EUR", "CCC-EUR", "DDD-EUR", "EEE-EUR"];
  const repository = makeRepository({
    listLatestDecisions: async () => [{
      id: DECISION_ID,
      symbol: "ZZZ-EUR",
      decision: "BUY",
      confidence: "90",
      created_at: NOW
    }],
    listOpenPositions: async () => symbols.map((symbol) => ({
      id: "00000000-0000-4000-8000-000000000003",
      symbol,
      amount: "1",
      entry_price: "10",
      current_price: "10",
      unrealized_pnl: "0"
    })),
    listMarketData: async (_client, marketSymbols) =>
      marketSymbols.map((symbol) => ({ symbol, price: "10", captured_at: NOW }))
  });

  const result = await makeService(repository).run();

  assert.equal(result.tradesExecuted, 0);
  assert.deepEqual(repository.calls, []);
});

test("emergency drawdown persists the stop and prevents new BUY decisions", async () => {
  const repository = makeRepository({
    refreshPortfolioState: async () => ({
      startingBalance: "10000",
      availableBalance: "7900",
      portfolioValue: "7900",
      peakValue: "10000",
      dailyStartValue: "10000",
      openPositions: 0
    })
  });

  const result = await makeService(repository).run();

  assert.equal(result.tradesExecuted, 0);
  assert.ok(repository.calls.includes("emergency-stop"));
  assert.ok(repository.calls.includes("status:STOPPED"));
});

test("paper trading fails closed and reports a safe error when storage fails", async () => {
  const logs = [];
  const denied = Object.assign(new Error("private database detail"), {
    code: "42501",
    paperTradingContext: {
      table: "AI_Crypto_Bot_Trades",
      operation: "INSERT",
      requiredPrivilege: "INSERT"
    }
  });
  const repository = makeRepository({
    insertBuy: async () => {
      throw denied;
    }
  });
  const service = makeService(repository, logs);

  await assert.rejects(service.run(), {
    code: "42501",
    component: "paper-trading-service"
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].code, "42501");
  assert.equal(logs[0].table, "AI_Crypto_Bot_Trades");
  assert.equal(logs[0].operation, "INSERT");
  assert.equal(logs[0].sqlState, "42501");
  assert.equal(logs[0].requiredPrivilege, "INSERT");
  assert.equal("message" in logs[0], false);
});
