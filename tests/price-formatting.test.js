"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { formatPrice } = require("../js/formatters.js");

test("price formatting preserves five decimals below one euro and two decimals from one euro", () => {
  assert.match(formatPrice(0.00453954), /0,00454$/);
  assert.match(formatPrice(0.05671234), /0,05671$/);
  assert.match(formatPrice(0.98123456), /0,98123$/);
  assert.match(formatPrice(12.3456), /12,35$/);
  assert.match(formatPrice(69421.22), /69\.421,22$/);
  assert.match(formatPrice(1), /1,00$/);
});

test("price formatting returns the existing empty marker for absent or invalid values", () => {
  assert.equal(formatPrice(null), "—");
  assert.equal(formatPrice(undefined), "—");
  assert.equal(formatPrice("not-a-price"), "—");
});
