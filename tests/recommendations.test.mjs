import assert from "node:assert/strict";
import test from "node:test";
import {
  getAnalyticsExportRows
} from "../lib/analytics-exports.mjs";
import { streamCsvRows } from "../lib/dashboard-exports.mjs";
import { generateRecommendations } from "../lib/recommendations.mjs";

function createAnalytics({
  closedTrades = 12,
  confidenceBuckets = [
    { label: "70–75", scoredCount: 0, tradeCount: 0, wins: 0, netPnl: 0 },
    { label: "75–80", scoredCount: 0, tradeCount: 0, wins: 0, netPnl: 0 },
    { label: "80–85", scoredCount: 0, tradeCount: 0, wins: 0, netPnl: 0 },
    { label: "85+", scoredCount: 0, tradeCount: 0, wins: 0, netPnl: 0 }
  ],
  bySymbol = [],
  strategies = [],
  realizedPnl = 0,
  maxDrawdown = 0,
  snapshotCount = 0
} = {}) {
  return {
    generatedAt: "2026-03-21T12:00:00.000Z",
    period: "30d",
    periodStart: "2026-02-19T12:00:00.000Z",
    tradePerformance: {
      closedTrades,
      winRate: 50,
      realizedPnl,
      bySymbol
    },
    aiPerformance: { confidenceBuckets, strategies },
    portfolio: { maxDrawdown, snapshotCount }
  };
}

test("insufficient data returns no recommendations and all required categories", () => {
  const result = generateRecommendations(createAnalytics({ closedTrades: 9 }));

  assert.equal(result.insufficientData, true);
  assert.equal(result.minimumSampleSize, 10);
  assert.deepEqual(result.recommendations, []);
  assert.deepEqual(result.categories.map(({ name }) => name), [
    "AI Performance",
    "Market Selection",
    "Portfolio Management",
    "Risk Management",
    "Strategy Quality"
  ]);
});

test("confidence recommendations compare the required buckets and label evidence level", () => {
  const result = generateRecommendations(createAnalytics({
    closedTrades: 50,
    confidenceBuckets: [
      { label: "70–75", scoredCount: 50, tradeCount: 50, wins: 10, netPnl: -500 },
      { label: "75–80", scoredCount: 20, tradeCount: 20, wins: 12, netPnl: 80 },
      { label: "80–85", scoredCount: 20, tradeCount: 20, wins: 14, netPnl: 160 },
      { label: "85+", scoredCount: 20, tradeCount: 20, wins: 16, netPnl: 240 }
    ]
  }));
  const recommendation = result.categories[0].recommendations[0];

  assert.match(recommendation.title, /75%/);
  assert.equal(recommendation.confidenceLevel, "Preliminary");
  assert.equal(recommendation.sampleSize, 20);
  assert.equal(recommendation.sampleUnit, "minimum distinct closed trades per comparison side");
  assert.ok(recommendation.metrics.some(({ label }) => label === "Below-threshold win rate"));
  assert.ok(recommendation.metrics.some(({ label }) => label === "Below-threshold scored outcomes"));
  assert.ok(recommendation.metrics.some(({ label }) => label === "At-or-above-threshold scored outcomes"));
  assert.match(recommendation.estimatedImpact, /not a forecast/i);
});

test("market, portfolio, risk, and strategy recommendations use evidence and sample thresholds", () => {
  const result = generateRecommendations(createAnalytics({
    closedTrades: 50,
    bySymbol: [
      { symbol: "LOSS-EUR", closedTrades: 25, winRate: 20, realizedPnl: -40 },
      { symbol: "GAIN-EUR", closedTrades: 20, winRate: 80, realizedPnl: 50 },
      { symbol: "SMALL-EUR", closedTrades: 5, winRate: 0, realizedPnl: -100 }
    ],
    strategies: [
      { label: "Weak · 1.0", scoredCount: 50, tradeCount: 50, winRate: 30, netPnl: -120 },
      { label: "Small · 1.0", scoredCount: 9, tradeCount: 9, winRate: 0, netPnl: -900 }
    ],
    realizedPnl: -25,
    maxDrawdown: 8,
    snapshotCount: 20
  }));

  assert.equal(result.categories[1].recommendations.length, 2);
  assert.match(result.categories[1].recommendations[0].title, /LOSS-EUR/);
  assert.match(result.categories[1].recommendations[1].title, /GAIN-EUR/);
  assert.equal(result.categories[2].recommendations.length, 1);
  assert.equal(result.categories[3].recommendations[0].confidenceLevel, "Preliminary");
  assert.equal(result.categories[4].recommendations[0].confidenceLevel, "Medium");
  assert.equal(result.categories[4].recommendations.length, 1);
});

