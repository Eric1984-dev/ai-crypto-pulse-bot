"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const portfolio = require("../js/portfolio.js");

function createElement() {
  return {
    textContent: "",
    hidden: false,
    dataset: {},
    children: [],
    replaceChildren() {
      this.children = [];
      this.textContent = "";
    },
    append(...children) {
      this.children.push(...children);
      this.textContent += children.map((child) => (
        typeof child === "string" ? child : child && child.textContent || ""
      )).join("");
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
      count: 2,
      items: [
        {
          symbol: "<img src=x>",
          amount: 0.01,
          entry_price: 0.00453954,
          current_price: 0.05671234,
          unrealized_pnl: 0.05,
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
    recentTrades: {
      count: 1,
      items: [{
        side: "SELL",
        symbol: "BTC-EUR",
        quantity: 1,
        price: 1124,
        fees: 2.81,
        realized_pnl: 118.69,
        created_at: "2026-03-20T11:00:00.000Z"
      }]
    }
  }, documentRef);

  assert.match(elements.get("[data-portfolio-value=\"portfolioValue\"]").textContent, /10,100/);
  assert.match(elements.get("[data-portfolio-value=\"realizedPnl\"]").textContent, /50\.00/);
  assert.equal(elements.get("[data-portfolio-value=\"openPositions\"]").textContent, "2");
  assert.equal(elements.get("[data-portfolio-list=\"positions\"]").children[0].children[0].textContent, "<img src=x> · 0.01 units");
  assert.equal(
    elements.get("[data-portfolio-list=\"positions\"]").children[0].children[0].children[1].className,
    "market-symbol"
  );
  assert.match(
    elements.get("[data-portfolio-list=\"positions\"]").children[0].children[1].textContent,
    /Entry €\s?0\.00454 · Current €\s?0\.05671 · P&L €\s?0\.05 · Opened .*11:00/
  );
  assert.ok(elements.get("[data-portfolio-list=\"positions\"]").children[0].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "positive"
      && child.textContent === "P&L €0.05"
  )));
  assert.ok(elements.get("[data-portfolio-list=\"positions\"]").children[1].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "negative"
      && child.textContent === "P&L -€125.78"
  )));
  assert.match(
    elements.get("[data-portfolio-list=\"trades\"]").children[0].children[1].textContent,
    /Price €1,124\.00 · Gross Proceeds: €1,124\.00 · Fees: €2\.81 · Net Proceeds: €1,121\.19 · Realized P&L: \+€118\.69 · Executed .*12:00/
  );
  assert.ok(elements.get("[data-portfolio-list=\"trades\"]").children[0].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "warning"
      && child.textContent === "Fees: €2.81"
  )));
  assert.equal(
    elements.get("[data-portfolio-list=\"trades\"]").children[0].children[0].children[1].className,
    "trade-action-sell"
  );
  assert.equal(
    elements.get("[data-portfolio-list=\"trades\"]").children[0].children[0].children[3].className,
    "market-symbol"
  );
  assert.equal(elements.get("[data-portfolio-list=\"positions\"]").hidden, false);
  assert.equal(elements.get("[data-portfolio-empty=\"trades\"]").hidden, true);
});

test("portfolio uses a negative tone for negative P&L values", () => {
  const { documentRef, elements } = createDocument();
  portfolio.renderPortfolio({
    portfolio: {
      count: 1,
      portfolioValue: 950,
      availableBalance: 900,
      totalPnl: -50,
      realizedPnl: -25,
      unrealizedPnl: -25,
      dailyPnl: -10,
      winRate: 40
    },
    openPositions: { count: 0, items: [] },
    recentTrades: { count: 0, items: [] }
  }, documentRef);

  for (const name of ["totalPnl", "realizedPnl", "unrealizedPnl", "dailyPnl"]) {
    assert.equal(elements.get(`[data-portfolio-value="${name}"]`).dataset.valueTone, "negative");
  }
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

test("portfolio reruns refreshes queued during an active request", async () => {
  const { documentRef, elements } = createDocument();
  documentRef.visibilityState = "visible";
  documentRef.addEventListener = () => {};
  documentRef.removeEventListener = () => {};
  const originalQuerySelector = documentRef.querySelector;
  documentRef.querySelector = (selector) => (
    selector === "[data-portfolio-page]" ? createElement() : originalQuerySelector(selector)
  );

  const data = {
    portfolio: {
      count: 0,
      portfolioValue: 0,
      availableBalance: 0,
      totalPnl: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      dailyPnl: 0,
      winRate: 0
    },
    openPositions: { count: 0, items: [] },
    recentTrades: { count: 0, items: [] }
  };
  let requestCount = 0;
  let resolveInitialRequest;
  let realtimeUpdate;
  const windowRef = {
    addEventListener() {},
    removeEventListener() {},
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseRealtime: {
      startAlignedPolling() {
        return () => {};
      },
      startPageRealtime({ onUpdate }) {
        realtimeUpdate = onUpdate;
        return () => {};
      }
    }
  };
  const fetchImpl = () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Promise((resolve) => {
        resolveInitialRequest = () => resolve({
          ok: true,
          status: 200,
          json: async () => ({ data })
        });
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ data })
    });
  };

  const cleanup = portfolio.startPortfolio({ windowRef, documentRef, fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof realtimeUpdate, "function");
  realtimeUpdate();
  resolveInitialRequest();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requestCount, 2);
  assert.equal(elements.get("[data-portfolio-value=\"count\"]").textContent, "0");
  cleanup();
});
