const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const dashboard = require("../js/dashboard.js");
const dashboardDataModule = import("../api/dashboard-data.mjs");

const authEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  NODE_ENV: "production"
};
const accessToken = "header.payload.signature";
const sessionCookie = `cp_access_token=${accessToken}`;
const generatedAt = new Date("2026-03-20T12:00:00.000Z");
const rootDirectory = path.resolve(__dirname, "..");

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
    }
  };
}

function buildDashboardRows() {
  return {
    AI_Crypto_Bot_Status: [{
      status: "ACTIVE",
      is_active: true,
      is_analyzing: false,
      last_run: "2026-03-20T11:55:00.000Z",
      updated_at: "2026-03-20T11:55:00.000Z"
    }],
    AI_Crypto_Bot_Emergency_State: [{
      status: "NORMAL",
      created_at: "2026-03-20T11:00:00.000Z"
    }],
    AI_Crypto_Bot_Portfolios: [{
      id: "portfolio-1",
      starting_balance: "1000",
      available_balance: "800",
      portfolio_value: "1100"
    }],
    AI_Crypto_Bot_Positions: [{
      id: "position-1",
      portfolio_id: "portfolio-1",
      symbol: "BTC-EUR",
      amount: "0.01",
      entry_price: "90000",
      current_price: "100000",
      unrealized_pnl: "100",
      status: "OPEN",
      created_at: "2026-03-20T10:00:00.000Z"
    }],
    AI_Crypto_Bot_Trades: [
      {
        id: "trade-1",
        portfolio_id: "portfolio-1",
        symbol: "BTC-EUR",
        side: "SELL",
        price: "100000",
        quantity: "0.001",
        fees: "0.25",
        slippage: "0.10",
        realized_pnl: "25",
        created_at: "2026-03-20T10:30:00.000Z"
      },
      {
        id: "trade-2",
        portfolio_id: "portfolio-1",
        symbol: "ETH-EUR",
        side: "SELL",
        price: "2000",
        quantity: "0.1",
        fees: "0.25",
        slippage: "0.10",
        realized_pnl: "-5",
        created_at: "2026-03-20T09:30:00.000Z"
      }
    ],
    AI_Crypto_Bot_Watched_Markets: [{
      id: "market-1",
      symbol: "BTC-EUR",
      enabled: true,
      priority: 1
    }],
    AI_Crypto_Bot_AI_Decisions: [{
      id: "decision-1",
      symbol: "BTC-EUR",
      decision: "HOLD",
      confidence: "80",
      indicators: { marketStrength: 12.5 },
      reason: "Risk limits prevent opening a new paper position.",
      strategy_name: null,
      strategy_version: null,
      created_at: "2026-03-20T11:45:00.000Z"
    }],
    AI_Crypto_Bot_Portfolio_Snapshots: [
      { portfolio_id: "portfolio-1", portfolio_value: "1050", captured_at: "2026-03-20T10:00:00.000Z" },
      { portfolio_id: "portfolio-1", portfolio_value: "1100", captured_at: "2026-03-20T11:00:00.000Z" }
    ],
    AI_Crypto_Bot_Market_Data: [{
      symbol: "BTC-EUR",
      price: "105000",
      captured_at: "2026-03-20T11:59:00.000Z"
    }]
  };
}

function createSupabaseFetch({ rows = buildDashboardRows(), failTable = null, calls = [] } = {}) {
  return async (url, options) => {
    const parsedUrl = new URL(url);
    const table = parsedUrl.pathname.split("/").pop();
    const query = parsedUrl.searchParams;
    calls.push({ table, query, options });

    if (table === failTable) {
      return { status: 500, ok: false };
    }

    const tableRows = [...(rows[table] || [])];
    if (table === "AI_Crypto_Bot_Portfolio_Snapshots" && query.get("order") === "captured_at.desc") {
      tableRows.reverse();
    }
    const select = query.get("select");
    const side = query.get("side");
    const isDailySellQuery = table === "AI_Crypto_Bot_Trades"
      && select === "realized_pnl"
      && query.has("created_at");
    const isRealizedSellQuery = table === "AI_Crypto_Bot_Trades"
      && select === "realized_pnl"
      && !query.has("created_at");
    const isWinningSellCount = table === "AI_Crypto_Bot_Trades"
      && select === "id"
      && query.get("realized_pnl") === "gt.0";
    const isSellCount = table === "AI_Crypto_Bot_Trades"
      && select === "id"
      && side === "eq.SELL"
      && !query.has("realized_pnl");
    let responseRows = tableRows;
    let exactCount = tableRows.length;

    if (isDailySellQuery) {
      responseRows = [
        { realized_pnl: "25" },
        { realized_pnl: "-5" }
      ];
      exactCount = responseRows.length;
    } else if (isRealizedSellQuery) {
      responseRows = tableRows.map(({ realized_pnl }) => ({ realized_pnl }));
      exactCount = responseRows.length;
    } else if (isWinningSellCount) {
      responseRows = [];
      exactCount = 1;
    } else if (isSellCount) {
      responseRows = [];
      exactCount = 2;
    } else if (table === "AI_Crypto_Bot_AI_Decisions") {
      const symbolFilter = query.get("symbol");
      if (symbolFilter && symbolFilter.startsWith("eq.")) {
        responseRows = responseRows.filter((row) => row.symbol === symbolFilter.slice(3));
      }
      if (query.get("order") === "created_at.desc,id.desc") {
        responseRows.sort((left, right) => (
          Date.parse(right.created_at) - Date.parse(left.created_at)
          || String(right.id).localeCompare(String(left.id))
        ));
      }
      if (query.has("limit")) {
        responseRows = responseRows.slice(0, Number(query.get("limit")));
      }
      exactCount = responseRows.length;
    }

    const countHeader = options.headers.prefer
      ? `0-${Math.max(responseRows.length - 1, 0)}/${exactCount}`
      : null;
    return {
      status: 200,
      ok: true,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-range" ? countHeader : null;
        }
      },
      async json() {
        return responseRows;
      }
    };
  };
}

