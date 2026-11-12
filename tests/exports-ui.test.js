const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
require("./helpers/runtime-api.js");
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

function createMemoryDirectory() {
  const files = new Map();
  const directories = new Map();
  const directoryHandle = {
    async getDirectoryHandle(name) {
      if (!directories.has(name)) {
        directories.set(name, createDirectory());
      }
      return directories.get(name);
    }
  };
  function createDirectory() {
    return {
      async getFileHandle(name) {
        return {
          async createWritable() {
            files.set(name, "");
            return {
              async write(chunk) {
                files.set(name, files.get(name) + chunk);
              },
              async close() {}
            };
          }
        };
      }
    };
  }
  return { directoryHandle, files, directories };
}

function jsonResponse(data, status = 200, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return headers[name] || null;
      }
    },
    async json() {
      return { data };
    }
  };
}

function createExportsDocument() {
  const analysisExportControls = {
    "[data-analysis-export-start]": createControl(),
    "[data-analysis-export-cancel]": createControl(),
    "[data-analysis-export-progress]": createControl(),
    "[data-analysis-export-status]": createControl()
  };
  return {
    analysisExportControls,
    querySelector(selector) {
      if (selector === "[data-exports-page]") {
        return {};
      }
      return analysisExportControls[selector] || null;
    },
  };
}

test("full-history export paginates sequentially, retries rate limits, and splits bounded JSONL files", async () => {
  const { directoryHandle, files } = createMemoryDirectory();
  const asOf = "2026-11-12T20:00:00.000Z";
  const sources = [
    "trades",
    "positions",
    "decisions",
    "portfolioSnapshots",
    "shadowExitScenarios",
    "shadowExitEvents",
    "analyticsRuns",
    "candleWindows"
  ];
  const requests = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let rateLimitSent = false;
  const anchors = ["2026-11-12T10:00:00.000Z", "2026-11-12T11:00:00.000Z",
    "2026-11-12T12:00:00.000Z"].map((anchorAt) => ({ symbol: "BTC-EUR", anchorAt }));
  const fetchImpl = async (url) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    requests.push(url);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const params = new URL(url, "https://cryptopulse.local").searchParams;
      if (params.get("view") === "analysis-export-manifest") {
        return jsonResponse({
          formatVersion: "cryptopulse-analysis-export-v1",
          asOf,
          sources,
          limits: { maxFileBytes: 1024 }
        });
      }
      const source = params.get("source");
      const cursor = params.get("cursor");
      if (source === "trades" && !cursor && !rateLimitSent) {
        rateLimitSent = true;
        return {
          status: 429,
          ok: false,
          headers: { get: () => "0" }
        };
      }
      if (source === "trades") {
        return jsonResponse({
          source,
          asOf,
          items: [{ id: cursor ? "2" : "1", detail: "x".repeat(700) }],
          hasMore: !cursor,
          nextCursor: cursor ? null : "page-2"
        });
      }
      if (source === "candleWindows") {
        const pageAnchors = cursor ? anchors.slice(1) : anchors.slice(0, 2);
        return jsonResponse({
          source,
          asOf,
          items: [],
          anchors: pageAnchors,
          candleWindows: pageAnchors.map((anchor) => ({
            ...anchor,
            interval: "1m",
            timestamp: anchor.anchorAt,
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 5
          })),
          hasMore: !cursor,
          nextCursor: cursor ? null : "candle-page-2"
        });
      }
      return jsonResponse({
        source,
        asOf,
        items: [],
        hasMore: false,
        nextCursor: null
      });
    } finally {
      activeRequests -= 1;
    }
  };

  const result = await exportsPage.exportFullHistory({
    fetchImpl,
    directoryHandle,
    runId: "test-run"
  });
  assert.equal(result.manifest.exportStatus, "complete");
  assert.equal(result.manifest.sourceCounts.trades.records, 2);
  assert.equal(result.manifest.sourceCounts.candleWindows.records, 6);
  assert.equal(maximumActiveRequests, 1);
  assert.ok(requests.some((url) => url.includes("view=analysis-export-page")));
  const runFiles = files;
  const manifest = JSON.parse(runFiles.get("manifest.json"));
  assert.equal(manifest.exportStatus, "complete");
  const tradeFiles = [...runFiles.entries()].filter(([name]) => name.startsWith("trades-"));
  assert.equal(tradeFiles.length, 2);
  assert.ok(tradeFiles.every(([, contents]) => new TextEncoder().encode(contents).byteLength <= 1024));
  const anchorFile = runFiles.get("candle-anchors-0001.jsonl");
  const candleFile = runFiles.get("candle-windows-0001.jsonl");
  assert.equal(anchorFile.trim().split("\n").length, 3);
  assert.equal(candleFile.trim().split("\n").length, 3);
});

