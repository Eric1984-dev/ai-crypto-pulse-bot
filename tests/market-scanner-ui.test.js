const assert = require("node:assert/strict");
const test = require("node:test");
const scanner = require("../js/scanner.js");

const rankingNames = [
  "topGainers",
  "topLosers",
  "highestVolume",
  "strongestMomentum",
  "aiOpportunities"
];

function createSummary() {
  const timeframes = Object.fromEntries(["24h", "7d", "30d"].map((timeframe) => [
    timeframe,
    {
      topGainers: [{
        symbol: "BTC-EUR",
        changePct: timeframe === "7d" ? 7 : 2,
        price: 100,
        captured_at: "2026-03-20T12:00:00.000Z"
      }],
      topLosers: [],
      highestVolume: [{ symbol: "BTC-EUR", volumeEur: 1000, price: 100 }],
      strongestMomentum: [{ symbol: "BTC-EUR", momentumPct: 1.5, momentumLabel: "6h", price: 100 }],
      aiOpportunities: [{
        symbol: "BTC-EUR",
        decision: "BUY",
        confidence: 90,
        reason: "Momentum is positive.",
        created_at: "2026-03-20T12:00:00.000Z"
      }]
    }
  ]));
  return {
    generatedAt: "2026-03-20T12:00:00.000Z",
    activeMarkets: 1,
    marketsWithFreshData: 1,
    marketsWithDecisions: 1,
    timeframes
  };
}

function element(dataset = {}) {
  return {
    dataset,
    hidden: false,
    disabled: false,
    textContent: "",
    children: [],
    attributes: {},
    listeners: {},
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
      this.attributes[name] = value;
    }
  };
}

function createScannerDocument() {
  const selectors = new Map();
  for (const ranking of rankingNames) {
    selectors.set(`[data-scanner-list="${ranking}"]`, element());
    selectors.set(`[data-scanner-empty="${ranking}"]`, element());
  }
  selectors.set("[data-scanner-status]", element());
  selectors.set("[data-scanner-refresh]", element());
  const timeframeButtons = ["24h", "7d", "30d"].map((timeframe) =>
    element({ scannerTimeframe: timeframe })
  );
  const documentRef = {
    body: { dataset: { authPage: "protected" } },
    documentElement: { classList: { contains: () => false } },
    visibilityState: "visible",
    querySelector(selector) {
      return selectors.get(selector) || null;
    },
    querySelectorAll(selector) {
      return selector === "[data-scanner-timeframe]" ? timeframeButtons : [];
    },
    createElement() {
      return element();
    },
    addEventListener() {},
    removeEventListener() {}
  };
  return { documentRef, selectors, timeframeButtons };
}

test("scanner requests the existing summary endpoint without caching", async () => {
  let request;
  const expected = createSummary();
  const result = await scanner.requestMarketScannerSummary(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ data: { scanner: expected } }) };
  });

  assert.equal(request.url, "/api/market-summary");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(result, expected);
});

test("scanner deduplicates requests and safely renders selected timeframe rankings", async () => {
  const { documentRef, selectors, timeframeButtons } = createScannerDocument();
  const expected = createSummary();
  let requestCount = 0;
  let resolveResponse;
  const fetchImpl = () => {
    requestCount += 1;
    return new Promise((resolve) => {
      resolveResponse = () => resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { scanner: expected } })
      });
    });
  };
  const scannerPage = scanner.startMarketScanner({
    windowRef: {
      fetch: fetchImpl,
      setInterval() {
        return 1;
      },
      clearInterval() {},
      addEventListener() {},
      removeEventListener() {},
      location: { replace() {} }
    },
    documentRef,
    fetchImpl
  });

  const firstRequest = scannerPage.load();
  const duplicateRequest = scannerPage.load();
  assert.equal(requestCount, 1);
  resolveResponse();
  await Promise.all([firstRequest, duplicateRequest]);
  assert.equal(
    selectors.get('[data-scanner-list="topGainers"]').children[0].children[0].textContent,
    "BTC-EUR · 2%"
  );
  assert.equal(
    selectors.get('[data-scanner-list="topGainers"]').children[0].children[0].children[1].className,
    "market-symbol"
  );
  assert.equal(
    selectors.get('[data-scanner-list="aiOpportunities"]').children[0].children[0].children[1].className,
    "trade-action-buy"
  );
  assert.match(
    selectors.get('[data-scanner-list="topGainers"]').children[0].children[1].textContent,
    /Captured 13:00/
  );
  assert.match(
    selectors.get('[data-scanner-list="aiOpportunities"]').children[0].children[1].textContent,
    /^Recorded .*13:00 · Momentum is positive\.$/
  );
  assert.match(selectors.get("[data-scanner-status]").textContent, /Updated 13:00/);

  timeframeButtons[1].listeners.click();
  assert.equal(timeframeButtons[1].attributes["aria-pressed"], "true");
  assert.equal(timeframeButtons[0].attributes["aria-pressed"], "false");
  assert.equal(
    selectors.get('[data-scanner-list="topGainers"]').children[0].children[0].textContent,
    "BTC-EUR · 7%"
  );
  assert.equal(requestCount, 1);
  scannerPage.dispose();
});

test("scanner rejects malformed and unauthenticated responses explicitly", async () => {
  await assert.rejects(
    scanner.requestMarketScannerSummary(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { scanner: { timeframes: {} } } })
    })),
    /response is invalid/
  );
  await assert.rejects(
    scanner.requestMarketScannerSummary(async () => ({
      ok: false,
      status: 401,
      json: async () => ({})
    })),
    (error) => error.status === 401
  );
});
