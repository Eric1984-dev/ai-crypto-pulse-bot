const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const analytics = require("../js/analytics.js");

function createNode() {
  return {
    textContent: "",
    hidden: false,
    children: [],
    append(child) {
      this.children.push(child);
    },
    addEventListener(name, callback) {
      this.listeners ||= {};
      this.listeners[name] = callback;
    },
    removeEventListener(name) {
      delete this.listeners?.[name];
    },
    async trigger(name) {
      return this.listeners?.[name]?.({ preventDefault() {} });
    },
    replaceChildren(...children) {
      this.children = children;
    },
    getContext() {
      return null;
    }
  };
}

function createDocument() {
  const nodes = new Map();
  return {
    nodes,
    querySelector(selector) {
      if (!nodes.has(selector)) {
        nodes.set(selector, createNode());
      }
      return nodes.get(selector);
    },
    createElement() {
      return createNode();
    }
  };
}

function buildAnalyticsData() {
  return {
    generatedAt: "2026-03-20T12:00:00.000Z",
    period: "30d",
    tradePerformance: {
      winRate: 75,
      lossRate: 25,
      averageWin: 30,
      averageLoss: -10,
      profitFactor: 3,
      realizedPnl: 50,
      unrealizedPnl: -5,
      totalPnl: 45,
      bestTrade: { symbol: "BTC-EUR", realizedPnl: 40 },
      worstTrade: { symbol: "ETH-EUR", realizedPnl: -10 },
      largestWinner: { symbol: "BTC-EUR", realizedPnl: 40 },
      largestLoser: { symbol: "ETH-EUR", realizedPnl: -10 },
      averageHoldTimeSeconds: 3660,
      openPositions: 1,
      closedPositions: 4,
      closedTrades: 4,
      bestSymbols: [{
        symbol: "BTC-EUR",
        closedTrades: 2,
        winRate: 100,
        realizedPnl: 60
      }],
      worstSymbols: [{
        symbol: "ETH-EUR",
        closedTrades: 2,
        winRate: 50,
        realizedPnl: -10
      }]
    },
    aiPerformance: {
      decisionCount: 6,
      below70Count: 1,
      confidenceBuckets: [{
        label: "70–75",
        decisionCount: 2,
        scoredCount: 1,
        winRate: 100,
        averagePnl: 12,
        netPnl: 12
      }],
      bestConfidenceRange: { label: "70–75", winRate: 100 },
      worstConfidenceRange: { label: "80–85", winRate: 0 },
      actions: {
        BUY: { decisionCount: 2, scoredCount: 1, unscoredCount: 1, winRate: 100, netPnl: 12 },
        SELL: { decisionCount: 1, scoredCount: 1, unscoredCount: 0, winRate: 0, netPnl: -2 },
        HOLD: { decisionCount: 2, scoredCount: 1, unscoredCount: 1, winRate: 100, netPnl: 5 },
        WAIT: { decisionCount: 1, scoredCount: 0, unscoredCount: 1, winRate: null, netPnl: 0 }
      },
      strategies: [{
        label: "Momentum · 1.0",
        decisionCount: 3,
        scoredCount: 2,
        winRate: 50,
        netPnl: 10
      }]
    },
    portfolio: {
      growthPercent: 4.5,
      equityCurve: [{ period: "2026-03-20", portfolioValue: 1045, growthPercent: 4.5 }],
      drawdownHistory: [{ period: "2026-03-20", drawdownPercent: 2 }],
      dailyPerformance: [{ period: "2026-03-20", pnl: 10, portfolioValue: 1045 }],
      weeklyPerformance: [],
      monthlyPerformance: []
    },
    dataQuality: {}
  };
}

test("analytics API request uses the existing authenticated dashboard-data view", async () => {
  let request;
  const data = buildAnalyticsData();
  const result = await analytics.requestAnalytics(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, async json() { return { data }; } };
  });

  assert.equal(request.url, "/api/dashboard-data?view=analytics&period=30d");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.cache, "no-store");
  assert.equal(result, data);
});

test("analytics page renders EUR metrics, outcome tables, portfolio periods, and empty states", () => {
  const documentRef = createDocument();
  analytics.renderAnalytics(buildAnalyticsData(), documentRef, null);

  assert.equal(documentRef.querySelector('[data-analytics-value="winRate"]').textContent, "75%");
  assert.equal(documentRef.querySelector('[data-analytics-value="averageLoss"]').textContent, "-€10.00");
  assert.equal(documentRef.querySelector('[data-analytics-value="averageHoldTime"]').textContent, "1h 1m");
  assert.equal(documentRef.querySelector("[data-analytics-confidence]").children.length, 1);
  assert.equal(documentRef.querySelector("[data-analytics-actions]").children.length, 3);
  assert.equal(documentRef.querySelector("[data-analytics-strategies]").children.length, 1);
  assert.equal(documentRef.querySelector('[data-analytics-period="daily"]').children.length, 1);
  assert.equal(documentRef.querySelector('[data-analytics-period-empty="weekly"]').hidden, false);
  assert.equal(documentRef.querySelector('[data-analytics-chart-empty="equity"]').hidden, false);
  assert.match(documentRef.querySelector("[data-analytics-updated]").textContent, /Last 30 days/);
});

test("analytics range changes request only the selected supported period", async () => {
  const documentRef = createDocument();
  const range = documentRef.querySelector("[data-analytics-range]");
  range.value = "30d";
  const requests = [];
  const windowRef = {
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: buildAnalyticsData() };
        }
      };
    },
    addEventListener() {},
    removeEventListener() {},
    location: { assign() {} }
  };
  const cleanup = analytics.startAnalytics({ windowRef, documentRef });
  await new Promise((resolve) => setImmediate(resolve));
  range.value = "90d";
  await range.trigger("change");
  await new Promise((resolve) => setImmediate(resolve));
  cleanup();

  assert.deepEqual(requests, [
    "/api/dashboard-data?view=analytics&period=30d",
    "/api/dashboard-data?view=analytics&period=90d"
  ]);
});

test("analytics tables have accessible captions and scoped column headers", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "analytics.html"), "utf8");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)];

  assert.equal(tables.length, 7);
  for (const [table] of tables) {
    assert.match(table, /<caption class="visually-hidden">[^<]+<\/caption>/);
    const headers = [...table.matchAll(/<th\b[^>]*>/g)];
    assert.ok(headers.length > 0);
    assert.ok(headers.every(([header]) => /\bscope="col"/.test(header)));
  }
});
