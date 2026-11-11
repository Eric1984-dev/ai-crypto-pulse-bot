"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const auth = require("../js/auth-service.js");
const rootDirectory = path.resolve(__dirname, "..");

function createBrowser({
  pageType = "protected",
  href = "https://dashboard.example.com/dashboard.html",
  authApi = auth
} = {}) {
  const redirects = [];
  const listeners = new Map();
  const message = { textContent: "", dataset: {}, setAttribute() {} };
  const inputs = {
    username: { value: "operator" },
    password: { value: "unit-test-password" }
  };
  const submitButton = { disabled: false };
  const form = {
    elements: { namedItem: (name) => inputs[name] },
    addEventListener(name, callback) { listeners.set(`form:${name}`, callback); },
    querySelector() { return submitButton; }
  };
  const logoutButton = {
    disabled: false,
    addEventListener(name, callback) { listeners.set(`logout:${name}`, callback); }
  };
  const document = {
    body: {
      dataset: { authPage: pageType },
      prepend() {}
    },
    documentElement: {
      classList: {
        remove(name) { this.removed = name; }
      }
    },
    createElement() {
      return { setAttribute() {}, textContent: "", dataset: {} };
    },
    querySelector(selector) {
      if (selector === "[data-auth-message]") return message;
      if (selector === "[data-login-form]") return form;
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-auth-logout]" ? [logoutButton] : [];
    }
  };
  const location = new URL(href);
  location.replace = (value) => redirects.push(value);
  const window = { CryptoPulseAuth: authApi, location };
  vm.runInNewContext(fs.readFileSync(path.join(rootDirectory, "js/auth.js"), "utf8"), {
    document,
    window,
    URLSearchParams,
    Promise
  });
  return {
    document,
    form,
    inputs,
    listeners,
    logoutButton,
    message,
    redirects,
    submitButton,
    window
  };
}

test("safe dashboard return paths reject external and unprotected destinations", () => {
  assert.equal(auth.safeNextPath("/portfolio.html?tab=history"), "/portfolio.html?tab=history");
  assert.equal(auth.safeNextPath("//attacker.example"), "/dashboard.html");
  assert.equal(auth.safeNextPath("/login.html"), "/dashboard.html");
});

test("runtime API requests use the same-origin proxy and reject non-runtime paths", () => {
  const source = fs.readFileSync(path.join(rootDirectory, "js/runtime-api.js"), "utf8");
  const context = {};
  vm.runInNewContext(source, { globalThis: context, URL, Object });
  assert.equal(
    context.CryptoPulseRuntimeApi.url("/api/v1/dashboard-data?view=analytics"),
    "/api/dashboard-data?path=%2Fapi%2Fv1%2Fdashboard-data%3Fview%3Danalytics"
  );
  assert.throws(() => context.CryptoPulseRuntimeApi.url("/api/admin-actions"), /API path/);
  assert.throws(() => context.CryptoPulseRuntimeApi.url("//attacker.example/api/v1/data"), /API path/);
});

test("session and login requests include same-origin credentials and reject unauthenticated sessions", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return new Response("", { status: 401 });
    }
    return Response.json({ data: { csrfToken: "A".repeat(43), expiresAt: 123456 } });
  };
  assert.equal(await auth.getSession(fetchImpl), null);
  const session = await auth.login("operator", "unit-test-password", fetchImpl);
  assert.equal(session.csrfToken, "A".repeat(43));
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    username: "operator",
    password: "unit-test-password"
  });
});

test("protected pages redirect unauthenticated visitors to the login form", async () => {
  const browser = createBrowser({
    href: "https://dashboard.example.com/scanner.html?view=24h",
    authApi: {
      ...auth,
      async getSession() { return null; }
    }
  });
  await browser.window.CryptoPulseAuthReady;
  assert.equal(browser.redirects.length, 1);
  const destination = new URL(browser.redirects[0], "https://dashboard.example.com");
  assert.equal(destination.pathname, "/login.html");
  assert.equal(destination.searchParams.get("next"), "/scanner.html?view=24h");
});

test("dashboard login submits credentials and redirects to the safe requested page", async () => {
  const requests = [];
  const browser = createBrowser({
    pageType: "login",
    href: "https://dashboard.example.com/login.html?next=%2Fhistory.html",
    authApi: {
      ...auth,
      async getSession() { return null; },
      async login(username, password) {
        requests.push({ username, password });
        return { csrfToken: "B".repeat(43), expiresAt: 123456 };
      }
    }
  });
  await browser.window.CryptoPulseAuthReady;
  await browser.listeners.get("form:submit")({ preventDefault() {} });
  assert.deepEqual(requests, [{ username: "operator", password: "unit-test-password" }]);
  assert.deepEqual(browser.redirects, ["/history.html"]);
  assert.equal(browser.submitButton.disabled, false);
});

test("authenticated dashboard pages bind logout and remove the server session", async () => {
  const csrfTokens = [];
  const browser = createBrowser({
    authApi: {
      ...auth,
      async getSession() { return { csrfToken: "C".repeat(43), expiresAt: 123456 }; },
      async logout(token) { csrfTokens.push(token); }
    }
  });
  await browser.window.CryptoPulseAuthReady;
  await browser.listeners.get("logout:click")();
  assert.deepEqual(csrfTokens, ["C".repeat(43)]);
  assert.deepEqual(browser.redirects, ["/login.html"]);
});

test("Vercel routes protect dashboard HTML through the existing page function", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDirectory, "vercel.json"), "utf8"));
  assert.ok(vercel.routes.some((route) =>
    route.src?.includes("dashboard") && route.dest?.startsWith("/api/protected-page?page=")));
  assert.equal(vercel.functions?.["api/protected-page.mjs"]?.includeFiles, "*.html");
  const apiFunctions = fs.readdirSync(path.join(rootDirectory, "api"))
    .filter((name) => /\.(?:js|mjs|ts)$/.test(name));
  assert.ok(apiFunctions.length <= 12);
  for (const page of [
    "dashboard.html", "portfolio.html", "scanner.html", "analytics.html",
    "recommendations.html", "history.html", "exports.html"
  ]) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    assert.match(html, /\/js\/runtime-api\.js/);
    assert.doesNotMatch(html, /supabase-js|\/js\/admin\.js/);
  }
  const login = fs.readFileSync(path.join(rootDirectory, "login.html"), "utf8");
  assert.match(login, /data-login-form/);
  assert.match(login, /type="password"/);
  assert.doesNotMatch(login, /supabase/i);
});