test("recommendation confidence tiers follow 10, 50, and 100 evidence boundaries", () => {
  for (const [sampleSize, expected] of [
    [10, "Preliminary"],
    [49, "Preliminary"],
    [50, "Medium"],
    [99, "Medium"],
    [100, "High"]
  ]) {
    const result = generateRecommendations(createAnalytics({
      strategies: [{
        label: "Weak · 1.0",
        scoredCount: sampleSize,
        tradeCount: sampleSize,
        winRate: 20,
        netPnl: -10
      }]
    }));
    assert.equal(result.categories[4].recommendations[0].confidenceLevel, expected);
    assert.equal(result.categories[4].recommendations[0].sampleSize, sampleSize);
  }
});

test("repeated decision outcomes cannot inflate trade-based confidence thresholds", () => {
    const result = generateRecommendations(createAnalytics({
      confidenceBuckets: [
        { label: "70–75", scoredCount: 100, tradeCount: 1, wins: 0, netPnl: -100 },
        { label: "75–80", scoredCount: 100, tradeCount: 1, wins: 80, netPnl: 80 },
        { label: "80–85", scoredCount: 0, tradeCount: 0, wins: 0, netPnl: 0 },
        { label: "85+", scoredCount: 0, tradeCount: 0, wins: 0, netPnl: 0 }
      ],
      strategies: [{
        label: "Repeated · 1.0",
        scoredCount: 100,
        tradeCount: 1,
        winRate: 0,
        netPnl: -100
      }]
    }));

    assert.equal(result.categories[0].recommendations.length, 0);
    assert.equal(result.categories[4].recommendations.length, 0);
});

test("empty metrics are handled as insufficient without fabricating impact", () => {
  const result = generateRecommendations(createAnalytics({
    closedTrades: 0,
    realizedPnl: 0,
    maxDrawdown: null
  }));

  assert.equal(result.insufficientData, true);
  assert.equal(result.recommendations.length, 0);
});

test("recommendations and history exports use generated results without stored history", () => {
  const analytics = createAnalytics({
    strategies: [{
      label: "Weak · 1.0",
      scoredCount: 12,
      tradeCount: 12,
      winRate: 25,
      netPnl: -20
    }]
  });
  const recommendations = getAnalyticsExportRows("recommendations", analytics);
  const history = getAnalyticsExportRows("recommendation-history", analytics);

  assert.equal(recommendations.rows.length, 1);
  assert.equal(history.rows.length, 1);
  assert.match(history.rows[0][0], /no generation archive/i);
  assert.equal(recommendations.rows[0][6], "30d");
  assert.equal(recommendations.rows[0][8], 12);
});

test("recommendation CSV streams generated metrics and labels recomputed history", async () => {
  const analytics = createAnalytics({
    strategies: [{
      label: "Weak · 1.0",
      scoredCount: 12,
      tradeCount: 12,
      winRate: 25,
      netPnl: -20
    }]
  });
  for (const [exportType, expected] of [
    ["recommendations", "Category,Recommendation,Reason"],
    ["recommendation-history", "History Type,Category,Recommendation"]
  ]) {
    const response = {
      statusCode: 0,
      headers: {},
      body: "",
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      write(chunk) {
        this.body += chunk;
        return true;
      },
      end() {
        this.ended = true;
      }
    };
    const content = getAnalyticsExportRows(exportType, analytics);
    const result = await streamCsvRows(
      response,
      exportType,
      "30d",
      content.headers,
      content.rows
    );

    assert.equal(result.count, 1);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, new RegExp(expected));
    if (exportType === "recommendation-history") {
      assert.match(response.body, /no generation archive/i);
    }
    assert.equal(response.ended, true);
  }
});

test("large aggregated market and strategy data stays bounded in recommendation output", () => {
  const markets = Array.from({ length: 10_001 }, (_, index) => ({
    symbol: `M${index}-EUR`,
    closedTrades: 10,
    winRate: 20,
    realizedPnl: -(index + 1)
  }));
  const strategies = Array.from({ length: 10_001 }, (_, index) => ({
    label: `Strategy ${index}`,
    scoredCount: 10,
    tradeCount: 10,
    winRate: 20,
    netPnl: -(index + 1)
  }));
  const result = generateRecommendations(createAnalytics({ bySymbol: markets, strategies }));

  assert.equal(result.categories[1].recommendations.length, 3);
  assert.equal(result.categories[4].recommendations.length, 3);
});
