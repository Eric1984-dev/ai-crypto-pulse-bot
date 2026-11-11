"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const polling = require("../js/realtime.js");

const rootDirectory = path.resolve(__dirname, "..");

test("aligned polling invokes its callback on schedule and stops cleanly", () => {
  const timers = new Map();
  const intervals = new Map();
  let nextId = 0;
  let updates = 0;
  const cleanup = polling.startAlignedPolling({
    callback() {
      updates += 1;
    },
    intervalMs: 30000,
    nowImpl: () => 45000,
    setTimeoutImpl(callback, delay) {
      timers.set(++nextId, { callback, delay });
      return nextId;
    },
    clearTimeoutImpl(id) {
      timers.delete(id);
    },
    setIntervalImpl(callback, delay) {
      intervals.set(++nextId, { callback, delay });
      return nextId;
    },
    clearIntervalImpl(id) {
      intervals.delete(id);
    }
  });

  assert.equal([...timers.values()][0].delay, 15000);
  const [timeoutId, timeout] = [...timers.entries()][0];
  timers.delete(timeoutId);
  timeout.callback();
  assert.equal(updates, 1);
  assert.equal([...intervals.values()][0].delay, 30000);
  [...intervals.values()][0].callback();
  assert.equal(updates, 2);

  cleanup();
  assert.equal(timers.size, 0);
  assert.equal(intervals.size, 0);
});

test("legacy realtime hook is inert and dashboard pages use the Pi API", () => {
  assert.equal(typeof polling.startPageRealtime(), "function");
  for (const page of [
    "dashboard.html", "portfolio.html", "scanner.html", "analytics.html",
    "recommendations.html", "history.html", "exports.html"
  ]) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    assert.match(html, /\/js\/runtime-api\.js/);
    assert.doesNotMatch(html, /supabase-js/);
  }
  const dashboard = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  assert.match(dashboard, /\/js\/realtime\.js/);
  const source = fs.readFileSync(path.join(rootDirectory, "js", "realtime.js"), "utf8");
  assert.doesNotMatch(source, /supabase|\.channel\(/i);
});