test("authenticated dashboard API returns real table data and computed summaries", async () => {
  const module = await dashboardDataModule;
  const calls = [];
  const verificationCalls = [];
  const handler = module.createHandler({
    env: authEnv,
    verify: async (token, config) => {
      verificationCalls.push({ token, config });
      return true;
    },
    fetchImpl: createSupabaseFetch({ calls }),
    now: () => generatedAt
  });
  const res = createResponse();

  await handler({ method: "GET", headers: { cookie: sessionCookie } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(verificationCalls[0].token, accessToken);
  assert.equal(verificationCalls[0].config.supabaseAnonKey, authEnv.SUPABASE_ANON_KEY);
  assert.ok(calls.length >= 10);
  for (const call of calls) {
    assert.equal(call.options.headers.authorization, `Bearer ${accessToken}`);
    assert.equal(call.options.headers.apikey, authEnv.SUPABASE_ANON_KEY);
    assert.equal(call.options.cache, "no-store");
  }

  const { data } = JSON.parse(res.body);
  assert.equal(data.agentStatus.status, "ACTIVE");
  assert.equal(data.emergencyState.status, "NORMAL");
  assert.deepEqual(data.portfolio, {
    count: 1,
    portfolioValue: 1100,
    totalPnl: 100,
    realizedPnl: 20,
    realizedPnlTradeCount: 2,
    unrealizedPnl: 100,
    availableBalance: 800,
    dailyPnl: 20,
    dailyPnlTradeCount: 2,
    winRate: 50,
    winRateTradeCount: 2
  });
  assert.equal(data.openPositions.count, 1);
  assert.equal(data.recentTrades.count, 2);
  assert.equal(data.watchedMarkets.count, 1);
  assert.equal(data.aiDecisions.count, 1);
  assert.equal(data.openPositionAiStatus.count, 1);
  assert.deepEqual(data.openPositionAiStatus.items[0].latestAiDecision, {
    decision: "HOLD",
    confidence: 80,
    marketStrength: 12.5,
    created_at: "2026-03-20T11:45:00.000Z"
  });
  assert.equal(data.lastMarketDataAt, "2026-03-20T11:59:00.000Z");
  assert.ok(calls.some(({ table, query }) => (
    table === "AI_Crypto_Bot_Market_Data"
    && query.get("select") === "captured_at"
    && query.get("order") === "captured_at.desc"
  )));
  assert.deepEqual(data.portfolioSnapshots.map((snapshot) => snapshot.portfolio_value), ["1050", "1100"]);
  assert.equal(data.generatedAt, generatedAt.toISOString());
});

test("dashboard API rejects anonymous requests without querying Supabase", async () => {
  const module = await dashboardDataModule;
  let verifyCalls = 0;
  let dataCalls = 0;
  const handler = module.createHandler({
    env: authEnv,
    verify: async () => { verifyCalls += 1; return true; },
    fetchImpl: async () => { dataCalls += 1; }
  });
  const res = createResponse();

  await handler({ method: "GET", headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error.code, "AUTH_REQUIRED");
  assert.equal(verifyCalls, 0);
  assert.equal(dataCalls, 0);
  assert.match(res.headers["set-cookie"], /Max-Age=0/);
});

test("dashboard API enriches open positions and matching recent BUY trades with current snapshots", async () => {
  const module = await dashboardDataModule;
  const rows = buildDashboardRows();
  rows.AI_Crypto_Bot_Trades.push({
    id: "trade-open-buy",
    portfolio_id: "portfolio-1",
    symbol: "BTC-EUR",
    side: "BUY",
    price: "90000",
    quantity: "0.01",
    fees: "2.25",
    slippage: "0.1",
    realized_pnl: "0",
    created_at: "2026-03-20T10:00:00.000Z"
  });
  rows.AI_Crypto_Bot_Market_Data[0].price = "105000";
  const handler = module.createHandler({
    env: authEnv,
    verify: async () => true,
    fetchImpl: createSupabaseFetch({ rows }),
    now: () => generatedAt
  });
  const res = createResponse();

  await handler({ method: "GET", headers: { cookie: sessionCookie } }, res);

  const { data } = JSON.parse(res.body);
  assert.equal(data.openPositions.items[0].current_market_price, "105000");
  assert.equal(data.openPositions.items[0].current_market_captured_at, "2026-03-20T11:59:00.000Z");
  const recentBuy = data.recentTrades.items.find((trade) => trade.id === "trade-open-buy");
  assert.equal(recentBuy.openPosition.current_market_price, "105000");
});

test("dashboard API selects the latest AI decision for each open-position market", async () => {
  const module = await dashboardDataModule;
  const rows = buildDashboardRows();
  rows.AI_Crypto_Bot_Positions.push(
    {
      id: "position-2",
      portfolio_id: "portfolio-1",
      symbol: "ETH-EUR",
      amount: "1",
      entry_price: "1900",
      current_price: "2000",
      unrealized_pnl: "100",
      status: "OPEN",
      created_at: "2026-03-20T09:00:00.000Z"
    },
    {
      id: "position-3",
      portfolio_id: "portfolio-1",
      symbol: "SOL-EUR",
      amount: "1",
      entry_price: "100",
      current_price: "90",
      unrealized_pnl: "-10",
      status: "OPEN",
      created_at: "2026-03-20T08:00:00.000Z"
    }
  );
  rows.AI_Crypto_Bot_AI_Decisions.push(
    {
      id: "decision-old",
      symbol: "BTC-EUR",
      decision: "BUY",
      confidence: "60",
      indicators: { marketStrength: 45 },
      created_at: "2026-03-20T11:30:00.000Z"
    },
    {
      id: "decision-new",
      symbol: "BTC-EUR",
      decision: "SELL",
      confidence: "72",
      indicators: { marketStrength: -42 },
      created_at: "2026-03-20T11:50:00.000Z"
    },
    {
      id: "decision-eth",
      symbol: "ETH-EUR",
      decision: "HOLD",
      confidence: "55",
      indicators: { marketStrength: -25 },
      created_at: "2026-03-20T11:40:00.000Z"
    }
  );
  const calls = [];
  const handler = module.createHandler({
    env: authEnv,
    verify: async () => true,
    fetchImpl: createSupabaseFetch({ rows, calls }),
    now: () => generatedAt
  });
  const res = createResponse();

  await handler({ method: "GET", headers: { cookie: sessionCookie } }, res);

  const { data } = JSON.parse(res.body);
  const statusesBySymbol = new Map(
    data.openPositionAiStatus.items.map((item) => [item.symbol, item.latestAiDecision])
  );
  assert.deepEqual(statusesBySymbol.get("BTC-EUR"), {
    decision: "SELL",
    confidence: 72,
    marketStrength: -42,
    created_at: "2026-03-20T11:50:00.000Z"
  });
  assert.deepEqual(statusesBySymbol.get("ETH-EUR"), {
    decision: "HOLD",
    confidence: 55,
    marketStrength: -25,
    created_at: "2026-03-20T11:40:00.000Z"
  });
  assert.equal(statusesBySymbol.get("SOL-EUR"), null);
  assert.deepEqual(
    calls
      .filter(({ table, query }) => (
        table === "AI_Crypto_Bot_AI_Decisions" && query.has("symbol")
      ))
      .map(({ query }) => [query.get("symbol"), query.get("limit"), query.get("order")])
      .sort(),
    [
      ["eq.BTC-EUR", "1", "created_at.desc,id.desc"],
      ["eq.ETH-EUR", "1", "created_at.desc,id.desc"],
      ["eq.SOL-EUR", "1", "created_at.desc,id.desc"]
    ]
  );
});

test("dashboard API fails closed when session verification or database reads fail", async () => {
  const module = await dashboardDataModule;
  const unavailableAuth = module.createHandler({
    env: authEnv,
    verify: async () => { throw new Error("provider unavailable"); },
    fetchImpl: async () => { throw new Error("data query must not happen"); }
  });
  const authResponse = createResponse();
  await unavailableAuth({ method: "GET", headers: { cookie: sessionCookie } }, authResponse);
  assert.equal(authResponse.statusCode, 503);
  assert.equal(JSON.parse(authResponse.body).error.code, "AUTH_UNAVAILABLE");

  const unavailableData = module.createHandler({
    env: authEnv,
    verify: async () => true,
    fetchImpl: createSupabaseFetch({ failTable: "AI_Crypto_Bot_Status" })
  });
  const dataResponse = createResponse();
  await unavailableData({ method: "GET", headers: { cookie: sessionCookie } }, dataResponse);
  assert.equal(dataResponse.statusCode, 503);
  assert.equal(JSON.parse(dataResponse.body).error.code, "DASHBOARD_DATA_UNAVAILABLE");
  assert.doesNotMatch(dataResponse.body, /provider unavailable|test-anon-key/);
});

test("dashboard API rejects unsupported methods and missing configuration", async () => {
  const module = await dashboardDataModule;
  const handler = module.createHandler({ env: {} });
  const methodResponse = createResponse();
  await handler({ method: "POST", headers: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.allow, "GET");

  const configResponse = createResponse();
  await handler({ method: "GET", headers: {} }, configResponse);
  assert.equal(configResponse.statusCode, 503);
  assert.equal(JSON.parse(configResponse.body).error.code, "SUPABASE_NOT_CONFIGURED");
});

function createElement() {
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    dataset: {},
    children: [],
    listeners: {},
    classList: { contains: () => false },
    replaceChildren() {
      this.children = [];
      this.textContent = "";
    },
    append(...children) {
      this.children.push(...children);
      this.textContent += children.map((child) => (
        typeof child === "string" ? child : child && child.textContent || ""
      )).join("");
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    setAttribute(name, value) {
      this.attributes = this.attributes || {};
      this.attributes[name] = value;
    },
    getContext() {
      return {};
    }
  };
}

function createDashboardDocument() {
  const selectors = [
    "[data-dashboard-value=\"portfolioValue\"]",
    "[data-dashboard-value=\"totalPnl\"]",
    "[data-dashboard-value=\"realizedPnl\"]",
    "[data-dashboard-value=\"unrealizedPnl\"]",
    "[data-dashboard-value=\"dailyPnl\"]",
    "[data-dashboard-value=\"winRate\"]",
    "[data-dashboard-value=\"openPositions\"]",
    "[data-dashboard-value=\"openPositionAiStatus\"]",
    "[data-dashboard-value=\"availableBalance\"]",
    "[data-dashboard-value=\"aiDecisions\"]",
    "[data-dashboard-value=\"paperTrades\"]",
    "[data-dashboard-value=\"trackedMarkets\"]",
    "[data-dashboard-value=\"portfolioCount\"]",
    "[data-dashboard-activity=\"bot-run\"]",
    "[data-dashboard-activity=\"market-data\"]",
    "[data-dashboard-activity=\"paper-trade\"]",
    "[data-dashboard-status=\"agent\"]",
    "[data-dashboard-status=\"emergency\"]",
    "[data-dashboard-list=\"positions\"]",
    "[data-dashboard-list=\"trades\"]",
    "[data-dashboard-list=\"position-ai-status\"]",
    "[data-dashboard-empty=\"positions\"]",
    "[data-dashboard-empty=\"trades\"]",
    "[data-dashboard-empty=\"position-ai-status\"]",
    "[data-portfolio-chart]",
    "[data-dashboard-chart-empty]",
    "[data-dashboard-loading]",
    "[data-dashboard-error]",
    "[data-dashboard-retry]",
    "[data-agent-brain]",
    "[data-agent-brain-stage]",
    "[data-agent-brain-fallback]"
  ];
  const elements = new Map(selectors.map((selector) => [selector, [createElement()]]));
  elements.set("[data-dashboard-value=\"openPositions\"]", [createElement(), createElement()]);
  elements.set("[data-dashboard-value=\"paperTrades\"]", [createElement(), createElement()]);
  elements.set("[data-dashboard-value=\"trackedMarkets\"]", [createElement(), createElement()]);
  elements.set("[data-dashboard-value=\"aiDecisions\"]", [createElement(), createElement()]);
  const dashboardDocument = {
    body: { dataset: { authPage: "protected" } },
    visibilityState: "visible",
    documentElement: { classList: { contains: () => false } },
    listeners: {},
    querySelector(selector) {
      return (elements.get(selector) || [])[0] || null;
    },
    querySelectorAll(selector) {
      return elements.get(selector) || [];
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    removeEventListener(name) {
      delete this.listeners[name];
    },
    createElement() {
      return createElement();
    }
  };
  return { dashboardDocument, elements };
}

test("dashboard renders database summaries, recent lists, and an actual-snapshot chart", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  let chartConfig;
  class FakeChart {
    constructor(context, config) {
      assert.ok(context);
      chartConfig = config;
    }
  }
  const data = {
    agentStatus: { status: "ANALYZING", last_run: "2026-03-20T11:55:00.000Z" },
    lastMarketDataAt: "2026-03-20T11:59:00.000Z",
    emergencyState: { status: "PAUSED" },
    portfolio: {
      count: 1,
      portfolioValue: 1100,
      totalPnl: 100,
      realizedPnl: 20,
      unrealizedPnl: 100,
      dailyPnl: 20,
      availableBalance: 800,
      winRate: 50
    },
    openPositions: {
      count: 2,
      items: [
        {
          symbol: "<img src=x>",
          amount: 0.01,
          entry_price: 0.00453954,
          current_price: 0.05671234,
          unrealized_pnl: 100,
          created_at: "2026-03-20T10:00:00.000Z"
        },
        {
          symbol: "BEAM-EUR",
          amount: 220837,
          entry_price: 0.00454,
          current_price: 0.00397,
          unrealized_pnl: -125.78,
          created_at: "2026-03-20T09:00:00.000Z"
        }
      ]
    },
    openPositionAiStatus: {
      count: 2,
      items: [
        {
          symbol: "BEAM-EUR",
          amount: 1000,
          entry_price: 1,
          current_price: 0.87422,
          current_market_price: 0.87422,
          unrealized_pnl: -125.78,
          latestAiDecision: {
            decision: "HOLD",
            confidence: 55.55,
            marketStrength: -7.59,
            created_at: "2026-03-20T11:01:00.000Z"
          }
        },
        {
          symbol: "WIN-EUR",
          amount: 1000,
          entry_price: 1,
          current_price: 1.03452,
          current_market_price: 1.03452,
          unrealized_pnl: 34.52,
          latestAiDecision: null
        }
      ]
    },
    recentTrades: {
      count: 3,
      items: [
        {
          side: "SELL",
          symbol: "BTC-EUR",
          quantity: 1,
          price: 1124,
          fees: 2.81,
          realized_pnl: 118.69,
          created_at: generatedAt.toISOString()
        },
        {
          side: "BUY",
          symbol: "WIN-EUR",
          quantity: "16348102.95927201",
          price: "0.000061",
          created_at: generatedAt,
          openPosition: {
            amount: "16348102.95927201",
            entry_price: "0.00006123",
            current_market_price: "0.000067"
          }
        },
        {
          side: "SELL",
          symbol: "BEAM-EUR",
          quantity: 220837,
          price: 0.00397,
          fees: 0.22,
          realized_pnl: -125.78,
          created_at: generatedAt.toISOString()
        }
      ]
    },
    watchedMarkets: { count: 1, items: [{ symbol: "BTC-EUR", priority: 1 }] },
    aiDecisions: {
      count: 1,
      items: [{
        decision: "HOLD",
        symbol: "BTC-EUR",
        confidence: 80,
        reason: "No action.",
        created_at: generatedAt.toISOString()
      }]
    },
    portfolioSnapshots: [
      { portfolio_id: "portfolio-1", portfolio_value: "1100", captured_at: "2026-03-20T11:00:00.000Z" },
      { portfolio_id: "portfolio-1", portfolio_value: "1050", captured_at: "2026-03-20T10:00:00.000Z" }
    ]
  };

  data.portfolio.totalPnl = -25;
  dashboard.renderDashboard(data, dashboardDocument, FakeChart);

  assert.match(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, /1,100/);
  assert.equal(elements.get("[data-dashboard-value=\"totalPnl\"]")[0].dataset.valueTone, "negative");
  assert.equal(elements.get("[data-dashboard-value=\"openPositions\"]")[0].textContent, "2");
  assert.equal(elements.get("[data-dashboard-value=\"openPositions\"]")[1].textContent, "2");
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "ANALYZING");
  assert.equal(elements.get("[data-dashboard-status=\"emergency\"]")[0].dataset.state, "paused");
  assert.equal(elements.get("[data-dashboard-activity=\"bot-run\"]")[0].textContent, "20/03/2026, 12:55");
  assert.equal(elements.get("[data-dashboard-activity=\"market-data\"]")[0].textContent, "20/03/2026, 12:59");
  assert.equal(elements.get("[data-dashboard-activity=\"paper-trade\"]")[0].textContent, "20/03/2026, 13:00");
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[0].textContent, "<img src=x> · 0.01 units");
  assert.equal(
    elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[0].children[1].className,
    "market-symbol"
  );
  assert.match(
    elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[1].textContent,
    /Entry €\s?0\.00454 · Current €\s?0\.05671 · P&L €\s?100\.00 · Opened .*11:00/
  );
  assert.ok(elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "positive"
      && child.textContent === "P&L €100.00"
  )));
  assert.ok(elements.get("[data-dashboard-list=\"positions\"]")[0].children[1].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "negative"
      && child.textContent === "P&L -€125.78"
  )));
  assert.match(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[0].children[1].textContent,
    /SELL · Quantity: 1.*Exit: €\s?1,124\.00.*\+€118\.69 \(\+11\.84%\).*13:00.*Status: CLOSED/s
  );
  assert.equal(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[0].children[1].children[1].className,
    "trade-action-sell"
  );
  assert.equal(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[1].children[0].textContent,
    "WIN-EUR"
  );
  assert.match(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[1].children[1].textContent,
    /BUY · Quantity: 16\.35M.*Entry: €\s?0\.00006123.*Current: €\s?0\.000067.*P&L: \+€.*\(\+9\.42%\).*Status: OPEN/s
  );
  assert.equal(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[1].children[1].children[1].className,
    "trade-action-buy"
  );
  assert.ok(elements.get("[data-dashboard-list=\"trades\"]")[0].children[2].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "negative"
      && child.textContent.startsWith("P&L: -€125.78")
  )));
  assert.equal(elements.get("[data-dashboard-value=\"openPositionAiStatus\"]")[0].textContent, "2");
  const statusCards = elements.get("[data-dashboard-list=\"position-ai-status\"]")[0].children;
  assert.equal(statusCards.length, 2);
  assert.match(statusCards[0].textContent, /BEAM-EUR.*DecisionHOLD.*Market ViewNeutral.*AI CommentaryNo strong bullish or bearish trend detected\..*Current Unrealized P&L-€125\.78 \(-12\.58%\).*Updated20\/03\/2026, 12:01/s);
  assert.equal(statusCards[0].children[1].children[3].children[1].dataset.valueTone, "negative");
  assert.doesNotMatch(statusCards[0].textContent, /Confidence|55\.55|-7\.59/);
  assert.match(statusCards[1].textContent, /WIN-EUR.*DecisionNo decision.*Market ViewUnavailable.*AI CommentaryNo recent AI decision is available for this market\..*Current Unrealized P&L\+€34\.52 \(\+3\.45%\).*Updated—/s);
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].hidden, false);
  assert.equal(elements.get("[data-dashboard-empty=\"positions\"]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "1");
  assert.equal(elements.has("[data-dashboard-list=\"markets\"]"), false);
  assert.equal(elements.get("[data-portfolio-chart]")[0].hidden, false);
  assert.deepEqual(chartConfig.data.datasets[0].data, [1050, 1100]);
  assert.ok(chartConfig.data.labels.some((label) => label.endsWith("12:00")));
});

