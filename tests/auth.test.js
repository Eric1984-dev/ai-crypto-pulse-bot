"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const auth = require("../js/auth-service.js");
const rootDirectory = path.resolve(__dirname, "..");

function createBrowser({ pageType = "protected", href, sessionValue = null } = {}) {
  const redirects = [];
  const messages = [];
  const storage = new Map(sessionValue ? [["cryptopulse-access-authenticated", sessionValue]] : []);
  const listeners = new Map();
  const document = {
    body: {
      dataset: { authPage: pageType },
      prepend(element) {
        messages.push(element);
      }
    },
    documentElement: {
      classList: {
        remove(name) {
          this.removed = name;
        }
      }
    },
    createElement() {
      return {
        setAttribute(name, value) {
          this[name] = value;
        },
        textContent: ""
      };
    },
    querySelector(selector) {
      return selector === "[data-auth-message]" ? null : null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const location = new URL(href || "https://dashboard.example.com/dashboard.html");
  location.replace = (value) => redirects.push(value);
  const window = {
    CryptoPulseAuth: auth,
    CryptoPulseRuntimeConfig: {
      apiOrigin: "https://runtime.example.com",
      accessAudience: "public-audience"
    },
    history: {
      replaceState(_state, _title, url) {
        location.pathname = url.split("?")[0].split("#")[0];
        location.search = url.includes("?") ? `?${url.split("?")[1].split("#")[0]}` : "";
        location.hash = url.includes("#") ? `#${url.split("#").at(-1)}` : "";
      }
    },
    location,
    sessionStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
      removeItem(key) {
        storage.delete(key);
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(rootDirectory, "js/auth.js"), "utf8"), {
    document,
    window,
    URL,
    URLSearchParams,
    Promise
  });
  return { document, messages, redirects, storage, window };
}

test("Cloudflare Access login URL uses configured API origin and a safe dashboard return path", () => {
  const loginUrl = new URL(auth.createAccessLoginUrl(
    "https://runtime.example.com",
    "public-audience",
    "/portfolio.html?tab=history",
    "https://dashboard.example.com"
  ));
  assert.equal(loginUrl.origin, "https://runtime.example.com");
  assert.equal(loginUrl.pathname, "/cdn-cgi/access/login/public-audience");
  assert.equal(
    loginUrl.searchParams.get("redirect_url"),
    "https://dashboard.example.com/portfolio.html?tab=history&cp_access=1"
  );
  assert.equal(auth.safeNextPath("//attacker.example"), "/dashboard.html");
  assert.equal(auth.safeNextPath("/login.html"), "/dashboard.html");
});

test("runtime API URL requires configured HTTPS origin and only versioned read routes", () => {
  const source = fs.readFileSync(path.join(rootDirectory, "js/runtime-api.js"), "utf8");
  const context = {
    CryptoPulseRuntimeConfig: { apiOrigin: "https://runtime.example.com" },
    URL,
    Object
  };
  vm.runInNewContext(source, { globalThis: context, URL, Object });
  assert.equal(
    context.CryptoPulseRuntimeApi.url("/api/v1/dashboard-data"),
    "https://runtime.example.com/api/v1/dashboard-data"
  );
  assert.throws(() => context.CryptoPulseRuntimeApi.url("/api/admin-actions"), /API path/);
  context.CryptoPulseRuntimeConfig.apiOrigin = "";
  assert.throws(
    () => context.CryptoPulseRuntimeApi.url("/api/v1/dashboard-data"),
    /origin is not configured/
  );
});

test("protected pages complete the Access callback before releasing the dashboard", async () => {
  const browser = createBrowser({
    href: "https://dashboard.example.com/portfolio.html?tab=history&cp_access=1"
  });
  await browser.window.CryptoPulseAuthReady;
  assert.equal(browser.storage.get("cryptopulse-access-authenticated"), "1");
  assert.equal(browser.window.location.search, "?tab=history");
  assert.equal(browser.document.documentElement.classList.removed, "auth-pending");
  assert.deepEqual(browser.redirects, []);
});

test("unauthenticated protected pages begin Cloudflare Access login", async () => {
  const browser = createBrowser({
    href: "https://dashboard.example.com/scanner.html?view=24h"
  });
  await browser.window.CryptoPulseAuthReady;
  assert.equal(browser.redirects.length, 1);
  const destination = new URL(browser.redirects[0]);
  assert.equal(destination.origin, "https://runtime.example.com");
  assert.equal(
    destination.searchParams.get("redirect_url"),
    "https://dashboard.example.com/scanner.html?view=24h&cp_access=1"
  );
});

test("legacy login routes hand off to Cloudflare Access without collecting Supabase credentials", async () => {
  const browser = createBrowser({
    pageType: "login",
    href: "https://dashboard.example.com/login.html?next=%2Fhistory.html"
  });
  await browser.window.CryptoPulseAuthReady;
  assert.equal(new URL(browser.redirects[0]).origin, "https://runtime.example.com");
  assert.match(new URL(browser.redirects[0]).searchParams.get("redirect_url"), /history\.html/);

  const authSource = fs.readFileSync(path.join(rootDirectory, "js/auth.js"), "utf8");
  const serviceSource = fs.readFileSync(path.join(rootDirectory, "js/auth-service.js"), "utf8");
  assert.doesNotMatch(authSource, /supabase|password|auth-session/i);
  assert.doesNotMatch(serviceSource, /supabase|type=["']password["']/i);
});

test("Vercel dashboard pages are static and no write-action script is loaded", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDirectory, "vercel.json"), "utf8"));
  assert.equal(JSON.stringify(vercel).includes("protected-page"), false);
  for (const page of [
    "dashboard.html", "portfolio.html", "scanner.html", "analytics.html",
    "recommendations.html", "history.html", "exports.html"
  ]) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    assert.match(html, /\/js\/runtime-api\.js/);
    assert.doesNotMatch(html, /supabase-js|\/js\/admin\.js|protected-page/);
  }
});
