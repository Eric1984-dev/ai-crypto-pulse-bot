"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const history = require("../js/history.js");
const dashboardDataModule = import("../api/dashboard-data.mjs");

const authEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  NODE_ENV: "production"
};
const sessionCookie = "cp_access_token=header.payload.signature";
const fixedNow = new Date("2026-03-20T12:00:00.000Z");
const rootDirectory = path.resolve(__dirname, "..");

const statsRow = {
  closed_trade_count: "2",
  winning_trade_count: "1",
  losing_trade_count: "1",
  average_profit: "10",
  average_loss: "-4",
  best_trade: "10",
  worst_trade: "-4"
};

function createResponse(statusCode, body, contentRange = null) {
  return {
    statusCode,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
    },
    get ok() {
      return this.statusCode >= 200 && this.statusCode < 300;
    },
    async json() {
      return body;
    },
    headersObject: {
      get(name) {
        return name.toLowerCase() === "content-range" ? contentRange : null;
      }
    }
  };
}

function createSupabaseFetch({
  totalCount = 1,
  items = [],
  positions = [],
  marketData = [],
  stats = statsRow,
  calls = []
} = {}) {
  return async (url, options) => {
    const parsedUrl = new URL(url);
    const table = parsedUrl.pathname.split("/").pop();
    const query = parsedUrl.searchParams;
    calls.push({ url: parsedUrl, table, query, options });

    if (parsedUrl.pathname.includes("/rpc/")) {
      const response = createResponse(200, [stats]);
      response.headers = response.headersObject;
      return response;
    }

    if (table === "AI_Crypto_Bot_Positions") {
      const response = createResponse(200, positions);
      response.headers = response.headersObject;
      return response;
    }
    if (table === "AI_Crypto_Bot_Market_Data") {
      const response = createResponse(200, marketData);
      response.headers = response.headersObject;
      return response;
    }
    if (query.get("select") === "id") {
      const response = createResponse(200, [], `0-0/${totalCount}`);
      response.headers = response.headersObject;
      return response;
    }
    const response = createResponse(200, items);
    response.headers = response.headersObject;
    return response;
  };
}

function createTradeRow(overrides = {}) {
  return {
    id: "trade-1",
    symbol: "BTC-EUR",
    side: "SELL",
    price: "100",
    quantity: "0.5",
    fees: "0.25",
    realized_pnl: "10",
    created_at: "2026-03-20T11:00:00.000Z",
    ...overrides
  };
}

async function requestApi(url, fetchImpl, env = authEnv) {
  const module = await dashboardDataModule;
  const handler = module.createHandler({
    env,
    verify: async () => true,
    fetchImpl,
    now: () => fixedNow
  });
  const response = createResponse();
  await handler({ method: "GET", url, headers: { cookie: sessionCookie } }, response);
  return response;
}

test("trade history uses the existing authenticated dashboard API with server-side filters and sorting", async () => {
  const calls = [];
  const response = await requestApi(
    "/api/dashboard-data?view=trade-history&page=2&search=btc&side=sell&period=7d&sort=pnl-high",
    createSupabaseFetch({ totalCount: 30, items: [createTradeRow()], calls })
  );

  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.deepEqual(data, {
    page: 2,
    pageSize: 25,
    totalCount: 30,
    totalPages: 2,
    sort: "pnl-high",
    filters: { search: "BTC", side: "sell", period: "7d" },
    items: [createTradeRow()],
    stats: {
      closedTrades: 2,
      winningTrades: 1,
      losingTrades: 1,
      averageProfit: 10,
      averageLoss: -4,
      bestTrade: 10,
      worstTrade: -4
    }
  });

  const countRequest = calls.find((call) => call.query.get("select") === "id");
  assert.equal(countRequest.table, "AI_Crypto_Bot_Trades");
  assert.equal(countRequest.query.get("symbol"), "like.BTC*");
  assert.equal(countRequest.query.get("side"), "eq.SELL");
  assert.equal(countRequest.query.get("created_at"), "gte.2026-03-13T12:00:00.000Z");

  const pageRequest = calls.find((call) => call.query.has("offset"));
  assert.equal(pageRequest.query.get("offset"), "25");
  assert.equal(pageRequest.query.get("limit"), "25");
  assert.equal(pageRequest.query.get("order"), "realized_pnl.desc,created_at.desc,id.desc");
  assert.equal(pageRequest.query.get("select"), "id,portfolio_id,symbol,side,price,quantity,fees,realized_pnl,created_at");

  const statsRequest = calls.find((call) => call.url.pathname.endsWith("/rpc/AI_Crypto_Bot_Trade_History_Stats"));
  assert.ok(statsRequest);
  assert.equal(statsRequest.options.headers.authorization, "Bearer header.payload.signature");
  assert.equal(statsRequest.options.headers.apikey, authEnv.SUPABASE_ANON_KEY);
  assert.equal(statsRequest.options.cache, "no-store");
});

