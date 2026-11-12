import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardAnalytics,
  MIN_STRATEGY_VERSION_SAMPLE_SIZE
} from "../src/services/dashboard-analytics.mjs";

const now = new Date("2026-03-31T00:00:00.000Z");
const periodStart = new Date(now.getTime() - 30 * 86400000).toISOString();

function decision(id, confidence, action = "WAIT", strategyName = null, strategyVersion = null) {
  return {
    id,
    symbol: "BTC-EUR",
    decision: action,
    confidence,
    strategy_name: strategyName,
    strategy_version: strategyVersion,
    indicators: {
      timeframes: {
        "1h": {
          trend: { ema12: 102, ema26: 100 },
          rsi14: 61,
          macd: { line: 2, signal: 1.5, histogram: 0.5 }
        }
      }
    }
  };
}

function trade(id, side, decisionId, quantity, realizedPnl, createdAt) {
  return {
    id,
    symbol: "BTC-EUR",
    side,
    ai_decision_id: decisionId,
    quantity,
    realized_pnl: realizedPnl,
    fees: 0.1,
    slippage: 0.05,
    created_at: createdAt
  };
}

test("analytics attributes outcomes to BUY and SELL decisions, not HOLD or WAIT", () => {
  const decisions = [
    decision("buy", 100, "BUY", "Momentum", "v1"),
    decision("sell-win", 90, "SELL", "Momentum", "v1"),
    decision("sell-loss", 80, "SELL", "Momentum", "v1"),
    decision("hold", 70, "HOLD"),
    decision("wait", 60, "WAIT")
  ];
  const trades = [
    trade("buy-trade", "BUY", "buy", 2, 0, "2026-03-05T00:00:00.000Z"),
    trade("sell-win-trade", "SELL", "sell-win", 1, 10, "2026-03-05T01:00:00.000Z"),
    trade("sell-loss-trade", "SELL", "sell-loss", 1, -5, "2026-03-05T02:00:00.000Z")
  ];
  const analytics = buildDashboardAnalytics({
    period: "30d",
    now,
    portfolio: { starting_balance: 10000, portfolio_value: 10050 },
    positions: [{ status: "OPEN", symbol: "ETH-EUR", unrealized_pnl: 15 }],
    trades,
    decisions,
    snapshots: [
      { captured_at: "2026-02-28T00:00:00.000Z", portfolio_value: 1000 },
      { captured_at: "2026-03-01T00:00:00.000Z", portfolio_value: 900 },
      { captured_at: "2026-03-02T00:00:00.000Z", portfolio_value: 1100 },
      { captured_at: "2026-03-03T00:00:00.000Z", portfolio_value: 1050 }
    ]
  });

  assert.equal(analytics.calculationVersion, "phase-11.1");
  assert.equal(analytics.tradePerformance.closedTrades, 2);
  assert.equal(analytics.tradePerformance.sampleSize, 2);
  assert.equal(analytics.tradePerformance.winRate, 50);
  assert.equal(analytics.tradePerformance.averageWin, 10);
  assert.equal(analytics.tradePerformance.averageLoss, -5);
  assert.equal(analytics.tradePerformance.riskReward, 2);
  assert.equal(analytics.tradePerformance.expectancy, 2.5);
  assert.equal(analytics.tradePerformance.realizedPnl, 5);
  assert.equal(analytics.tradePerformance.unrealizedPnl, 15);
  assert.equal(analytics.tradePerformance.totalPnl, 50);
  assert.ok(Math.abs(analytics.tradePerformance.feesOnAllTrades - 0.3) < 1e-12);
  assert.ok(Math.abs(analytics.tradePerformance.slippageOnAllTrades - 0.15) < 1e-12);
  assert.equal(analytics.tradePerformance.netRealizedPnlIncludesFees, true);

  const outcomes = analytics.aiPerformance.actions;
  assert.equal(outcomes.BUY.scoredCount, 2);
  assert.equal(outcomes.BUY.netPnl, 5);
  assert.equal(outcomes.SELL.scoredCount, 2);
  assert.equal(outcomes.SELL.netPnl, 5);
  assert.equal(outcomes.HOLD.scoredCount, 0);
  assert.equal(outcomes.WAIT.scoredCount, 0);
  assert.equal(outcomes.HOLD.unscoredCount, 1);
  assert.equal(outcomes.WAIT.unscoredCount, 1);
  assert.equal(analytics.aiPerformance.confidenceBandsByAction.BUY[4].scoredCount, 2);
  assert.equal(analytics.aiPerformance.confidenceBandsByAction.SELL[4].scoredCount, 1);
  assert.equal(analytics.aiPerformance.confidenceBandsByAction.SELL[3].scoredCount, 1);
  assert.deepEqual(analytics.indicatorAssociations.find(({ indicator }) =>
    indicator === "rsi14"), {
    period: "30d",
    symbol: "BTC-EUR",
    strategyName: "Momentum",
    strategyVersion: "v1",
    timeframe: "1h",
    indicator: "rsi14",
    sampleSize: 2,
    winningTradeCount: 1,
    losingTradeCount: 1,
    breakevenTradeCount: 0,
    averageValueForWins: 61,
    averageValueForLosses: 61,
    averageValueForBreakeven: null,
    interpretation: "descriptive association; not evidence of causation"
  });
  assert.equal(analytics.portfolio.periodPnl, 50);
  assert.equal(analytics.portfolio.maxDrawdown, 10);
  assert.equal(analytics.portfolio.maxDrawdownStatus, "CALCULATED_WITH_PERIOD_BASELINE");
  assert.equal(analytics.strategyVersionPerformance.versions[0].comparisonEligible, false);
});