test("dashboard maps market-strength boundaries to the requested market views", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const strengths = [-40, -39.99, -20, -19.99, 19.99, 20, 39.99, 40];
  const expectedViews = [
    "Strong Bearish",
    "Bearish",
    "Bearish",
    "Neutral",
    "Neutral",
    "Bullish",
    "Bullish",
    "Strong Bullish"
  ];

  dashboard.renderDashboard({
    openPositionAiStatus: {
      count: strengths.length,
      items: strengths.map((marketStrength, index) => ({
        symbol: `TEST${index}-EUR`,
        amount: 1,
        entry_price: 1,
        current_price: 1,
        unrealized_pnl: 0,
        latestAiDecision: {
          decision: "HOLD",
          confidence: 50,
          marketStrength,
          created_at: generatedAt.toISOString()
        }
      }))
    }
  }, dashboardDocument, null);

  const cards = elements.get("[data-dashboard-list=\"position-ai-status\"]")[0].children;
  assert.deepEqual(cards.map((card) => (
    card.children[1].children[1].children[1].textContent
  )), expectedViews);
});

test("dashboard AI commentary is short, decision-aware, and adapts HOLD to market view", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const cases = [
    ["BUY", 40, "Bullish trend detected. AI currently favors upward continuation."],
    ["SELL", -40, "Bearish trend detected. Downside risk currently outweighs upside potential."],
    ["WAIT", null, "Insufficient or unreliable data. AI is waiting for better market conditions."],
    ["HOLD", 0, "No strong bullish or bearish trend detected."],
    ["HOLD", 20, "Bullish conditions are present, but the AI currently recommends holding."],
    ["HOLD", -20, "Bearish pressure is present, but the AI currently recommends holding."],
    ["HOLD", null, "Market conditions are unavailable; the AI currently recommends holding."]
  ];

  dashboard.renderDashboard({
    openPositionAiStatus: {
      count: cases.length,
      items: cases.map(([decision, marketStrength], index) => ({
        symbol: `TEST${index}-EUR`,
        amount: 1,
        entry_price: 1,
        current_market_price: 1,
        latestAiDecision: {
          decision,
          confidence: 83.25,
          marketStrength
        }
      }))
    }
  }, dashboardDocument, null);

  const cards = elements.get("[data-dashboard-list=\"position-ai-status\"]")[0].children;
  assert.deepEqual(cards.map((card) => card.children[1].children[2].children[1].textContent), (
    cases.map(([, , commentary]) => commentary)
  ));
  for (const card of cards) {
    assert.doesNotMatch(card.textContent, /Confidence|83\.25|Market Strength|(?:^|\s)(?:40|-40|20|-20)(?:\s|$)/);
  }
});

