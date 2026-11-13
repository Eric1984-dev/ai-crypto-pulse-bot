import assert from "node:assert/strict";
import test from "node:test";
import { assessPositionExit } from "../src/services/position-exit-policy.mjs";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const SYMBOL = "BTC-EUR";

function candles({ high = "101", low = "99", close = "100", stale = false } = {}) {
  const latestStart = NOW.getTime() - (stale ? 125 : 5) * 60 * 1000;
  const firstStart = latestStart - 14 * 5 * 60 * 1000;
  return Array.from({ length: 15 }, (_, index) => ({
    symbol: SYMBOL,
    high,
    low,
    close,
    timestamp: new Date(firstStart + index * 5 * 60 * 1000)
  }));
}

function position(overrides = {}) {
  return {
    amount: "1",
    entry_price: "100",
    entry_cost_basis: "100",
    high_water_price: "110",
    trailing_stop_price: null,
    current_price: "110",
    ...overrides
  };
}

test("ATR ratchet uses 1.5 ATR and waits for a pullback through the persisted stop", () => {
  const risingMark = assessPositionExit(position(), "110", candles(), NOW);
  assert.equal(risingMark.dataQuality, "VALID");
  assert.equal(risingMark.atr, "2.000000000000");
  assert.equal(risingMark.trailingStopPrice, "107.000000000000");
  assert.equal(risingMark.shouldExit, false);

  const pullback = assessPositionExit(position(), "106", candles(), NOW);
  assert.equal(pullback.trailingStopPrice, "107.000000000000");
  assert.equal(pullback.shouldExit, true);
});

test("the profit floor includes entry basis, exit fee, and exit slippage", () => {
  const result = assessPositionExit(
    position({ high_water_price: "104" }),
    "104",
    candles({ high: "150", low: "50" }),
    NOW
  );
  const stop = Number(result.trailingStopPrice);
  const round12 = (value) => Math.round(value * 1e12) / 1e12;
  const executionPrice = round12(stop * 0.999);
  const grossProceeds = round12(executionPrice);
  const exitFee = round12(grossProceeds * 0.0025);
  const estimatedNetProfit = grossProceeds - exitFee - 100;

  assert.ok(estimatedNetProfit >= 3);
  assert.ok(estimatedNetProfit < 3.000001);
  assert.equal(result.shouldExit, false);
});

test("stale, incomplete, sparse, and invalid candle histories cannot arm a trail", () => {
  const stale = assessPositionExit(position(), "110", candles({ stale: true }), NOW);
  assert.equal(stale.dataQuality, "STALE_CANDLES");
  assert.equal(stale.trailingStopPrice, null);

  const incompleteCandles = candles();
  incompleteCandles[14] = {
    ...incompleteCandles[14],
    timestamp: new Date(NOW.getTime() - 2 * 60 * 1000)
  };
  const incomplete = assessPositionExit(position(), "110", incompleteCandles, NOW);
  assert.equal(incomplete.dataQuality, "INCOMPLETE_CANDLE");

  const gapCandles = candles();
  gapCandles[10] = {
    ...gapCandles[10],
    timestamp: new Date(gapCandles[10].timestamp.getTime() + 5 * 60 * 1000)
  };
  const gap = assessPositionExit(position(), "110", gapCandles, NOW);
  assert.equal(gap.dataQuality, "CANDLE_GAP");

  const invalid = assessPositionExit(
    position(),
    "110",
    candles({ high: "98", low: "99" }),
    NOW
  );
  assert.equal(invalid.dataQuality, "INVALID_CANDLE");

  const zeroAtr = assessPositionExit(
    position(),
    "110",
    candles({ high: "100", low: "100" }),
    NOW
  );
  assert.equal(zeroAtr.dataQuality, "ZERO_ATR");
  assert.equal(zeroAtr.trailingStopPrice, null);
});

test("a persisted stop never loosens when volatility expands or ATR data is unavailable", () => {
  const widenedAtr = assessPositionExit(
    position({ trailing_stop_price: "108" }),
    "109",
    candles({ high: "104", low: "96" }),
    NOW
  );
  assert.equal(widenedAtr.trailingStopPrice, "108.000000000000");
  assert.equal(widenedAtr.shouldExit, false);

  const noCandles = assessPositionExit(
    position({ trailing_stop_price: "108" }),
    "107",
    [],
    NOW
  );
  assert.equal(noCandles.trailingStopPrice, "108.000000000000");
  assert.equal(noCandles.shouldExit, true);
});
