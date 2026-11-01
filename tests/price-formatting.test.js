"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { formatPrice, formatTimestamp } = require("../js/formatters.js");

test("price formatting preserves five decimals below one euro and two decimals from one euro", () => {
  assert.match(formatPrice(0.00453954), /0\.00454$/);
  assert.match(formatPrice(0.05671234), /0\.05671$/);
  assert.match(formatPrice(0.98123456), /0\.98123$/);
  assert.match(formatPrice(12.3456), /12\.35$/);
  assert.match(formatPrice(69421.22), /69,421\.22$/);
  assert.match(formatPrice(1), /1\.00$/);
});

test("price formatting returns the existing empty marker for absent or invalid values", () => {
  assert.equal(formatPrice(null), "—");
  assert.equal(formatPrice(undefined), "—");
  assert.equal(formatPrice("not-a-price"), "—");
});

test("timestamp formatting uses Europe/Brussels in standard and daylight time", () => {
  assert.equal(formatTimestamp("2026-01-15T12:30:00.000Z", "time"), "13:30");
  assert.equal(formatTimestamp("2026-07-15T12:30:00.000Z", "time"), "14:30");
  assert.equal(formatTimestamp("2026-03-29T00:30:00.000Z", "time"), "01:30");
  assert.equal(formatTimestamp("2026-03-29T01:30:00.000Z", "time"), "03:30");
});

test("timestamp formatting preserves local date rollover and handles invalid values", () => {
  assert.match(formatTimestamp("2026-01-01T23:30:00.000Z"), /02\/01\/2026.*00:30/);
  assert.equal(formatTimestamp(null), "—");
  assert.equal(formatTimestamp(undefined), "—");
  assert.equal(formatTimestamp("not-a-timestamp"), "—");
  assert.equal(formatTimestamp(Symbol("timestamp")), "—");
});