test("dashboard omits all scanner content and uses only its watched-market summary", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const script = fs.readFileSync(path.join(rootDirectory, "js", "dashboard.js"), "utf8");

  assert.doesNotMatch(html, /Top Gainers|Top Losers|Highest Volume|Strongest Momentum|AI Opportunities|scanner-preview/i);
  assert.doesNotMatch(script, /market-summary|scanner-gainers|scanner-opportunities/i);
  assert.match(html, /href="\/scanner\.html"/);
  assert.match(html, /Portfolio history/);
  assert.match(html, /data-portfolio-chart/);
});

test("Agent Status spans the dashboard while Risk Control sits beside Position Monitoring", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  const statusPanel = html.indexOf('class="dashboard-panel status-panel"');
  const agentStatus = html.indexOf("<h2>Agent Status</h2>", statusPanel);
  const brain = html.indexOf('data-agent-brain-stage', agentStatus);
  const portfolioChart = html.indexOf('class="dashboard-panel chart-panel"');
  const portfolioSummary = html.indexOf('id="summary-heading"');
  const summaries = html.match(
    /<section class="dashboard-grid dashboard-grid-lists"[^>]*>([\s\S]*?)<\/section>/
  );
  const riskControl = summaries && summaries[1].indexOf('class="dashboard-panel emergency-panel"');
  const positionMonitoring = summaries && summaries[1].indexOf('data-dashboard-list="position-ai-status"');

  assert.ok(statusPanel >= 0);
  assert.ok(agentStatus > statusPanel);
  assert.ok(brain > agentStatus && brain < portfolioChart);
  assert.ok(summaries);
  assert.ok(positionMonitoring >= 0 && riskControl > positionMonitoring);
  assert.doesNotMatch(html, /dashboard-grid-risk/);
  assert.ok(portfolioSummary < statusPanel);
  assert.match(html, /class="agent-status-monitor"[\s\S]*Live backend signal[\s\S]*status-wave/);
  assert.match(html, /Agent circuit visualization; status UNKNOWN/);
  assert.match(html, /Circuit visualization unavailable/);
  assert.match(styles, /\.dashboard-grid-lists\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.agent-brain-stage\s*\{[^}]*width:\s*min\(100%,\s*90vh\);[^}]*aspect-ratio:\s*1;/s);
  assert.match(styles, /\.agent-status-monitor\s*\{[^}]*margin-top:\s*8px;/s);
  assert.match(styles, /\.circuit-board-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.agent-brain\[data-visualization="ready"\].*\.agent-brain-fallback\s*\{\s*display:\s*none\s*!important;/s);
});

