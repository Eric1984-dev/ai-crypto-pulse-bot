"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatCurrency,
  formatPrice,
  formatQuantity,
  formatSignedPercent,
  formatSignedCurrency,
  formatTimestamp,
  formatTradeValueDetails,
  getClosedTradeMetrics,
  getOpenPositionMetrics,
  setValueTone
} = require("../js/formatters.js");

test("price formatting preserves five decimals below one euro and two decimals from one euro", () => {
  assert.match(formatPrice(0.00453954), /0\.00454$/);
  assert.match(formatPrice(0.05671234), /0\.05671$/);
  assert.match(formatPrice(0.98123456), /0\.98123$/);
  assert.match(formatPrice(0.00006123), /0\.00006123$/);
  assert.match(formatPrice(12.3456), /12\.35$/);
  assert.match(formatPrice(69421.22), /69,421\.22$/);
  assert.match(formatPrice(1), /1\.00$/);
});

test("quantity formatting removes precision noise and compacts very large amounts", () => {
  assert.equal(formatQuantity("16348102.95927201"), "16.35M");
  assert.equal(formatQuantity("220837.14636271"), "220,837");
  assert.equal(formatQuantity("0.000123456789"), "0.00012346");
  assert.equal(formatQuantity(null), "—");
});

test("position and closed-trade return metrics derive from stored execution data", () => {
  const openMetrics = getOpenPositionMetrics({
    amount: "1000",
    entry_price: "1",
    current_market_price: "1.1"
  });
  assert.ok(Math.abs(openMetrics.unrealizedPnl - 100) < 1e-10);
  assert.ok(Math.abs(openMetrics.unrealizedPnlPercent - 10) < 1e-10);
  assert.equal(openMetrics.currentPrice, 1.1);

  const closedMetrics = getClosedTradeMetrics({
    side: "SELL",
    price: "1124",
    quantity: "1",
    fees: "2.81",
    realized_pnl: "118.69"
  });
  assert.equal(closedMetrics.entryPrice, 1002.5);
  assert.equal(closedMetrics.exitPrice, 1124);
  assert.equal(closedMetrics.realizedPnl, 118.69);
  assert.match(formatSignedPercent(closedMetrics.realizedPnlPercent), /^\+11\.84%$/);
});

test("price formatting returns the existing empty marker for absent or invalid values", () => {
  assert.equal(formatPrice(null), "—");
  assert.equal(formatPrice(undefined), "—");
  assert.equal(formatPrice("not-a-price"), "—");
});

test("trade value details display BUY cost and SELL proceeds from stored execution fields", () => {
  assert.deepEqual(formatTradeValueDetails({
    side: "BUY",
    price: "1000",
    quantity: "1",
    fees: "2.5"
  }), [
    "Invested Amount: €1,000.00",
    "Fees: €2.50",
    "Total Cost: €1,002.50"
  ]);
  assert.deepEqual(formatTradeValueDetails({
    side: "SELL",
    price: "1124",
    quantity: "1",
    fees: "2.81",
    realized_pnl: "118.69"
  }), [
    "Gross Proceeds: €1,124.00",
    "Fees: €2.81",
    "Net Proceeds: €1,121.19",
    "Realized P&L: +€118.69"
  ]);
  assert.equal(formatCurrency(null), "—");
  assert.equal(formatSignedCurrency(-4.5), "-€4.50");
});

test("signed value tone updates between positive, negative, and neutral values", () => {
  const card = { dataset: {} };
  const element = {
    dataset: {},
    closest(selector) {
      return selector === ".metric-card" ? card : null;
    }
  };

  setValueTone(element, -4.5);
  assert.equal(element.dataset.valueTone, "negative");
  assert.equal(card.dataset.valueTone, "negative");

  setValueTone(element, 8);
  assert.equal(element.dataset.valueTone, "positive");
  assert.equal(card.dataset.valueTone, "positive");

  setValueTone(element, 0);
  assert.equal("valueTone" in element.dataset, false);
  assert.equal("valueTone" in card.dataset, false);
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
