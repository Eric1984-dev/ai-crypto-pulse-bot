const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const exportsPage = require("../js/exports.js");

const rootDirectory = path.resolve(__dirname, "..");

function createControl(value = "") {
  return {
    value,
    textContent: "",
    hidden: false,
    disabled: false,
    dataset: {},
    listeners: {},
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

function createExportCard(type) {
  const nodes = {
    "[data-export-period]": createControl("24h"),
    "[data-export-count]": createControl(),
    "[data-export-empty]": createControl(),
    "[data-export-download]": createControl(),
    "[data-export-status]": createControl()
  };
  return {
    dataset: { exportCard: type },
    querySelector(selector) {
      return nodes[selector] || null;
    },
    nodes
  };
}

function createAnalyticsExportCard(type) {
  const nodes = {
    "[data-export-period]": createControl("30d"),
    "[data-export-count]": createControl(),
    "[data-export-empty]": createControl(),
    "[data-export-download]": createControl(),
    "[data-export-status]": createControl()
  };
  return {
    dataset: { exportCard: type },
    querySelector(selector) {
      return nodes[selector] || null;
    },
    nodes
  };
}

function createExportsDocument(cards) {
  const appended = [];
  const cardList = Array.isArray(cards) ? cards : [cards];
  return {
    body: {
      append(element) {
        appended.push(element);
      }
    },
    appended,
    querySelector(selector) {
      if (selector === "[data-exports-page]") {
        return {};
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-export-card]" ? cardList : [];
    },
    createElement(tagName) {
      return {
        tagName,
        click() {
          this.clicked = true;
        },
        remove() {
          this.removed = true;
        }
      };
    }
  };
}

test("export UI builds same-origin count and stream URLs", () => {
  const countUrl = new URL(exportsPage.buildExportUrl("trades", "7d"), "https://cryptopulse.local");
  assert.equal(countUrl.pathname, "/api/dashboard-data");
  assert.equal(countUrl.searchParams.get("view"), "export-count");
  assert.equal(countUrl.searchParams.get("type"), "trades");
  assert.equal(countUrl.searchParams.get("period"), "7d");

  const downloadUrl = new URL(exportsPage.buildExportUrl("positions", "all", "export"), "https://cryptopulse.local");
  assert.equal(downloadUrl.searchParams.get("view"), "export");
  assert.equal(downloadUrl.searchParams.get("type"), "positions");
  assert.throws(() => exportsPage.buildExportUrl("trades", "invalid"), TypeError);
});

test("export page displays counts, empty states, download status, and failures", async () => {
  const card = createExportCard("trades");
  const documentRef = createExportsDocument(card);
  const requests = [];
  const windowRef = {
    fetch: async (url) => {
      requests.push(url);
      if (url.includes("period=7d")) {
        return { status: 503, ok: false };
      }
      return {
        status: 200,
        ok: true,
        async json() {
          return { data: { exportType: "trades", period: "24h", recordCount: 3 } };
        }
      };
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const cleanup = exportsPage.startExports({ windowRef, documentRef });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(card.nodes["[data-export-count]"].textContent, "3 records available");
  assert.equal(card.nodes["[data-export-download]"].disabled, false);

  await card.nodes["[data-export-download]"].trigger("click");
  assert.equal(documentRef.appended[0].clicked, true);
  assert.equal(documentRef.appended[0].href, "/api/dashboard-data?view=export&type=trades&period=24h");
  assert.match(card.nodes["[data-export-status]"].textContent, /download requested/i);
  assert.equal(card.nodes["[data-export-status]"].dataset.state, "success");

  card.nodes["[data-export-period]"].value = "7d";
  await card.nodes["[data-export-period]"].trigger("change");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(card.nodes["[data-export-download]"].disabled, true);
  assert.equal(card.nodes["[data-export-status]"].dataset.state, "error");
  assert.ok(requests.some((url) => url.includes("period=7d")));
  cleanup();
});

test("analytics export cards use independent ranges for their counts and downloads", async () => {
  const types = [
    "analytics-summary",
    "trade-analytics",
    "portfolio-analytics",
    "ai-analytics",
    "recommendations",
    "recommendation-history"
  ];
  const cards = types.map(createAnalyticsExportCard);
  const documentRef = createExportsDocument(cards);
  const requests = [];
  const windowRef = {
    fetch: async (url) => {
      requests.push(url);
      const period = new URL(url, "https://cryptopulse.local").searchParams.get("period");
      return {
        status: 200,
        ok: true,
        async json() {
          return {
            data: {
              exportCounts: Object.fromEntries(types.map((type) => [type, 3])),
              period
            }
          };
        }
      };
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const cleanup = exportsPage.startExports({ windowRef, documentRef });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.filter((url) => url === "/api/dashboard-data?view=analytics&period=30d").length, 1);
  for (const card of cards) {
    assert.equal(card.nodes["[data-export-count]"].textContent, "3 report rows available");
    assert.equal(card.nodes["[data-export-download]"].disabled, false);
  }
  await cards[0].nodes["[data-export-download]"].trigger("click");
  assert.equal(
    documentRef.appended[0].href,
    "/api/dashboard-data?view=export&type=analytics-summary&period=30d"
  );

  cards[0].nodes["[data-export-period]"].value = "90d";
  await cards[0].nodes["[data-export-period]"].trigger("change");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.filter((url) => url === "/api/dashboard-data?view=analytics&period=90d").length, 1);
  await cards[0].nodes["[data-export-download]"].trigger("click");
  assert.equal(
    documentRef.appended[1].href,
    "/api/dashboard-data?view=export&type=analytics-summary&period=90d"
  );
  assert.equal(cards[1].nodes["[data-export-period]"].value, "30d");
  await cards[1].nodes["[data-export-download]"].trigger("click");
  assert.equal(
    documentRef.appended[2].href,
    "/api/dashboard-data?view=export&type=trade-analytics&period=30d"
  );
  cleanup();
});

test("Exports page is English, protected, and links to the existing data API", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "exports.html"), "utf8");
  const script = fs.readFileSync(path.join(rootDirectory, "js", "exports.js"), "utf8");

  assert.match(html, /<html lang="en"/);
  assert.match(html, /data-auth-page="protected"/);
  assert.match(html, /href="\/exports\.html">Exports<\/a>/);
  assert.match(html, /Trade Exports/);
  assert.match(html, /Portfolio Exports/);
  assert.match(html, /AI Decision Exports/);
  assert.match(html, /Position Exports/);
  assert.doesNotMatch(html, /data-analytics-export-period/);
  for (const type of [
    "analytics-summary",
    "trade-analytics",
    "portfolio-analytics",
    "ai-analytics",
    "recommendations",
    "recommendation-history"
  ]) {
    const card = html.match(new RegExp(`data-export-card="${type}"[\\s\\S]*?<\\/section>`));
    assert.ok(card, `${type} export card exists`);
    assert.match(card[0], /<select data-export-period>/);
    for (const period of ["30d", "90d", "365d"]) {
      assert.match(card[0], new RegExp(`value="${period}"`));
    }
  }
  for (const period of ["24h", "7d", "30d", "all"]) {
    assert.match(html, new RegExp(`value="${period}"`));
  }
  assert.match(script, /\/api\/dashboard-data/);
  assert.doesNotMatch(script, /\/api\/exports/);
});