test("portfolio chart legend icons are gray without recoloring chart datasets", () => {
  const defaultLabels = [{
    text: "Portfolio 1",
    fillStyle: "#5b9cff22",
    strokeStyle: "#5b9cff",
    datasetIndex: 0
  }];
  const ChartConstructor = {
    defaults: {
      plugins: {
        legend: {
          labels: {
            generateLabels: () => defaultLabels
          }
        }
      }
    }
  };
  const config = dashboard.createPortfolioChartConfig([
    { portfolio_id: "one", captured_at: "2026-03-20T10:00:00.000Z", portfolio_value: "100" },
    { portfolio_id: "two", captured_at: "2026-03-20T10:00:00.000Z", portfolio_value: "200" }
  ], ChartConstructor);
  const labels = config.options.plugins.legend.labels.generateLabels({
    data: config.data,
    isDatasetVisible: () => true
  });

  assert.equal(config.options.plugins.legend.display, true);
  assert.equal(labels[0].fillStyle, "#8792a1");
  assert.equal(labels[0].strokeStyle, "#8792a1");
  assert.notEqual(config.data.datasets[0].borderColor, "#8792a1");
});

test("dashboard renders safe empty states without inventing portfolio history", () => {
  const { dashboardDocument, elements } = createDashboardDocument();

  dashboard.renderDashboard(dashboard.emptyDashboardData(), dashboardDocument, null);

  assert.equal(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-value=\"totalPnl\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "0");
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "UNKNOWN");
  assert.equal(elements.get("[data-dashboard-activity=\"bot-run\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-activity=\"market-data\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-activity=\"paper-trade\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-empty=\"positions\"]")[0].hidden, false);
  assert.equal(elements.get("[data-portfolio-chart]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-chart-empty]")[0].hidden, false);
  assert.match(elements.get("[data-dashboard-chart-empty]")[0].textContent, /first database snapshot/);
});

