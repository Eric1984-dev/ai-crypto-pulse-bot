"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
require("./helpers/runtime-api.js");
const history = require("../js/history.js");
const rootDirectory = path.resolve(__dirname, "..");

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

test("trade history query construction preserves search, filter, sort, and page state", () => {
  const url = new URL(history.buildTradeHistoryUrl({
    page: 3,
    search: "btc",
    side: "sell",
    period: "30d",
    sort: "pnl-low"
  }), "https://cryptopulse.local");

  assert.equal(url.pathname, "/api/v1/dashboard-data");
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
  assert.equal(rows.children[0].children[5].children[0].children[1].dataset.valueTone, "warning");
  assert.equal(rows.children[0].children[6].dataset.valueTone, "warning");
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