test("trade history enriches an open BUY with its latest market snapshot", async () => {
  const trade = createTradeRow({
    portfolio_id: "portfolio-1",
    symbol: "WIN-EUR",
    side: "BUY",
    price: "0.000061",
    quantity: "1000000",
    fees: "15.25",
    realized_pnl: "0",
    created_at: "2026-03-20T11:00:00.000Z"
  });
  const position = {
    portfolio_id: "portfolio-1",
    symbol: "WIN-EUR",
    amount: "1000000",
    entry_price: "0.00006123",
    current_price: "0.000062",
    created_at: trade.created_at
  };
  const calls = [];
  const response = await requestApi(
    "/api/dashboard-data?view=trade-history",
    createSupabaseFetch({
      items: [trade],
      positions: [position],
      marketData: [{
        symbol: "WIN-EUR",
        price: "0.000067",
        captured_at: "2026-03-20T11:59:00.000Z"
      }],
      calls
    })
  );

  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.equal(data.items[0].symbol, "WIN-EUR");
  assert.equal(data.items[0].openPosition.current_market_price, "0.000067");
  assert.equal(data.items[0].openPosition.current_market_captured_at, "2026-03-20T11:59:00.000Z");
  assert.equal(data.items[0].openPosition.entry_price, "0.00006123");
  assert.equal(Object.hasOwn(data.items[0], "portfolio_id"), false);
  const marketDataRequest = calls.find((call) => call.table === "AI_Crypto_Bot_Market_Data");
  assert.equal(marketDataRequest.query.get("symbol"), "in.(WIN-EUR)");
});

test("trade history clamps stale page requests and bounds large datasets to one page", async () => {
  const calls = [];
  const response = await requestApi(
    "/api/dashboard-data?view=trade-history&page=4000&sort=oldest",
    createSupabaseFetch({ totalCount: 1000000, items: Array.from({ length: 25 }, (_, index) => createTradeRow({ id: `trade-${index}` })), calls })
  );

  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.equal(data.totalPages, 40000);
  assert.equal(data.page, 4000);
  assert.equal(data.items.length, 25);
  const pageRequest = calls.find((call) => call.query.has("offset"));
  assert.equal(pageRequest.query.get("offset"), "99975");
  assert.equal(pageRequest.query.get("order"), "created_at.asc,id.asc");

  const stalePageCalls = [];
  const stalePageResponse = await requestApi(
    "/api/dashboard-data?view=trade-history&page=99",
    createSupabaseFetch({ totalCount: 30, items: [createTradeRow()], calls: stalePageCalls })
  );
  assert.equal(JSON.parse(stalePageResponse.body).data.page, 2);
  assert.equal(stalePageCalls.find((call) => call.query.has("offset")).query.get("offset"), "25");
});

test("trade history returns a graceful empty page and exact empty statistics", async () => {
  const emptyStats = {
    closed_trade_count: "0",
    winning_trade_count: "0",
    losing_trade_count: "0",
    average_profit: null,
    average_loss: null,
    best_trade: null,
    worst_trade: null
  };
  const response = await requestApi(
    "/api/dashboard-data?view=trade-history",
    createSupabaseFetch({ totalCount: 0, items: [], stats: emptyStats })
  );

  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.equal(data.totalCount, 0);
  assert.equal(data.totalPages, 0);
  assert.equal(data.page, 1);
  assert.deepEqual(data.items, []);
  assert.deepEqual(data.stats, {
    closedTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    averageProfit: null,
    averageLoss: null,
    bestTrade: null,
    worstTrade: null
  });
});

test("trade history rejects malformed filters without querying Supabase", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("Database should not be queried.");
  };

  const invalidSearch = await requestApi(
    "/api/dashboard-data?view=trade-history&search=BTC%25",
    fetchImpl
  );
  const invalidSort = await requestApi(
    "/api/dashboard-data?view=trade-history&sort=created_at.desc",
    fetchImpl
  );
  const unknownView = await requestApi("/api/dashboard-data?view=other", fetchImpl);

  assert.equal(invalidSearch.statusCode, 400);
  assert.equal(invalidSort.statusCode, 400);
  assert.equal(unknownView.statusCode, 400);
  assert.equal(calls, 0);
});

test("trade history query construction preserves search, filter, sort, and page state", () => {
  const url = new URL(history.buildTradeHistoryUrl({
    page: 3,
    search: "btc",
    side: "sell",
    period: "30d",
    sort: "pnl-low"
  }), "https://cryptopulse.local");

  assert.equal(url.pathname, "/api/dashboard-data");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    view: "trade-history",
    page: "3",
    side: "sell",
    period: "30d",
    sort: "pnl-low",
    search: "btc"
  });
});