test("dashboard KPI information is accessible, English-only, and covers all portfolio metrics", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const requiredKpis = [
    ["portfolio-value", "Portfolio Value"],
    ["total-pnl", "Total P&amp;L"],
    ["realized-pnl", "Realized P&amp;L"],
    ["unrealized-pnl", "Open Positions Gain/Loss", "Explain gain or loss on open positions"],
    ["daily-pnl", "Daily P&amp;L"],
    ["win-rate", "Win Rate"],
    ["open-positions", "Open Positions"],
    ["available-balance", "Available Balance"],
    ["ai-decisions", "AI Decisions"],
    ["paper-trades", "Paper Trades"],
    ["tracked-markets", "Tracked Markets"]
  ];

  assert.match(html, /<html lang="en"/);
  assert.equal((html.match(/data-dashboard-kpi-info/g) || []).length, requiredKpis.length);
  for (const [id, label, ariaLabel = `Explain ${label}`] of requiredKpis) {
    assert.match(html, new RegExp(`aria-label="${ariaLabel}"`));
    assert.match(html, new RegExp(`aria-controls="kpi-info-${id}"`));
    assert.match(html, new RegExp(`aria-describedby="kpi-info-${id}"`));
    assert.match(html, new RegExp(`id="kpi-info-${id}" role="tooltip" hidden`));
  }
  assert.match(
    html,
    /<span class="metric-label">Open Positions Gain\/Loss<\/span>/
  );
  assert.match(
    html,
    /id="kpi-info-unrealized-pnl" role="tooltip" hidden>Estimated gain or loss on positions you still hold, based on current prices\. It is not realized profit or loss from a completed sale\./
  );
  assert.doesNotMatch(html, /Hoofdnavigatie|Instellingen|Uitloggen|Alle bedragen|Databasegegevens|Opnieuw proberen|Overzicht|afzonderlijk|Geen echte orders/i);
});

test("dashboard KPI info icons use neutral gray while retaining keyboard focus visibility", () => {
  const styles = fs.readFileSync(path.join(rootDirectory, "css/styles.css"), "utf8");

  assert.match(
    styles,
    /\.kpi-info-trigger\s*\{[^}]*border:\s*1px solid #6d7785;[^}]*background:\s*var\(--surface-raised\);[^}]*color:\s*var\(--muted\);/s
  );
  assert.match(styles, /\.kpi-info-trigger:hover,[\s\S]*?background:\s*#303741;/);
  assert.match(styles, /\.kpi-info-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\);/s);
});

test("BUY and SELL labels use the shared positive and negative colors", () => {
  const styles = fs.readFileSync(path.join(rootDirectory, "css/styles.css"), "utf8");

  assert.match(styles, /\.trade-action-buy\s*\{[^}]*color:\s*var\(--positive\);/s);
  assert.match(styles, /\.trade-action-sell\s*\{[^}]*color:\s*var\(--negative\);/s);
  assert.match(styles, /\.history-filters option\[value="buy"\]\s*\{[^}]*color:\s*var\(--positive\);/s);
  assert.match(styles, /\.history-filters option\[value="sell"\]\s*\{[^}]*color:\s*var\(--negative\);/s);
});

test("dashboard collapses portfolio metrics after Win Rate by default", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const winRateIndex = html.indexOf('data-dashboard-value="winRate"');
  const additionalMetricsIndex = html.indexOf('<details class="dashboard-extra-metrics">');

  assert.ok(winRateIndex >= 0);
  assert.ok(additionalMetricsIndex > winRateIndex);
  assert.match(html, /<details class="dashboard-extra-metrics">\s*<summary>Show additional metrics<\/summary>/);
  assert.doesNotMatch(html, /<details class="dashboard-extra-metrics" open>/);
  assert.match(html, /<details class="dashboard-extra-metrics">[\s\S]*data-dashboard-value="openPositions"/);
});

test("dashboard list panels start collapsed and prioritize open-position AI status", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  const listSection = html.match(
    /<section class="dashboard-grid dashboard-grid-lists"[^>]*>([\s\S]*?)<\/section>/
  );
  const panels = listSection
    ? [...listSection[1].matchAll(/<details class="dashboard-panel dashboard-list-panel">([\s\S]*?)<\/details>/g)]
    : [];
  assert.equal(panels.length, 3);
  assert.deepEqual(panels.map(([, panel]) => panel.match(/<p class="eyebrow">([^<]+)<\/p>/)[1]), [
    "Portfolio",
    "Activity",
    "Position monitoring"
  ]);
  assert.doesNotMatch(html, /Market universe|data-dashboard-list="markets"/);
  assert.doesNotMatch(listSection[1], /<details\b[^>]*\bopen(?:\s|>)/);
  for (const [title, value] of [
    ["Open Positions", "openPositions"],
    ["Recent Trades", "paperTrades"],
    ["Open Position AI Status", "openPositionAiStatus"]
  ]) {
    assert.match(
      listSection[1],
      new RegExp(`<h2>${title} <span class="dashboard-panel-count">\\(<span data-dashboard-value="${value}">0<\\/span>\\)<\\/span><\\/h2>`)
    );
  }
  assert.doesNotMatch(listSection[1], /class="count-pill"/);
  assert.match(styles, /\.dashboard-shell\s*\{[^}]*padding-block:\s*16px 64px;/s);
  for (const listName of ["positions", "trades", "position-ai-status"]) {
    assert.match(listSection[1], new RegExp(`data-dashboard-list="${listName}"`));
  }
  assert.doesNotMatch(listSection[1], /Recent AI Decisions/);
  assert.match(listSection[1], /href="\/history\.html">View history<\/a>/);

  const activityStrip = html.match(/<dl class="activity-strip">([\s\S]*?)<\/dl>/);
  assert.ok(activityStrip);
  assert.match(activityStrip[1], /Bot run[\s\S]*data-dashboard-activity="bot-run"/);
  assert.match(activityStrip[1], /Market data[\s\S]*data-dashboard-activity="market-data"/);
  assert.match(activityStrip[1], /Paper trade[\s\S]*data-dashboard-activity="paper-trade"/);
  assert.match(activityStrip[1], /Analytics[\s\S]*On demand[\s\S]*Market scan[\s\S]*On demand/);
  assert.match(
    styles,
    /\.activity-strip\s*\{[^}]*background:\s*linear-gradient\(105deg,\s*#193a31,\s*var\(--positive-dark\)\s+58%,\s*#193a31\);/s
  );
  assert.match(styles, /\.activity-strip dt\s*\{[^}]*color:\s*var\(--positive\);/s);
});

