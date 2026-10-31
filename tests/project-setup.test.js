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

test("market refresh endpoint remains available without a Vercel Cron configuration", () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(rootDirectory, "vercel.json"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(vercelConfig, "crons"), false);
  assert.equal(fs.statSync(path.join(rootDirectory, "api", "market-refresh.mjs")).isFile(), true);
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

test("environment template keeps live trading disabled", () => {
  const envExample = fs.readFileSync(path.join(rootDirectory, ".env.example"), "utf8");
  assert.match(envExample, /^ENABLE_LIVE_TRADING=false$/m);
});