test("trade history renders all required fields as text and treats buys as unrealized", () => {
  const values = [
    "winningTrades",
    "losingTrades",
    "averageProfit",
    "averageLoss",
    "bestTrade",
    "worstTrade",
    "totalCount",
    "pageNumber"
  ];
  const elements = new Map(values.map((value) => [
    `[data-history-value="${value}"]`,
    { textContent: "", hidden: false, disabled: false, dataset: {} }
  ]));
  const rows = {
    children: [],
    replaceChildren() {
      this.children = [];
    },
    append(row) {
      this.children.push(row);
    }
  };
  const table = { hidden: true };
  const empty = { hidden: true };
  const previous = { disabled: false };
  const next = { disabled: false };
  const documentRef = {
    querySelector(selector) {
      return elements.get(selector) || ({
        "[data-history-table]": table,
        "[data-history-rows]": rows,
        "[data-history-empty]": empty,
        "[data-history-previous]": previous,
        "[data-history-next]": next
      })[selector] || null;
    },
    createElement() {
      return {
        textContent: "",
        dataset: {},
        children: [],
        append(...children) {
          this.children.push(...children);
          this.textContent += children.map((child) => (
            typeof child === "string" ? child : child && child.textContent || ""
          )).join("");
        }
      };
    }
  };

  history.renderTradeHistory({
    page: 2,
    pageSize: 25,
    totalCount: 26,
    totalPages: 2,
    items: [
      createTradeRow({
        symbol: "<img src=x>",
        side: "BUY",
        price: "1000",
        quantity: "1",
        fees: "2.5",
        realized_pnl: "0",
        openPosition: {
          amount: "1",
          entry_price: "1000",
          current_market_price: "1100"
        }
      }),
      createTradeRow({
        id: "trade-2",
        price: "1124",
        quantity: "1",
        fees: "2.81",
        realized_pnl: "118.69"
      }),
      createTradeRow({ id: "trade-3", price: "0.98123456" }),
      createTradeRow({ id: "trade-4", price: "12.3456" }),
      createTradeRow({ id: "trade-5", price: "69421.22", realized_pnl: "-10" })
    ],
    stats: {
      closedTrades: 1,
      winningTrades: 1,
      losingTrades: 1,
      averageProfit: 10,
      averageLoss: -4,
      bestTrade: 10,
      worstTrade: -10
    }
  }, documentRef);

  assert.equal(table.hidden, false);
  assert.equal(empty.hidden, true);
  assert.equal(rows.children.length, 5);
  assert.match(rows.children[0].children[0].textContent, /12:00/);
  assert.equal(rows.children[0].children[1].textContent, "<img src=x>");
  assert.equal(rows.children[0].children[1].children[0].className, "market-symbol");
  assert.equal(rows.children[0].children[2].children[0].className, "trade-action-buy");
  assert.equal(rows.children[1].children[2].children[0].className, "trade-action-sell");
  assert.match(rows.children[0].children[3].textContent, /1,000\.00$/);
  assert.match(rows.children[1].children[3].textContent, /1,124\.00$/);
  assert.match(rows.children[2].children[3].textContent, /0\.98123$/);
  assert.match(rows.children[3].children[3].textContent, /12\.35$/);
  assert.match(rows.children[4].children[3].textContent, /69,421\.22$/);
  assert.equal(rows.children[0].dataset.tradeSide, "buy");
  assert.equal(rows.children[1].dataset.tradeSide, "sell");
  assert.equal(rows.children[1].children[7].dataset.valueTone, "positive");
  assert.equal(rows.children[4].children[7].dataset.valueTone, "negative");
  assert.equal(elements.get('[data-history-value="worstTrade"]').dataset.valueTone, "negative");
  assert.deepEqual(
    rows.children[0].children[5].children[0].children.map((line) => line.textContent),
    [
      "Invested Amount: €1,000.00",
      "Fees: €2.50",
      "Total Cost: €1,002.50"
    ]
  );
  assert.deepEqual(
    rows.children[1].children[5].children[0].children.map((line) => line.textContent),
    [
      "Gross Proceeds: €1,124.00",
      "Fees: €2.81",
      "Net Proceeds: €1,121.19",
      "Realized P&L: +€118.69"
    ]
  );
  assert.equal(rows.children[0].children[9].textContent, "OPEN");
  assert.equal(rows.children[0].children[7].textContent, "+€100.00 (+10.00%)");
  assert.deepEqual(
    rows.children[0].children[8].children[0].children.map((line) => line.textContent),
    [
      "Entry Price: €1,000.00",
      "Current Price: €1,100.00",
      "Unrealized P&L: +€100.00 (+10.00%)"
    ]
  );
  assert.equal(rows.children[1].children[9].textContent, "CLOSED · Paper Trade");
  assert.equal(rows.children[1].children[7].textContent, "+€118.69 (+11.84%)");
  assert.deepEqual(
    rows.children[1].children[8].children[0].children.map((line) => line.textContent),
    [
      "Entry Price: €1,002.50",
      "Exit Price: €1,124.00",
      "Realized P&L: +€118.69 (+11.84%)"
    ]
  );
  assert.equal(previous.disabled, false);
  assert.equal(next.disabled, true);
  assert.equal(elements.get('[data-history-value="pageNumber"]').textContent, "2 / 2");
});

test("dashboard links its recent trades to the complete history", () => {
  const dashboardHtml = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  assert.match(dashboardHtml, /href="\/history\.html"[^>]*>View history<\/a>/);
});