test("dashboard KPI information opens, toggles, dismisses outside, and closes with Escape", () => {
  function createInfoElement(controlId = null) {
    return {
      attributes: controlId ? { "aria-controls": controlId, "aria-expanded": "false" } : {},
      descendants: new Set(),
      hidden: true,
      listeners: {},
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      },
      removeEventListener(name) {
        delete this.listeners[name];
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      getAttribute(name) {
        return this.attributes[name] || null;
      },
      contains(target) {
        return target === this || this.descendants.has(target);
      },
      focus() {
        this.focused = true;
      },
      dispatch(name, event = {}) {
        this.listeners[name]?.(event);
      }
    };
  }

  const firstTrigger = createInfoElement("kpi-info-first");
  const secondTrigger = createInfoElement("kpi-info-second");
  const firstPopover = createInfoElement();
  const secondPopover = createInfoElement();
  const firstPopoverContent = {};
  firstPopover.descendants.add(firstPopoverContent);
  const documentRef = {
    listeners: {},
    querySelectorAll() {
      return [firstTrigger, secondTrigger];
    },
    getElementById(id) {
      return {
        "kpi-info-first": firstPopover,
        "kpi-info-second": secondPopover
      }[id] || null;
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    removeEventListener(name) {
      delete this.listeners[name];
    },
    dispatch(name, event = {}) {
      this.listeners[name]?.(event);
    }
  };
  const dispose = dashboard.initializeKpiInfo(documentRef);

  firstTrigger.dispatch("click");
  documentRef.dispatch("click", { target: firstTrigger });
  assert.equal(firstPopover.hidden, false);
  assert.equal(firstTrigger.attributes["aria-expanded"], "true");

  documentRef.dispatch("click", { target: firstPopoverContent });
  assert.equal(firstPopover.hidden, false);

  secondTrigger.dispatch("click");
  documentRef.dispatch("click", { target: secondTrigger });
  assert.equal(firstPopover.hidden, true);
  assert.equal(firstTrigger.attributes["aria-expanded"], "false");
  assert.equal(secondPopover.hidden, false);

  let escapePrevented = false;
  documentRef.dispatch("keydown", {
    key: "Escape",
    preventDefault() {
      escapePrevented = true;
    }
  });
  assert.equal(secondPopover.hidden, true);
  assert.equal(secondTrigger.attributes["aria-expanded"], "false");
  assert.equal(secondTrigger.focused, true);
  assert.equal(escapePrevented, true);

  firstTrigger.dispatch("click");
  documentRef.dispatch("click", { target: firstTrigger });
  documentRef.dispatch("click", { target: {} });
  assert.equal(firstPopover.hidden, true);
  assert.equal(firstTrigger.attributes["aria-expanded"], "false");

  dispose();
  assert.equal(firstTrigger.listeners.click, undefined);
  assert.equal(documentRef.listeners.click, undefined);
  assert.equal(documentRef.listeners.keydown, undefined);
});

test("chart rendering failures do not hide already-rendered dashboard values", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  class BrokenChart {
    constructor() {
      throw new Error("chart library failure");
    }
  }
  const data = dashboard.emptyDashboardData();
  data.portfolio.portfolioValue = 1200;
  data.portfolioSnapshots = [{
    portfolio_id: "portfolio-1",
    portfolio_value: "1200",
    captured_at: "2026-03-20T11:00:00.000Z"
  }];

  dashboard.renderDashboard(data, dashboardDocument, BrokenChart);

  assert.match(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, /1,200/);
  assert.equal(elements.get("[data-portfolio-chart]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-chart-empty]")[0].hidden, false);
  assert.match(elements.get("[data-dashboard-chart-empty]")[0].textContent, /chart is currently unavailable/);
});

test("dashboard requests same-origin API data and validates error responses", async () => {
  let request;
  const expected = { data: { portfolioValue: 12 } };
  assert.deepEqual(await dashboard.requestDashboardData(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => expected };
  }), expected.data);
  assert.equal(request.url, "/api/dashboard-data");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.cache, "no-store");

  let statusRequest;
  assert.equal(await dashboard.requestAgentStatus(async (url, options) => {
    statusRequest = { url, options };
    return { ok: true, status: 200, json: async () => ({ data: { status: "ACTIVE" } }) };
  }), "ACTIVE");
  assert.equal(statusRequest.url, "/api/agent-status");
  assert.equal(statusRequest.options.credentials, "same-origin");
  assert.equal(statusRequest.options.cache, "no-store");

  await assert.rejects(
    () => dashboard.requestDashboardData(async () => ({ ok: false, status: 401 })),
    (error) => error.status === 401
  );
  await assert.rejects(
    () => dashboard.requestDashboardData(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    /response is invalid/
  );
  await assert.rejects(
    () => dashboard.requestAgentStatus(async () => ({ ok: false, status: 503 })),
    /status is unavailable/
  );
});

test("dashboard waits for authentication and offers retry after a load error", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  let resolveAuth;
  let fetchCalls = 0;
  const authReady = new Promise((resolve) => { resolveAuth = resolve; });
  const windowRef = {
    CryptoPulseAuthReady: authReady,
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("network unavailable");
    }
  };

  dashboard.startDashboard({ windowRef, documentRef: dashboardDocument });
  await Promise.resolve();
  assert.equal(fetchCalls, 0);

  resolveAuth();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls, 1);
  assert.equal(elements.get("[data-dashboard-error]")[0].hidden, false);
  assert.equal(elements.get("[data-dashboard-retry]")[0].hidden, false);
});

test("dashboard keeps the tracked-markets KPI without displaying the market list", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.watchedMarkets = {
    count: 1,
    items: [{ symbol: "BTC-EUR", priority: 1 }]
  };
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain: () => ({ available: true, setStatus() {}, dispose() {} })
    },
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (url) => {
      if (url === "/api/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      if (url === "/api/agent-status") {
        return { ok: true, status: 200, json: async () => ({ data: { status: null } }) };
      }
      throw new Error(`Unexpected dashboard request: ${url}`);
    }
  };

  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "1");
  assert.equal(elements.has("[data-dashboard-list=\"markets\"]"), false);
  controller.dispose();
});

