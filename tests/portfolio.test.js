"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const portfolio = require("../js/portfolio.js");

function createElement() {
  return {
    textContent: "",
    hidden: false,
    children: [],
    replaceChildren() {
      this.children = [];
    },
    append(...children) {
      this.children.push(...children);
    }
  };
}

function createDocument() {
  const selectors = [
    "[data-portfolio-value=\"count\"]",
    "[data-portfolio-value=\"portfolioValue\"]",
    "[data-portfolio-value=\"availableBalance\"]",
    "[data-portfolio-value=\"totalPnl\"]",
    "[data-portfolio-value=\"realizedPnl\"]",
    "[data-portfolio-value=\"unrealizedPnl\"]",
    "[data-portfolio-value=\"dailyPnl\"]",
    "[data-portfolio-value=\"winRate\"]",
    "[data-portfolio-value=\"openPositions\"]",
    "[data-portfolio-value=\"paperTrades\"]",
    "[data-portfolio-list=\"positions\"]",
    "[data-portfolio-empty=\"positions\"]",
    "[data-portfolio-list=\"trades\"]",
    "[data-portfolio-empty=\"trades\"]"
  ];
  const elements = new Map(selectors.map((selector) => [selector, createElement()]));
  return {
    elements,
    documentRef: {
      querySelector(selector) {
        return elements.get(selector) || null;
      },
      createElement
    }
  };
}

test("portfolio renders real P&L, balances, positions, and trades as text", () => {
  const { documentRef, elements } = createDocument();
  portfolio.renderPortfolio({
    portfolio: {
      count: 1,
      portfolioValue: 10100,
      availableBalance: 9000,
      totalPnl: 100,
      realizedPnl: 50,
      unrealizedPnl: 50,
      dailyPnl: 25,
      winRate: 60
    },
    openPositions: {
      count: 1,
      items: [{
        symbol: "<img src=x>",
        amount: 0.01,
        entry_price: 0.00453954,
        current_price: 0.05671234,
        unrealized_pnl: 0.05,
        created_at: "2026-03-20T10:00:00.000Z"
      }]
    },
    recentTrades: {
      count: 1,
      items: [{
        side: "SELL",
        symbol: "BTC-EUR",
        quantity: 0.01,
        price: 0.98123456,
        fees: 0.25,
        realized_pnl: 4.5,
        created_at: "2026-03-20T11:00:00.000Z"
      }]
    }
  }, documentRef);

  assert.match(elements.get("[data-portfolio-value=\"portfolioValue\"]").textContent, /10\.100/);
  assert.match(elements.get("[data-portfolio-value=\"realizedPnl\"]").textContent, /50,00/);
  assert.equal(elements.get("[data-portfolio-value=\"openPositions\"]").textContent, "1");
  assert.equal(elements.get("[data-portfolio-list=\"positions\"]").children[0].children[0].textContent, "<img src=x> · 0,01 units");
  assert.match(
    elements.get("[data-portfolio-list=\"positions\"]").children[0].children[1].textContent,
    /Entry €\s?0,00454 · Current €\s?0,05671 · P&L €\s?0,05 · Opened .*11:00/
  );
  assert.match(
    elements.get("[data-portfolio-list=\"trades\"]").children[0].children[1].textContent,
    /€\s?0,98123 · Fee €\s?0,25 · P&L €\s?4,50 · Executed .*12:00/
  );
  assert.equal(elements.get("[data-portfolio-list=\"positions\"]").hidden, false);
  assert.equal(elements.get("[data-portfolio-empty=\"trades\"]").hidden, true);
});

test("portfolio data request uses the authenticated no-store dashboard API and validates its response", async () => {
  let request;
  const data = { portfolio: {}, openPositions: {}, recentTrades: {} };
  const result = await portfolio.requestPortfolioData(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ data }) };
  });
  assert.equal(request.url, "/api/dashboard-data");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(result, data);

  await assert.rejects(
    portfolio.requestPortfolioData(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    /response is invalid/
  );
  await assert.rejects(
    portfolio.requestPortfolioData(async () => ({ ok: false, status: 401 })),
    (error) => error.status === 401
  );
});
