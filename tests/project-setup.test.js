const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  requiredDirectories,
  requiredPages,
  validateProject
} = require("../scripts/validate-project.js");

const rootDirectory = path.resolve(__dirname, "..");

test("project structure and local references are valid", () => {
  assert.deepEqual(validateProject(), []);
});

test("all required project directories exist", () => {
  for (const directory of requiredDirectories) {
    assert.equal(fs.statSync(path.join(rootDirectory, directory)).isDirectory(), true);
  }
});

test("all required placeholder pages exist", () => {
  for (const page of requiredPages) {
    assert.equal(fs.statSync(path.join(rootDirectory, page)).isFile(), true);
  }
});

test("all pages use a dropdown for their top navigation", () => {
  const protectedPages = ["dashboard.html", "portfolio.html", "scanner.html", "history.html", "exports.html", "settings.html", "admin.html"];
  const accountPages = ["login.html", "register.html", "reset-password.html"];

  for (const page of requiredPages) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    const nav = html.match(/<nav\b[^>]*class="primary-nav"[\s\S]*?<\/nav>/);
    assert.ok(nav, `${page} should have a primary navigation`);
    assert.match(nav[0], /<details class="nav-dropdown">/);
    assert.match(nav[0], /<summary class="nav-trigger">Menu<\/summary>/);
    assert.match(nav[0], /<div class="nav-menu">[\s\S]*<\/div>\s*<\/details>/);

    const menu = nav[0].match(/<div class="nav-menu">([\s\S]*?)<\/div>/);
    assert.ok(menu);
    if (accountPages.includes(page)) {
      assert.match(menu[1], /href="\/login\.html"/);
      assert.match(menu[1], /href="\/register\.html"/);
    } else {
      const expectedLinks = ["/dashboard.html", "/portfolio.html", "/scanner.html", "/history.html", "/exports.html", "/settings.html"];
      if (protectedPages.includes(page)) {
        expectedLinks.push("/admin.html");
      }
      for (const href of expectedLinks) {
        assert.ok(menu[1].includes(`href="${href}"`), `${page} should retain ${href}`);
      }
    }

    if (protectedPages.includes(page)) {
      assert.match(menu[1], /data-auth-logout/);
    }
  }
});

test("market refresh endpoint remains available without a Vercel Cron configuration", () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(rootDirectory, "vercel.json"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(vercelConfig, "crons"), false);
  assert.equal(fs.statSync(path.join(rootDirectory, "api", "market-refresh.mjs")).isFile(), true);
  assert.equal(fs.statSync(path.join(rootDirectory, "api", "candle-refresh.mjs")).isFile(), true);
  assert.deepEqual(validateProject(), []);
});

test("protected trading pages disclose paper-only mode and initialize the auth guard", () => {
  for (const page of ["dashboard.html", "portfolio.html", "scanner.html", "history.html"]) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    assert.match(html, /PAPER ACTIVE/);
    assert.match(html, /data-auth-page="protected"/);
    assert.match(html, /\/js\/auth\.js/);
  }
});

test("dashboard keeps the paper-mode notice and removes redundant visible descriptions", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");

  assert.match(html, /<h1 class="visually-hidden">Dashboard<\/h1>/);
  assert.match(html, /<strong>PAPER ACTIVE<\/strong>\s*<span>All amounts are simulated\. This dashboard does not place real orders\.<\/span>/);
  assert.doesNotMatch(html, /Paper portfolio|Je agent, portefeuille en recente activiteit uit Supabase\./);
  assert.doesNotMatch(html, /Status wordt gelezen uit AI_Crypto_Bot_Status|Visualisatie van de actuele status uit AI_Crypto_Bot_Status/);
});

test("environment template keeps live trading disabled", () => {
  const envExample = fs.readFileSync(path.join(rootDirectory, ".env.example"), "utf8");
  assert.match(envExample, /^ENABLE_LIVE_TRADING=false$/m);
});