test("dashboard refreshes all data periodically and when returning to the foreground", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = { status: "ACTIVE" };
  dashboardData.aiDecisions = { count: 1, items: [] };
  const requests = [];
  const intervals = new Map();
  let nextIntervalId = 0;
  let holdNextDashboardRequest = false;
  let failNextDashboardRequest = false;
  let resolveHeldDashboardRequest;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain: () => ({ available: true, setStatus() {}, dispose() {} })
    },
    location: { replace() {} }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null,
    fetchImpl: async (url) => {
      requests.push(url);
      if (url === "/api/dashboard-data") {
        if (failNextDashboardRequest) {
          failNextDashboardRequest = false;
          return { ok: false, status: 503 };
        }
        if (holdNextDashboardRequest) {
          holdNextDashboardRequest = false;
          return new Promise((resolve) => {
            resolveHeldDashboardRequest = () => resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: dashboardData })
            });
          });
        }
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      if (url === "/api/agent-status") {
        return { ok: true, status: 200, json: async () => ({ data: { status: "ACTIVE" } }) };
      }
      throw new Error(`Unexpected dashboard request: ${url}`);
    },
    setIntervalImpl(callback, delay) {
      const id = ++nextIntervalId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalImpl(id) {
      intervals.delete(id);
    }
  });
  const flushDashboardLoad = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  await flushDashboardLoad();

  assert.equal(requests.filter((url) => url === "/api/dashboard-data").length, 1);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.deepEqual([...intervals.values()].map(({ delay }) => delay).sort(), [15000, 30000]);
  const dashboardInterval = [...intervals.values()].find(({ delay }) => delay === 30000);

  dashboardData.aiDecisions.count = 2;
  await dashboardInterval.callback();
  assert.equal(requests.filter((url) => url === "/api/dashboard-data").length, 2);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "2");

  holdNextDashboardRequest = true;
  const heldRefresh = dashboardInterval.callback();
  await Promise.resolve();
  const duplicateRefresh = controller.load();
  assert.equal(requests.filter((url) => url === "/api/dashboard-data").length, 3);

  dashboardDocument.visibilityState = "hidden";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 0);
  const requestCountWhileHidden = requests.length;
  await dashboardInterval.callback();
  assert.equal(requests.length, requestCountWhileHidden);

  dashboardData.aiDecisions.count = 4;
  dashboardDocument.visibilityState = "visible";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 2);
  resolveHeldDashboardRequest();
  await Promise.all([heldRefresh, duplicateRefresh]);
  await flushDashboardLoad();
  assert.equal(requests.filter((url) => url === "/api/dashboard-data").length, 4);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "4");

  dashboardDocument.visibilityState = "hidden";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 0);
  const requestCountAfterBackgrounding = requests.length;
  await dashboardInterval.callback();
  assert.equal(requests.length, requestCountAfterBackgrounding);

  dashboardData.aiDecisions.count = 5;
  dashboardDocument.visibilityState = "visible";
  dashboardDocument.listeners.visibilitychange();
  await flushDashboardLoad();
  assert.equal(requests.filter((url) => url === "/api/dashboard-data").length, 5);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "5");
  assert.equal(intervals.size, 2);

  failNextDashboardRequest = true;
  await dashboardInterval.callback();
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "5");
  assert.equal(elements.get("[data-dashboard-error]")[0].hidden, false);
  assert.equal(elements.get("[data-dashboard-retry]")[0].hidden, false);

  controller.dispose();
  assert.equal(intervals.size, 0);
});

test("dashboard redirects to login when the data API reports an expired session", async () => {
  const { dashboardDocument } = createDashboardDocument();
  const redirects = [];
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    location: { replace: (target) => redirects.push(target) },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async () => ({ ok: false, status: 401 })
  };

  dashboard.startDashboard({ windowRef, documentRef: dashboardDocument });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(redirects, ["/login.html?next=%2Fdashboard.html"]);
});

test("dashboard applies live database status updates and pauses polling while hidden", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const statusUpdates = [];
  const intervals = new Map();
  const clearedIntervals = [];
  let nextIntervalId = 0;
  let pollStatus = "ANALYZING";
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = { status: "ACTIVE" };
  const agentBrainApi = {
    createAgentBrain(options) {
      statusUpdates.push(options.initialStatus);
      return {
        available: true,
        setStatus(status) {
          statusUpdates.push(status);
        },
        dispose() {}
      };
    }
  };
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: agentBrainApi,
    location: { replace() {} },
    fetch: async (url) => {
      if (url === "/api/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      if (url === "/api/agent-status") {
        return { ok: true, status: 200, json: async () => ({ data: { status: pollStatus } }) };
      }
      throw new Error(`Unexpected dashboard request: ${url}`);
    }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null,
    setIntervalImpl(callback, delay) {
      const id = ++nextIntervalId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalImpl(id) {
      clearedIntervals.push(id);
      intervals.delete(id);
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "ACTIVE");
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.deepEqual(statusUpdates, ["ACTIVE"]);
  assert.equal(intervals.size, 2);
  const [intervalId, interval] = [...intervals.entries()]
    .find(([, currentInterval]) => currentInterval.delay === 15000);
  const [dashboardIntervalId, dashboardInterval] = [...intervals.entries()]
    .find(([, currentInterval]) => currentInterval.delay === 30000);
  assert.equal(interval.delay, 15000);
  assert.equal(dashboardInterval.delay, 30000);

  await controller.refreshAgentStatus();
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "ANALYZING");
  elements.get("[data-agent-brain-fallback]")[0].hidden = false;
  await controller.refreshAgentStatus();
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.deepEqual(statusUpdates, ["ACTIVE", "ANALYZING", "ANALYZING"]);

  dashboardDocument.visibilityState = "hidden";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 0);
  assert.deepEqual(new Set(clearedIntervals), new Set([intervalId, dashboardIntervalId]));
  const callsBeforeHiddenPoll = statusUpdates.length;
  await interval.callback();
  await dashboardInterval.callback();
  assert.equal(statusUpdates.length, callsBeforeHiddenPoll);

  dashboardDocument.visibilityState = "visible";
  pollStatus = "STOPPED";
  dashboardData.agentStatus.status = "STOPPED";
  dashboardDocument.listeners.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "STOPPED");
  assert.equal(intervals.size, 2);
  controller.dispose();
  assert.equal(intervals.size, 0);
});

test("dashboard keeps the circuit static and accessible when status is UNKNOWN", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = null;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: require("../js/agent-brain.js"),
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: dashboardData }) })
  };

  dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "UNKNOWN");
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.state, "unknown");
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "ready");
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.match(elements.get("[data-agent-brain-stage]")[0].innerHTML, /circuit-flow--stopped/);
  assert.equal(
    elements.get("[data-agent-brain-stage]")[0].attributes["aria-label"],
    "Agent circuit visualization; status UNKNOWN"
  );
});

test("dashboard retries circuit initialization after a transient failure", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  let initializationAttempts = 0;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain() {
        initializationAttempts += 1;
        if (initializationAttempts === 1) {
          return {
            available: false,
            setStatus() {},
            dispose() {}
          };
        }
        return {
          available: true,
          setStatus() {},
          dispose() {}
        };
      }
    },
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (url) => {
      if (url === "/api/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { status: null } }) };
    }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(initializationAttempts, 1);
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, false);
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "unavailable");

  await controller.refreshAgentStatus();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(initializationAttempts, 2);
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "ready");
  controller.dispose();
});

test("dashboard keeps fallback hidden when the circuit survives a status update error", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = { status: "ACTIVE" };
  let disposeCalls = 0;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain() {
        return {
          available: true,
          isAvailable: () => true,
          setStatus() {
            throw new Error("Status animation update failed.");
          },
          dispose() {
            disposeCalls += 1;
          }
        };
      }
    },
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (url) => {
      if (url === "/api/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { status: "ANALYZING" } }) };
    }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await controller.refreshAgentStatus();

  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "ready");
  assert.equal(disposeCalls, 0);
  controller.dispose();
});
