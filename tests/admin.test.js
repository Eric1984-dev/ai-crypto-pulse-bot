"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const admin = require("../js/admin.js");

const rootDirectory = path.resolve(__dirname, "..");

function createElement(dataset = {}) {
  const listeners = new Map();
  return {
    dataset,
    disabled: false,
    hidden: false,
    textContent: "",
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) {
        listeners.delete(name);
      }
    },
    dispatch(name) {
      const callback = listeners.get(name);
      if (callback) {
        callback();
      }
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

function createAdminPage() {
  const adminNavLinks = [createElement(), createElement()];
  for (const link of adminNavLinks) {
    link.hidden = true;
  }
  const adminPage = createElement();
  adminPage.hidden = true;
  const accessMessage = createElement();
  const buttons = [
    createElement({ adminAction: "ai-analysis" }),
    createElement({ adminAction: "paper-trading" })
  ];
  const output = createElement();
  output.hidden = true;
  const status = createElement();
  const duration = createElement();
  const summary = createElement();
  const elements = new Map([
    ["[data-admin-page]", adminPage],
    ["[data-admin-access-message]", accessMessage],
    ["[data-admin-action-output]", output],
    ["[data-admin-action-status]", status],
    ["[data-admin-action-duration]", duration],
    ["[data-admin-action-summary]", summary]
  ]);
  const documentRef = {
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-admin-nav]") {
        return adminNavLinks;
      }
      if (selector === "[data-admin-action]") {
        return buttons;
      }
      return [];
    }
  };

  return {
    accessMessage,
    adminNavLinks,
    adminPage,
    buttons,
    documentRef,
    duration,
    output,
    status,
    summary
  };
}

function createWindowRef() {
  const listeners = new Map();
  const redirects = [];
  let time = 10;
  return {
    CryptoPulseAuthReady: Promise.resolve(),
    console: { warn() {} },
    location: {
      replace(pathname) {
        redirects.push(pathname);
      }
    },
    performance: {
      now() {
        time += 5;
        return time;
      }
    },
    redirects,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) {
        listeners.delete(name);
      }
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("admin access checks use the authenticated same-origin endpoint", async () => {
  let request;
  assert.equal(await admin.requestAdminStatus(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ data: { isAdmin: true } }) };
  }), true);
  assert.equal(request.url, "/api/admin-actions");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.credentials, "same-origin");

  assert.equal(await admin.requestAdminStatus(async () => ({ ok: false, status: 403 })), false);
  await assert.rejects(
    () => admin.requestAdminStatus(async () => ({ ok: false, status: 401 })),
    (error) => error.status === 401
  );
  await assert.rejects(
    () => admin.requestAdminStatus(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })),
    /response is invalid/
  );
});

test("admin actions validate requests and preserve the authorized session", async () => {
  const calls = [];
  const result = await admin.requestAdminAction("ai-analysis", async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { status: "ACTIVE", analyzedMarkets: 2 },
        metrics: { executionDurationMs: 42 }
      })
    };
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin-actions");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: "ai-analysis" });
  assert.deepEqual(result.data, { status: "ACTIVE", analyzedMarkets: 2 });
  assert.equal(result.metrics.executionDurationMs, 42);
  await assert.rejects(
    () => admin.requestAdminAction("live-trading", async () => {
      throw new Error("Unsupported action must not call fetch.");
    }),
    /supported admin action/
  );
});

test("Admin navigation and page stay hidden until the administrator check succeeds", async () => {
  const page = createAdminPage();
  const windowRef = createWindowRef();
  let requestCount = 0;
  const cleanup = admin.startAdminPage({
    windowRef,
    documentRef: page.documentRef,
    fetchImpl: async (url, options) => {
      requestCount += 1;
      assert.equal(url, "/api/admin-actions");
      assert.equal(options.method, "GET");
      return { ok: true, status: 200, json: async () => ({ data: { isAdmin: true } }) };
    }
  });

  assert.ok(page.adminNavLinks.every((link) => link.hidden));
  assert.equal(page.adminPage.hidden, true);
  await flushPromises();
  assert.equal(requestCount, 1);
  assert.ok(page.adminNavLinks.every((link) => !link.hidden));
  assert.equal(page.adminPage.hidden, false);
  assert.equal(page.accessMessage.hidden, true);

  cleanup();
  assert.equal(windowRef.listenerCount(), 0);
  assert.equal(page.buttons[0].listenerCount(), 0);
});

test("non-administrators cannot see Admin navigation or open the Admin page", async () => {
  const page = createAdminPage();
  const windowRef = createWindowRef();
  const cleanup = admin.startAdminPage({
    windowRef,
    documentRef: page.documentRef,
    fetchImpl: async () => ({ ok: false, status: 403 })
  });
  await flushPromises();

  assert.ok(page.adminNavLinks.every((link) => link.hidden));
  assert.equal(page.adminPage.hidden, true);
  assert.equal(page.accessMessage.textContent, "Administrator access is required.");
  assert.deepEqual(windowRef.redirects, ["/dashboard.html"]);
  cleanup();
});

test("Admin actions show progress, prevent duplicates, and report results", async () => {
  const page = createAdminPage();
  const windowRef = createWindowRef();
  let resolveFirstAction;
  let actionCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url !== "/api/admin-actions") {
      throw new Error(`Unexpected admin request: ${url}`);
    }
    if (options.method === "GET") {
      return { ok: true, status: 200, json: async () => ({ data: { isAdmin: true } }) };
    }
    actionCount += 1;
    if (actionCount === 1) {
      return new Promise((resolve) => {
        resolveFirstAction = () => resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { status: "ACTIVE", analyzedMarkets: 2, decisionsStored: 2 },
            metrics: { executionDurationMs: 84 }
          })
        });
      });
    }
    return {
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: "AI_ANALYSIS_UNAVAILABLE", message: "AI analysis failed." },
        metrics: { executionDurationMs: 17 }
      })
    };
  };
  const cleanup = admin.startAdminPage({
    windowRef,
    documentRef: page.documentRef,
    fetchImpl
  });
  await flushPromises();

  page.buttons[0].dispatch("click");
  assert.ok(page.buttons.every((button) => button.disabled));
  assert.equal(page.status.textContent, "Running…");
  page.buttons[0].dispatch("click");
  assert.equal(actionCount, 1);

  resolveFirstAction();
  await flushPromises();
  assert.equal(page.status.textContent, "Completed (ACTIVE)");
  assert.equal(page.duration.textContent, "84 ms");
  assert.match(page.summary.textContent, /"decisionsStored": 2/);
  assert.ok(page.buttons.every((button) => !button.disabled));

  page.buttons[1].dispatch("click");
  await flushPromises();
  assert.match(page.status.textContent, /^Failed:/);
  assert.equal(page.duration.textContent, "17 ms");
  assert.match(page.summary.textContent, /AI_ANALYSIS_UNAVAILABLE/);
  cleanup();
});

test("protected navigation includes Admin only as a hidden, authorized menu entry", () => {
  const pages = ["dashboard", "portfolio", "scanner", "history", "settings", "admin"];
  for (const pageName of pages) {
    const html = fs.readFileSync(path.join(rootDirectory, `${pageName}.html`), "utf8");
    assert.match(html, /data-admin-nav href="\/admin\.html" hidden>Admin<\/a>/);
    assert.match(html, /\/js\/admin\.js/);
  }
  const dashboardHtml = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  assert.doesNotMatch(dashboardHtml, /data-admin-actions|Execute AI Analysis|Execute Paper Trading/);
});
