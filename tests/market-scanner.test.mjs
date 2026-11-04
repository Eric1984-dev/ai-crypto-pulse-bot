import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketScannerSummary } from "../lib/market-scanner.mjs";

const now = new Date("2026-03-20T12:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const symbols = ["BTC-EUR", "ETH-EUR", "SOL-EUR"];

function fixture() {
  const activeMarkets = symbols.map((symbol, index) => ({
    symbol,
    enabled: true,
    priority: index + 1
  }));
  const marketData = [
    { symbol: "BTC-EUR", price: 100, volume: 100, daily_change: 2, captured_at: at(-1, "minutes") },
    { symbol: "ETH-EUR", price: 80, volume: 50, daily_change: -3, captured_at: at(-1, "minutes") },
    { symbol: "SOL-EUR", price: 120, volume: 10, daily_change: 5, captured_at: at(-1, "minutes") }
  ];
  const dailyCandles = [];
  for (let daysAgo = 31; daysAgo >= 0; daysAgo -= 1) {
    dailyCandles.push(
      candle("BTC-EUR", "1d", daysAgo, daysAgo === 7 ? 90 : daysAgo === 30 ? 80 : 100, 10),
      candle("ETH-EUR", "1d", daysAgo, daysAgo === 7 ? 100 : daysAgo === 30 ? 120 : 80, 20),
      candle("SOL-EUR", "1d", daysAgo, daysAgo === 7 ? 100 : daysAgo === 30 ? 90 : 120, 30)
    );
  }
  const hourlyCandles = [];
  for (let hoursAgo = 8; hoursAgo >= 0; hoursAgo -= 1) {
    hourlyCandles.push(
      candle("BTC-EUR", "1h", 0, 100 - hoursAgo * 0.1, 1, hoursAgo),
      candle("ETH-EUR", "1h", 0, 80 + hoursAgo * 0.1, 1, hoursAgo),
      candle("SOL-EUR", "1h", 0, 120 - hoursAgo, 1, hoursAgo)
    );
  }
  const decisions = [
    decision("BTC-EUR", "WAIT", 65, "Older BTC decision.", -60),
    decision("BTC-EUR", "HOLD", 90, "BTC is consolidating.", -10),
    decision("ETH-EUR", "BUY", 85, "ETH momentum improved.", -5),
    decision("SOL-EUR", "SELL", 95, "SOL momentum weakened.", -2)
  ];
  return { activeMarkets, marketData, dailyCandles, hourlyCandles, decisions, now };
}

function candle(symbol, interval, daysAgo, close, volume, hoursAgo = null) {
  const offsetMs = hoursAgo === null ? daysAgo * dayMs : hoursAgo * hourMs;
  return {
    symbol,
    interval,
    close,
    volume,
    timestamp: new Date(now.getTime() - offsetMs).toISOString()
  };
}

function at(offset, unit) {
  const unitMs = unit === "minutes" ? 60_000 : dayMs;
  return new Date(now.getTime() + offset * unitMs).toISOString();
}

function decision(symbol, decisionValue, confidence, reason, minutesAgo) {
  return {
    id: `${symbol}-${decisionValue}-${minutesAgo}`,
    symbol,
    decision: decisionValue,
    confidence,
    reason,
    created_at: at(minutesAgo, "minutes")
  };
}

test("scanner ranks gainers and losers from the selected period", () => {
  const summary = buildMarketScannerSummary(fixture());

  assert.deepEqual(summary.timeframes["24h"].topGainers.map(({ symbol }) => symbol), [
    "SOL-EUR",
    "BTC-EUR",
    "ETH-EUR"
  ]);
  assert.deepEqual(summary.timeframes["24h"].topLosers.map(({ symbol }) => symbol), [
    "ETH-EUR",
    "BTC-EUR",
    "SOL-EUR"
  ]);
  assert.deepEqual(summary.timeframes["7d"].topGainers.map(({ symbol }) => symbol), [
    "SOL-EUR",
    "BTC-EUR",
    "ETH-EUR"
  ]);
  assert.deepEqual(summary.timeframes["30d"].topLosers.map(({ symbol }) => symbol), [
    "ETH-EUR",
    "BTC-EUR",
    "SOL-EUR"
  ]);
});

test("scanner ranks estimated quote volume and short-term momentum", () => {
  const summary = buildMarketScannerSummary(fixture());

  assert.equal(summary.timeframes["24h"].highestVolume[0].symbol, "BTC-EUR");
  assert.equal(summary.timeframes["24h"].highestVolume[0].volumeEur, 10_000);
  assert.equal(summary.timeframes["24h"].strongestMomentum[0].symbol, "SOL-EUR");
  assert.equal(summary.timeframes["24h"].strongestMomentum[0].momentumLabel, "6h");
  assert.equal(summary.timeframes["7d"].strongestMomentum[0].momentumLabel, "3d");
  assert.equal(summary.timeframes["30d"].strongestMomentum[0].momentumLabel, "7d");
});

test("scanner ranks each active market's latest AI decision with its reason", () => {
  const summary = buildMarketScannerSummary(fixture());
  const opportunities = summary.timeframes["24h"].aiOpportunities;

  assert.deepEqual(opportunities.map(({ symbol }) => symbol), ["SOL-EUR", "BTC-EUR", "ETH-EUR"]);
  assert.equal(opportunities[0].decision, "SELL");
  assert.equal(opportunities[0].confidence, 95);
  assert.equal(opportunities[0].reason, "SOL momentum weakened.");
  assert.equal(opportunities.some(({ reason }) => reason === "Older BTC decision."), false);
});

test("scanner excludes disabled markets, stale snapshots, and decisions outside the selected period", () => {
  const input = fixture();
  input.activeMarkets.push({ symbol: "XRP-EUR", enabled: false, priority: 4 });
  input.marketData[0].captured_at = at(-16, "minutes");
  input.decisions.push(decision("SOL-EUR", "BUY", 99, "Outside range.", -31 * 24 * 60));

  const summary = buildMarketScannerSummary(input);

  assert.equal(summary.activeMarkets, 3);
  assert.deepEqual(summary.watchedMarkets, [
    { symbol: "BTC-EUR", priority: 1 },
    { symbol: "ETH-EUR", priority: 2 },
    { symbol: "SOL-EUR", priority: 3 }
  ]);
  assert.equal(summary.marketsWithFreshData, 2);
  assert.equal(summary.timeframes["24h"].topGainers.some(({ symbol }) => symbol === "BTC-EUR"), false);
  assert.equal(summary.timeframes["30d"].aiOpportunities.some(({ reason }) => reason === "Outside range."), false);
});

test("scanner returns safe empty rankings when no active data is available", () => {
  const summary = buildMarketScannerSummary({
    activeMarkets: [],
    marketData: [],
    dailyCandles: [],
    hourlyCandles: [],
    decisions: [],
    now
  });

  for (const timeframe of Object.values(summary.timeframes)) {
    assert.deepEqual(timeframe.topGainers, []);
    assert.deepEqual(timeframe.topLosers, []);
    assert.deepEqual(timeframe.highestVolume, []);
    assert.deepEqual(timeframe.strongestMomentum, []);
    assert.deepEqual(timeframe.aiOpportunities, []);
  }
  assert.deepEqual(summary.watchedMarkets, []);
});

test("scanner handles large active-market datasets with bounded ranked results", () => {
  const activeMarkets = [];
  const marketData = [];
  const decisions = [];
  for (let index = 0; index < 1500; index += 1) {
    const symbol = `M${String(index).padStart(4, "0")}-EUR`;
    activeMarkets.push({ symbol, enabled: true, priority: index + 1 });
    marketData.push({
      symbol,
      price: 100 + index,
      volume: index + 1,
      daily_change: index - 750,
      captured_at: at(-1, "minutes")
    });
    decisions.push(decision(symbol, "BUY", index % 101, `Decision ${index}.`, -index % 60));
  }

  const summary = buildMarketScannerSummary({
    activeMarkets,
    marketData,
    dailyCandles: [],
    hourlyCandles: [],
    decisions,
    now
  });

  assert.equal(summary.activeMarkets, 1500);
  assert.equal(summary.watchedMarkets.length, 1500);
  assert.equal(summary.marketsWithFreshData, 1500);
  assert.equal(summary.timeframes["24h"].topGainers.length, 10);
  assert.equal(summary.timeframes["24h"].topLosers.length, 10);
  assert.equal(summary.timeframes["24h"].highestVolume.length, 10);
  assert.equal(summary.timeframes["24h"].aiOpportunities.length, 10);
});
