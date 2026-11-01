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
      reason: "Risk limits prevent opening a new paper position.",
      strategy_name: null,
      strategy_version: null,
      created_at: "2026-03-20T11:45:00.000Z"
    }],
    AI_Crypto_Bot_Portfolio_Snapshots: [
      { portfolio_id: "portfolio-1", portfolio_value: "1050", captured_at: "2026-03-20T10:00:00.000Z" },
      { portfolio_id: "portfolio-1", portfolio_value: "1100", captured_at: "2026-03-20T11:00:00.000Z" }
    ]
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
    },
    append(...children) {
      this.children.push(...children);
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
    "[data-dashboard-value=\"availableBalance\"]",
    "[data-dashboard-value=\"aiDecisions\"]",
    "[data-dashboard-value=\"paperTrades\"]",
    "[data-dashboard-value=\"trackedMarkets\"]",
    "[data-dashboard-value=\"portfolioCount\"]",
    "[data-dashboard-status=\"agent\"]",
    "[data-dashboard-status=\"emergency\"]",
    "[data-dashboard-list=\"positions\"]",
    "[data-dashboard-list=\"trades\"]",
    "[data-dashboard-list=\"markets\"]",
    "[data-dashboard-list=\"decisions\"]",
    "[data-dashboard-empty=\"positions\"]",
    "[data-dashboard-empty=\"trades\"]",
    "[data-dashboard-empty=\"markets\"]",
    "[data-dashboard-empty=\"decisions\"]",
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
    agentStatus: { status: "ANALYZING" },
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
      count: 1,
      items: [{
        symbol: "<img src=x>",
        amount: 0.01,
        entry_price: 0.00453954,
        current_price: 0.05671234,
        unrealized_pnl: 100,
        created_at: "2026-03-20T10:00:00.000Z"
      }]
    },
    recentTrades: { count: 2, items: [{ side: "SELL", symbol: "BTC-EUR", quantity: 0.001, price: 0.98123456, created_at: generatedAt }] },
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

  dashboard.renderDashboard(data, dashboardDocument, FakeChart);

  assert.match(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, /1,100/);
  assert.equal(elements.get("[data-dashboard-value=\"openPositions\"]")[0].textContent, "1");
  assert.equal(elements.get("[data-dashboard-value=\"openPositions\"]")[1].textContent, "1");
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "ANALYZING");
  assert.equal(elements.get("[data-dashboard-status=\"emergency\"]")[0].dataset.state, "paused");
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[0].textContent, "<img src=x> · 0.01 units");
  assert.match(
    elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[1].textContent,
    /Entry €\s?0\.00454 · Current €\s?0\.05671 · P&L €\s?100\.00 · Opened .*11:00/
  );
  assert.match(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[0].children[1].textContent,
    /€\s?0\.98123.*13:00/
  );
  assert.match(
    elements.get("[data-dashboard-list=\"decisions\"]")[0].children[0].children[1].textContent,
    /Recorded .*13:00 · No action/
  );
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].hidden, false);
  assert.equal(elements.get("[data-dashboard-empty=\"positions\"]")[0].hidden, true);
  assert.match(
    elements.get("[data-dashboard-list=\"markets\"]")[0].children[0].children[1].textContent,
    /^Priority 1$/
  );
  assert.equal(elements.get("[data-portfolio-chart]")[0].hidden, false);
  assert.deepEqual(chartConfig.data.datasets[0].data, [1050, 1100]);
  assert.ok(chartConfig.data.labels.some((label) => label.endsWith("12:00")));
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

test("Agent Brain uses a full-width panel with Emergency State at the dashboard bottom", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  const statusPanel = html.indexOf('class="dashboard-panel status-panel"');
  const agentStatus = html.indexOf("<h2>Agent Status</h2>", statusPanel);
  const brain = html.indexOf('data-agent-brain-stage', agentStatus);
  const portfolioChart = html.indexOf('class="dashboard-panel chart-panel"');
  const lastDashboardList = html.indexOf('data-dashboard-list="decisions"');
  const emergencyState = html.indexOf('class="dashboard-panel emergency-panel"');
  const mainEnd = html.indexOf("</main>");
  const portfolioSummary = html.indexOf('id="summary-heading"');

  assert.ok(statusPanel >= 0);
  assert.ok(agentStatus > statusPanel);
  assert.ok(brain > agentStatus && brain < portfolioChart);
  assert.ok(lastDashboardList < emergencyState && emergencyState < mainEnd);
  assert.ok(portfolioSummary < statusPanel);
  assert.match(html, /class="agent-status-monitor"[\s\S]*Live backend signal[\s\S]*status-wave/);
  assert.doesNotMatch(html, /Agent Brain visualization · Phase 05/);
  assert.match(styles, /\.dashboard-grid-status,\s*\.dashboard-grid-risk\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(styles, /\.agent-brain-stage\s*\{[^}]*height:\s*clamp\(280px,\s*32vw,\s*380px\);/s);
  assert.match(styles, /@media \(max-width: 559px\)\s*\{[^}]*\.agent-brain-stage\s*\{[^}]*height:\s*230px;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.agent-brain\[data-visualization="ready"\].*\.agent-brain-fallback\s*\{\s*display:\s*none\s*!important;/s);
});

test("dashboard renders safe empty states without inventing portfolio history", () => {
  const { dashboardDocument, elements } = createDashboardDocument();

  dashboard.renderDashboard(dashboard.emptyDashboardData(), dashboardDocument, null);

  assert.equal(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-value=\"totalPnl\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "0");
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "UNKNOWN");
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
    ["unrealized-pnl", "Unrealized P&amp;L"],
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
  for (const [id, label] of requiredKpis) {
    assert.match(html, new RegExp(`aria-label="Explain ${label}"`));
    assert.match(html, new RegExp(`aria-controls="kpi-info-${id}"`));
    assert.match(html, new RegExp(`aria-describedby="kpi-info-${id}"`));
    assert.match(html, new RegExp(`id="kpi-info-${id}" role="tooltip" hidden`));
  }
  assert.doesNotMatch(html, /Hoofdnavigatie|Instellingen|Uitloggen|Alle bedragen|Databasegegevens|Opnieuw proberen|Overzicht|afzonderlijk|Geen echte orders/i);
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

test("dashboard displays tracked markets without requesting scanner data", async () => {
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
    loadThree: async () => ({ scene: true })
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "1");
  assert.equal(elements.get("[data-dashboard-list=\"markets\"]")[0].children[0].children[1].textContent, "Priority 1");
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
    loadThree: async () => ({ scene: true }),
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
    loadThree: async () => ({ scene: true }),
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

test("dashboard uses UNKNOWN and the neutral fallback when status or Three.js is unavailable", async () => {
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
    ChartConstructor: null,
    loadThree: async () => { throw new Error("Three.js CDN is unavailable."); }
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "UNKNOWN");
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.state, "unknown");
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, false);
});

test("dashboard retries renderer initialization and hides fallback after the renderer becomes available", async () => {
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
    ChartConstructor: null,
    loadThree: async () => ({ scene: true })
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

test("dashboard keeps fallback hidden when a successful renderer survives a status update error", async () => {
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
    ChartConstructor: null,
    loadThree: async () => ({ scene: true })
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await controller.refreshAgentStatus();

  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "ready");
  assert.equal(disposeCalls, 0);
  controller.dispose();
});
