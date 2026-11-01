import { ExportRequestError, streamCsvRows } from "./exports.mjs";

export const ANALYTICS_EXPORT_TYPES = Object.freeze([
  "analytics-summary",
  "trade-analytics",
  "portfolio-analytics",
  "ai-analytics"
]);

const summaryHeaders = ["Metric", "Value", "Unit", "Details"];
const tradeHeaders = [
  "Symbol",
  "Closed Trades",
  "Winning Trades",
  "Losing Trades",
  "Breakeven Trades",
  "Win Rate (%)",
  "Average Win (EUR)",
  "Average Loss (EUR)",
  "Profit Factor",
  "Realized PnL (EUR)",
  "Largest Winner (EUR)",
  "Largest Loser (EUR)",
  "Average Hold Time (seconds)"
];
const portfolioHeaders = [
  "Period",
  "Portfolio Value (EUR)",
  "Period PnL (EUR)",
  "Drawdown (%)",
  "Growth (%)"
];
const aiHeaders = [
  "Category",
  "Name",
  "Confidence Range",
  "Decisions",
  "Scored Decisions",
  "Unscored Decisions",
  "Wins",
  "Losses",
  "Breakeven",
  "Win Rate (%)",
  "Average PnL (EUR)",
  "Net PnL (EUR)",
  "Unrealized Evaluations"
];

export function isAnalyticsExportType(type) {
  return ANALYTICS_EXPORT_TYPES.includes(type);
}

export function getAnalyticsExportRows(exportType, analytics) {
  if (!isAnalyticsExportType(exportType)) {
    throw new ExportRequestError("The analytics export type is invalid.");
  }

  if (exportType === "analytics-summary") {
    return {
      headers: summaryHeaders,
      rows: createSummaryRows(analytics)
    };
  }
  if (exportType === "trade-analytics") {
    return {
      headers: tradeHeaders,
      rows: createTradeRows(analytics)
    };
  }
  if (exportType === "portfolio-analytics") {
    return {
      headers: portfolioHeaders,
      rows: analytics.portfolio.dailyPerformance.map((point) => [
        point.period,
        point.portfolioValue,
        point.pnl,
        point.drawdownPercent,
        point.growthPercent
      ])
    };
  }
  return {
    headers: aiHeaders,
    rows: createAiRows(analytics)
  };
}

export function getAnalyticsExportCounts(analytics) {
  return Object.fromEntries(ANALYTICS_EXPORT_TYPES.map((type) => [
    type,
    getAnalyticsExportRows(type, analytics).rows.length
  ]));
}

export function createAnalyticsExportsService({ analyticsService }) {
  if (!analyticsService || typeof analyticsService.load !== "function") {
    throw new TypeError("An analytics service is required.");
  }

  async function getRecordCount({ config, accessToken, exportType, period = "all", now = new Date() }) {
    const data = await loadAnalytics({ config, accessToken, exportType, period, now });
    return getAnalyticsExportRows(exportType, data).rows.length;
  }

  async function streamCsv({
    config,
    accessToken,
    exportType,
    period = "all",
    now = new Date(),
    response
  }) {
    const data = await loadAnalytics({ config, accessToken, exportType, period, now });
    const content = getAnalyticsExportRows(exportType, data);
    return streamCsvRows(response, exportType, period, content.headers, content.rows);
  }

  async function loadAnalytics({ config, accessToken, exportType, period, now }) {
    if (!isAnalyticsExportType(exportType) || period !== "all") {
      throw new ExportRequestError("The analytics export type or date filter is invalid.");
    }
    return analyticsService.load({ config, accessToken, now });
  }

  return { getRecordCount, streamCsv };
}

