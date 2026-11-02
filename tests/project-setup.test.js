const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
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
  const protectedPages = ["dashboard.html", "portfolio.html", "scanner.html", "analytics.html", "recommendations.html", "history.html", "exports.html", "settings.html", "admin.html"];
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
      const expectedLinks = ["/dashboard.html", "/portfolio.html", "/scanner.html", "/analytics.html", "/recommendations.html", "/history.html", "/exports.html", "/settings.html"];
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

test("all page brands use the purple icon and link to the dashboard", () => {
  for (const page of requiredPages) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    const brand = html.match(/<a class="brand"[\s\S]*?<\/a>/);
    assert.ok(brand, `${page} should render the shared brand`);
    assert.match(brand[0], /href="\/dashboard\.html"/);
    assert.match(brand[0], /<img class="brand-mark" src="\/assets\/icons\/apple-touch-icon\.png" alt="" aria-hidden="true"> AI Crypto Bot/);
    assert.doesNotMatch(brand[0], />C<\/span>/);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="AI Crypto Bot">/);
  }
  const icon = fs.readFileSync(path.join(rootDirectory, "assets", "icons", "apple-touch-icon.png"));
  assert.equal(icon.toString("ascii", 1, 4), "PNG");
  assert.equal(icon.readUInt32BE(16), 180);
  assert.equal(icon.readUInt32BE(20), 180);
});

test("all pages enable standalone home-screen app mode", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(rootDirectory, "manifest.webmanifest"),
    "utf8"
  ));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/dashboard.html");
  assert.equal(manifest.theme_color, "#0b0910");
  assert.equal(manifest.background_color, "#0b0910");
  assert.ok(manifest.icons.some(({ src }) => src === "/assets/icons/apple-touch-icon.png"));

  for (const page of requiredPages) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
    assert.match(html, /<meta name="theme-color" content="#0b0910">/);
    assert.doesNotMatch(html, /<a\b[^>]*data-nav-link[^>]*target="_blank"/);
  }
});

test("global page layout does not force horizontal overflow on narrow screens", () => {
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  assert.doesNotMatch(styles, /body\s*\{[^}]*min-width:\s*320px/s);
});

test("shared page background softly fades purple into black behind existing card surfaces", () => {
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  assert.match(styles, /radial-gradient\(ellipse at 12% 0%, rgb\(87 57 112 \/ 13%\), transparent 38rem\)/);
  assert.match(styles, /radial-gradient\(ellipse at 88% 96%, rgb\(54 39 70 \/ 11%\), transparent 42rem\)/);
  assert.match(styles, /linear-gradient\(135deg, #0b0910 0%, #09070d 52%, #040306 100%\)/);
  assert.match(styles, /--surface:\s*#15111b;/);
  assert.match(styles, /--surface-raised:\s*#1d1725;/);
});

test("internal navigation resets to the top on mobile destination loads", () => {
  const source = fs.readFileSync(path.join(rootDirectory, "js", "main.js"), "utf8");
  const storage = new Map();
  const linkListeners = {};
  const dashboardLink = {
    pathname: "/history.html",
    target: "",
    addEventListener(name, callback) {
      linkListeners[name] = callback;
    },
    setAttribute() {}
  };
  const dashboardWindow = {
    location: { pathname: "/dashboard.html" },
    sessionStorage: {
      setItem(key, value) { storage.set(key, value); },
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); }
    },
    addEventListener() {},
    requestAnimationFrame(callback) { callback(); },
    scrollTo() {}
  };
  const createDocument = (links) => ({
    querySelectorAll() { return links; },
    querySelector() { return null; }
  });
  vm.runInNewContext(source, {
    window: dashboardWindow,
    document: createDocument([dashboardLink])
  });
  linkListeners.click({
    defaultPrevented: false,
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
  });
  assert.equal(storage.get("cryptopulse:navigation-target"), "/history.html");

  const windowListeners = {};
  const scrollCalls = [];
  const historyWindow = {
    location: { pathname: "/history.html" },
    sessionStorage: dashboardWindow.sessionStorage,
    addEventListener(name, callback) {
      windowListeners[name] = callback;
    },
    requestAnimationFrame(callback) { callback(); },
    scrollTo(...position) { scrollCalls.push(position); }
  };
  vm.runInNewContext(source, {
    window: historyWindow,
    document: createDocument([])
  });
  windowListeners.pageshow();

  assert.deepEqual(scrollCalls, [[0, 0]]);
  assert.equal(storage.has("cryptopulse:navigation-target"), false);
});

test("trade history filters start collapsed and the table supports vertical scrolling", () => {
  const historyHtml = fs.readFileSync(path.join(rootDirectory, "history.html"), "utf8");
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");

  assert.match(historyHtml, /<details class="history-filter-disclosure">\s*<summary class="history-filter-toggle">Search and filters<\/summary>/);
  assert.doesNotMatch(historyHtml, /<details class="history-filter-disclosure" open>/);
  assert.match(historyHtml, /<form class="history-filters" data-history-filters>/);
  assert.match(styles, /\.history-table-wrap\s*\{[^}]*max-height:\s*min\(60vh,\s*640px\)[^}]*overflow:\s*auto/s);
  assert.match(styles, /\.history-table thead th\s*\{[^}]*position:\s*sticky/s);
});

test("market refresh endpoint remains available without a Vercel Cron configuration", () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(rootDirectory, "vercel.json"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(vercelConfig, "crons"), false);
  assert.equal(fs.statSync(path.join(rootDirectory, "api", "market-refresh.mjs")).isFile(), true);
  assert.equal(fs.statSync(path.join(rootDirectory, "api", "candle-refresh.mjs")).isFile(), true);
  assert.deepEqual(validateProject(), []);
});

test("Vercel serverless function count remains at the 12-function limit", () => {
  const apiDirectory = path.join(rootDirectory, "api");
  const functionCount = fs.readdirSync(apiDirectory)
    .filter((name) => /\.(?:mjs|js)$/.test(name))
    .length;
  assert.equal(functionCount, 12);
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