test("confidence bands include exact boundaries once and exclude values below 50", () => {
  const boundaries = [50, 59.99, 60, 69.99, 70, 79.99, 80, 89.99, 90, 100, 49.99, 100.01];
  const analytics = buildDashboardAnalytics({
    period: "30d",
    now,
    portfolio: null,
    positions: [],
    trades: [],
    decisions: boundaries.map((confidence, index) =>
      decision(`decision-${index}`, confidence)),
    snapshots: []
  });

  assert.deepEqual(analytics.aiPerformance.confidenceBands.map(({ label, decisionCount }) =>
    [label, decisionCount]), [
    ["[50,60)", 2],
    ["[60,70)", 2],
    ["[70,80)", 2],
    ["[80,90)", 2],
    ["[90,100]", 2]
  ]);
  assert.equal(analytics.aiPerformance.below50Count, 1);
  assert.equal(analytics.aiPerformance.confidenceOutOfRangeCount, 1);
  assert.deepEqual(analytics.aiPerformance.confidenceBandsByAction.WAIT
    .map(({ decisionCount }) => decisionCount), [2, 2, 2, 2, 2]);
});

test("empty analytics returns null rates and only compares adequately sampled strategy versions", () => {
  const empty = buildDashboardAnalytics({
    period: "30d",
    now,
    portfolio: null,
    positions: [],
    trades: [],
    decisions: [],
    snapshots: []
  });
  assert.equal(empty.tradePerformance.winRate, null);
  assert.equal(empty.tradePerformance.expectancy, null);
  assert.equal(empty.tradePerformance.riskReward, null);
  assert.equal(empty.portfolio.maxDrawdown, null);
  assert.deepEqual(empty.indicatorAssociations, []);

  const decisions = [];
  const trades = [];
  for (const [version, count] of [["v1", 5], ["v2", 4], ["v3", 5]]) {
    for (let index = 0; index < count; index += 1) {
      const id = `${version}-decision-${index}`;
      const tradeId = `${version}-trade-${index}`;
      decisions.push(decision(id, 80, "SELL", "Trend", version));
      trades.push(trade(
        tradeId,
        "SELL",
        id,
        1,
        index % 2 === 0 ? 2 : -1,
        new Date(Date.parse("2026-03-05T00:00:00.000Z") + index * 1000).toISOString()
      ));
    }
  }
  const analytics = buildDashboardAnalytics({
    period: "30d",
    now,
    portfolio: null,
    positions: [],
    trades,
    decisions,
    snapshots: []
  });
  const versions = analytics.strategyVersionPerformance.versions;
  assert.equal(analytics.strategyVersionPerformance.minimumComparisonSampleSize,
    MIN_STRATEGY_VERSION_SAMPLE_SIZE);
  assert.equal(versions.find(({ strategyVersion }) => strategyVersion === "v2")
    .comparisonEligible, false);
  assert.equal(analytics.strategyVersionPerformance.comparisons.length, 1);
  assert.ok(analytics.strategyVersionPerformance.comparisons.every(({ left, right }) =>
    !left.endsWith("v2") && !right.endsWith("v2")));
});