function createSummaryRows(analytics) {
  const trades = analytics.tradePerformance;
  const portfolio = analytics.portfolio;
  return [
    ["Win Rate", trades.winRate, "%", "Winning SELL trades divided by all SELL trades."],
    ["Loss Rate", trades.lossRate, "%", "Losing SELL trades divided by all SELL trades."],
    ["Average Win", trades.averageWin, "EUR", "Average realized PnL for winning SELL trades."],
    ["Average Loss", trades.averageLoss, "EUR", "Signed average realized PnL for losing SELL trades."],
    ["Profit Factor", trades.profitFactor, "ratio", "Gross realized wins divided by absolute gross realized losses."],
    ["Realized PnL", trades.realizedPnl, "EUR", "Sum of stored realized PnL on SELL trades."],
    ["Unrealized PnL", trades.unrealizedPnl, "EUR", "Sum of stored unrealized PnL on open positions."],
    ["Total PnL", trades.totalPnl, "EUR", "Current portfolio value less combined starting balance."],
    ["Max Drawdown", portfolio.maxDrawdown, "%", "Largest peak-to-trough decline across stored portfolio snapshots."],
    ["Best Trade", trades.bestTrade?.realizedPnl ?? null, "EUR", trades.bestTrade?.symbol || ""],
    ["Worst Trade", trades.worstTrade?.realizedPnl ?? null, "EUR", trades.worstTrade?.symbol || ""],
    ["Largest Winner", trades.largestWinner?.realizedPnl ?? null, "EUR", trades.largestWinner?.symbol || ""],
    ["Largest Loser", trades.largestLoser?.realizedPnl ?? null, "EUR", trades.largestLoser?.symbol || ""],
    ["Average Hold Time", trades.averageHoldTimeSeconds, "seconds", "Average duration between paired BUY and SELL trades."],
    ["Open Positions", trades.openPositions, "positions", "Stored positions with OPEN status."],
    ["Closed Positions", trades.closedPositions, "positions", "Stored positions with CLOSED status."],
    ["Portfolio Growth", portfolio.growthPercent, "%", "Current portfolio value relative to combined starting balance."],
    ["Portfolio Value", portfolio.portfolioValue, "EUR", "Sum of current stored portfolio values."]
  ];
}

function createTradeRows(analytics) {
  const trades = analytics.tradePerformance;
  const summary = [
    "ALL",
    trades.closedTrades,
    trades.winningTrades,
    trades.losingTrades,
    trades.breakevenTrades,
    trades.winRate,
    trades.averageWin,
    trades.averageLoss,
    trades.profitFactor,
    trades.realizedPnl,
    trades.largestWinner?.realizedPnl ?? null,
    trades.largestLoser?.realizedPnl ?? null,
    trades.averageHoldTimeSeconds
  ];
  const symbolRows = trades.bySymbol.map((symbol) => [
    symbol.symbol,
    symbol.closedTrades,
    symbol.winningTrades,
    symbol.losingTrades,
    symbol.breakevenTrades,
    symbol.winRate,
    symbol.averageWin,
    symbol.averageLoss,
    symbol.profitFactor,
    symbol.realizedPnl,
    symbol.largestWinner,
    symbol.largestLoser,
    symbol.averageHoldTimeSeconds
  ]);
  return [summary, ...symbolRows];
}

function createAiRows(analytics) {
  const rows = analytics.aiPerformance.confidenceBuckets.map((bucket) => mapGroupRow(
    "Confidence",
    bucket.label,
    bucket,
    bucket.label
  ));
  for (const action of ["BUY", "SELL", "HOLD", "WAIT"]) {
    rows.push(mapGroupRow("Action", action, analytics.aiPerformance.actions[action]));
  }
  for (const strategy of analytics.aiPerformance.strategies) {
    rows.push(mapGroupRow("Strategy", strategy.label, strategy));
  }
  for (const symbol of analytics.aiPerformance.bySymbol) {
    rows.push(mapGroupRow("Market", symbol.label, symbol));
  }
  return rows;
}

function mapGroupRow(category, name, group, confidenceRange = "") {
  return [
    category,
    name,
    confidenceRange,
    group.decisionCount,
    group.scoredCount,
    group.unscoredCount,
    group.wins,
    group.losses,
    group.breakeven,
    group.winRate,
    group.averagePnl,
    group.netPnl,
    group.unrealizedCount
  ];
}