test("full-history export leaves a cancelled status in the manifest", async () => {
  const { directoryHandle, files } = createMemoryDirectory();
  const controller = new AbortController();
  const asOf = "2026-11-12T20:00:00.000Z";
  let started;
  const requestStarted = new Promise((resolve) => {
    started = resolve;
  });
  const fetchImpl = async (url, options) => {
    const params = new URL(url, "https://cryptopulse.local").searchParams;
    if (params.get("view") === "analysis-export-manifest") {
      return jsonResponse({
        formatVersion: "cryptopulse-analysis-export-v1",
        asOf,
        sources: [
          "trades", "positions", "decisions", "portfolioSnapshots",
          "shadowExitScenarios", "shadowExitEvents", "analyticsRuns", "candleWindows"
        ],
        limits: { maxFileBytes: 1024 }
      });
    }
    started();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  };
  const exportPromise = exportsPage.exportFullHistory({
    fetchImpl,
    directoryHandle,
    signal: controller.signal,
    runId: "cancelled-run"
  });
  await requestStarted;
  controller.abort();
  await assert.rejects(exportPromise, { name: "AbortError" });
  assert.equal(JSON.parse(files.get("manifest.json")).exportStatus, "cancelled");
});

test("Exports page wires folder selection and displays completed export status", async () => {
  const documentRef = createExportsDocument();
  const { directoryHandle } = createMemoryDirectory();
  const asOf = "2026-11-12T20:00:00.000Z";
  const sources = [
    "trades",
    "positions",
    "decisions",
    "portfolioSnapshots",
    "shadowExitScenarios",
    "shadowExitEvents",
    "analyticsRuns",
    "candleWindows"
  ];
  let pickerCalls = 0;
  const windowRef = {
    fetch: async (url) => {
      const params = new URL(url, "https://cryptopulse.local").searchParams;
      if (params.get("view") === "analysis-export-manifest") {
        return jsonResponse({
          formatVersion: "cryptopulse-analysis-export-v1",
          asOf,
          sources,
          limits: { maxFileBytes: 1024 }
        });
      }
      return jsonResponse({
        source: params.get("source"),
        asOf,
        items: [],
        ...(params.get("source") === "candleWindows"
          ? { anchors: [], candleWindows: [] }
          : {}),
        hasMore: false,
        nextCursor: null
      });
    },
    showDirectoryPicker: async () => {
      pickerCalls += 1;
      return directoryHandle;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  const cleanup = exportsPage.startExports({ windowRef, documentRef });
  await documentRef.analysisExportControls["[data-analysis-export-start]"].trigger("click");
  assert.equal(pickerCalls, 1);
  assert.equal(
    documentRef.analysisExportControls["[data-analysis-export-status]"].dataset.state,
    "success"
  );
  assert.match(
    documentRef.analysisExportControls["[data-analysis-export-progress]"].textContent,
    /8 sources exported/i
  );
  cleanup();
});

test("Exports page shows only the primary complete-history export", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "exports.html"), "utf8");
  const script = fs.readFileSync(path.join(rootDirectory, "js", "exports.js"), "utf8");

  assert.match(html, /<html lang="en"/);
  assert.match(html, /data-auth-page="protected"/);
  assert.match(html, /href="\/exports\.html">Exports<\/a>/);
  assert.match(html, /Complete Historical Export/);
  assert.match(html, /data-analysis-export-start/);
  assert.match(html, /data-analysis-export-cancel/);
  assert.doesNotMatch(html, /data-export-card|Download CSV|Data Exports|Recommendation History/);
  assert.doesNotMatch(script, /data-export-card|buildExportUrl|requestExportCount/);
  assert.match(script, /\/api\/v1\/dashboard-data/);
  assert.match(script, /Retry-After/);
  assert.match(script, /showDirectoryPicker/);
});
