"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDirectory = path.resolve(__dirname, "..");

test("dashboard administration remains read-only and exposes no execution controls", () => {
  const pages = ["dashboard", "portfolio", "scanner", "history", "settings", "admin"];
  for (const pageName of pages) {
    const html = fs.readFileSync(path.join(rootDirectory, `${pageName}.html`), "utf8");
    assert.match(html, /data-admin-nav href="\/admin\.html" hidden>Admin<\/a>/);
    assert.doesNotMatch(html, /\/js\/admin\.js/);
    assert.doesNotMatch(html, /data-admin-action=/);
  }
  const dashboardHtml = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  assert.doesNotMatch(dashboardHtml, /data-admin-actions|Execute AI Analysis|Execute Paper Trading/);
  assert.equal(fs.existsSync(path.join(rootDirectory, "api", "admin-actions.mjs")), false);
});
