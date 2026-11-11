const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
require("./helpers/runtime-api.js");
const recommendations = require("../js/recommendations.js");

const rootDirectory = path.resolve(__dirname, "..");

function createNode() {
  return {
    textContent: "",
    hidden: false,
    children: [],
    listeners: {},
    append(child) {
      this.children.push(child);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    removeEventListener(name) {
      delete this.listeners[name];
    },
    async trigger(name) {
      return this.listeners[name]?.({ preventDefault() {} });
    }
  };
}

function createDocument() {
  const nodes = new Map();
  const documentRef = {
    nodes,
    visibilityState: "visible",
    querySelector(selector) {
      if (!nodes.has(selector)) {
        nodes.set(selector, createNode());
      }
      return nodes.get(selector);
    },
    createElement() {
      return createNode();
    },
    addEventListener() {},
    removeEventListener() {}
  };
  for (const category of [
    "AI Performance",
    "Market Selection",
    "Portfolio Management",
    "Risk Management",
    "Strategy Quality"
  ]) {
    documentRef.querySelector(`[data-recommendation-category="${category}"]`);
    documentRef.querySelector(`[data-recommendation-empty="${category}"]`);
  }
  return documentRef;
}

function recommendationData(period = "30d", recommendations = []) {
  const names = [
    "AI Performance",
    "Market Selection",
    "Portfolio Management",
    "Risk Management",
    "Strategy Quality"
  ];
  return {
    generatedAt: "2026-03-21T12:00:00.000Z",
    analysisPeriod: period,
    insufficientData: false,
    recommendations,
    categories: names.map((name) => ({
      name,
      recommendations: recommendations.filter((item) => item.category === name)
    }))
  };
}

test("recommendation request uses the authenticated existing dashboard-data view", async () => {
  let request;
  const result = await recommendations.requestRecommendations(async (url, options) => {
    request = { url, options };
    return {
      status: 200,
      ok: true,
      async json() {
        return { data: recommendationData("90d") };
      }
    };
  }, "90d");

  assert.equal(request.url, "/api/v1/dashboard-data?view=recommendations&period=90d");
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.cache, "no-store");
  assert.equal(result.analysisPeriod, "90d");
});

test("recommendation rendering uses safe text and displays EUR, confidence, sample, and period details", () => {
  const documentRef = createDocument();
  const data = recommendationData("30d", [{
    category: "Strategy Quality",
    title: "<img src=x onerror=alert(1)>",
    reason: "Historical results require review.",
    metrics: [{ label: "Net P&L", value: -25.5, format: "currency" }],
    estimatedImpact: "No numeric forecast.",
    confidenceLevel: "Preliminary",
    sampleSize: 12,
    sampleUnit: "scored decision outcomes",
    analysisPeriod: "30d",
    generatedAt: "2026-03-21T12:00:00.000Z"
  }]);

  recommendations.renderRecommendations(data, documentRef);
  const card = documentRef.querySelector('[data-recommendation-category="Strategy Quality"]').children[0];

  assert.equal(card.children[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(card.children[2].children[0].children[1].textContent, "-€25.50");
  assert.equal(card.children[2].children.length, 6);
  assert.match(documentRef.querySelector("[data-recommendations-updated]").textContent, /Last 30 days/);
});

test("insufficient data state is explicit and recommendation categories retain empty states", () => {
  const documentRef = createDocument();
  recommendations.renderRecommendations({
    ...recommendationData(),
    insufficientData: true
  }, documentRef);

  const notice = documentRef.querySelector("[data-recommendations-insufficient]");
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, "Insufficient historical data. At least 10 closed trades are required for preliminary recommendations.");
  assert.equal(documentRef.querySelector('[data-recommendation-empty="AI Performance"]').hidden, false);
});

test("selected range refreshes and realtime updates reload recommendations", async () => {
  const documentRef = createDocument();
  const range = documentRef.querySelector("[data-recommendations-range]");
  range.value = "30d";
  const requests = [];
  let realtimeOptions;
  let nextTimerId = 0;
  const windowRef = {
    fetch: async (url) => {
      requests.push(url);
      const period = new URL(url, "https://cryptopulse.local").searchParams.get("period");
      return { status: 200, ok: true, async json() { return { data: recommendationData(period) }; } };
    },
    setInterval(callback, delay) {
      this.timer = { callback, delay, id: ++nextTimerId };
      return this.timer.id;
    },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    location: { assign() {} },
    CryptoPulseRealtime: {
      startPageRealtime(options) {
        realtimeOptions = options;
        return () => {};
      }
    }
  };

  const cleanup = recommendations.startRecommendations({ windowRef, documentRef });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(windowRef.timer.delay, 30_000);
  assert.equal(realtimeOptions.surface, "recommendations");

  range.value = "90d";
  await range.trigger("change");
  await new Promise((resolve) => setImmediate(resolve));
  await realtimeOptions.onUpdate();
  await new Promise((resolve) => setImmediate(resolve));
  cleanup();

  assert.deepEqual(requests.map((url) => new URL(url, "https://cryptopulse.local").searchParams.get("period")), [
    "30d",
    "90d",
    "90d"
  ]);
});

test("page is a protected, English, advisory-only recommendations surface", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "recommendations.html"), "utf8");
  assert.match(html, /data-recommendations-page/);
  assert.match(html, /Last 30 Days[\s\S]*Last 90 Days[\s\S]*Last 365 Days/);
  assert.match(html, /never change strategies, risk settings, markets, portfolios, or trades/i);
  assert.match(html, /\/js\/realtime\.js/);
  assert.match(html, /\/js\/recommendations\.js/);
  assert.doesNotMatch(html, /<button[^>]*>[^<]*(?:Apply|Execute|Optimize)[^<]*<\/button>/i);
});
