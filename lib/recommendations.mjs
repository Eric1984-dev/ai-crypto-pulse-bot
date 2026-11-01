const minimumSampleSize = 10;

const categoryNames = Object.freeze([
  "AI Performance",
  "Market Selection",
  "Portfolio Management",
  "Risk Management",
  "Strategy Quality"
]);

export function generateRecommendations(analytics) {
  if (!analytics || typeof analytics !== "object"
    || !analytics.tradePerformance || !analytics.aiPerformance || !analytics.portfolio) {
    throw new TypeError("Validated analytics data is required.");
  }
  const closedTrades = requireCount(analytics.tradePerformance.closedTrades, "closed trades");
  const categories = Object.fromEntries(categoryNames.map((name) => [name, []]));
  const generatedAt = requireText(analytics.generatedAt, "generation timestamp");
  const analysisPeriod = requireText(analytics.period, "analysis period");

  if (closedTrades >= minimumSampleSize) {
    addConfidenceRecommendation(analytics, categories["AI Performance"], analysisPeriod, generatedAt);
    addMarketRecommendations(analytics, categories["Market Selection"], analysisPeriod, generatedAt);
    addPortfolioRecommendation(analytics, categories["Portfolio Management"], analysisPeriod, generatedAt);
    addRiskRecommendation(analytics, categories["Risk Management"], analysisPeriod, generatedAt);
    addStrategyRecommendations(analytics, categories["Strategy Quality"], analysisPeriod, generatedAt);
  }

  const recommendations = categoryNames.flatMap((category) => categories[category]);
  return {
    generatedAt,
    analysisPeriod,
    periodStart: requireText(analytics.periodStart, "period start"),
    closedTrades,
    insufficientData: closedTrades < minimumSampleSize,
    minimumSampleSize,
    recommendations,
    categories: categoryNames.map((name) => ({
      name,
      recommendations: categories[name]
    }))
  };
}

function addConfidenceRecommendation(analytics, target, analysisPeriod, generatedAt) {
  const buckets = analytics.aiPerformance.confidenceBuckets;
  if (!Array.isArray(buckets) || buckets.length !== 4) {
    throw new TypeError("Validated confidence bucket data is required.");
  }

  const candidates = [75, 80, 85].map((threshold) => {
    const lower = summarizeBuckets(buckets.filter((bucket) => bucketMinimum(bucket.label) < threshold));
    const upper = summarizeBuckets(buckets.filter((bucket) => bucketMinimum(bucket.label) >= threshold));
    return {
      threshold,
      lower,
      upper,
      sampleSize: Math.min(lower.tradeSampleSize, upper.tradeSampleSize)
    };
  }).filter(({ lower, upper, sampleSize }) => sampleSize >= minimumSampleSize
    && lower.winRate !== null
    && upper.winRate !== null
    && upper.winRate - lower.winRate >= 10
    && lower.averagePnl < upper.averagePnl)
    .sort((left, right) =>
      right.upper.winRate - right.lower.winRate - (left.upper.winRate - left.lower.winRate)
      || left.threshold - right.threshold
    );

  const candidate = candidates[0];
  if (!candidate) {
    return;
  }
  const { threshold, lower, upper, sampleSize } = candidate;
  const winRateGap = upper.winRate - lower.winRate;
  target.push(createRecommendation({
    category: "AI Performance",
    title: `Review a minimum AI confidence threshold of ${threshold}%`,
    reason: `Scored outcomes below ${threshold}% confidence had a ${formatPercent(lower.winRate)} win rate, compared with ${formatPercent(upper.winRate)} at or above the threshold.`,
    metrics: [
      metric("Below-threshold win rate", lower.winRate, "percent"),
      metric("At-or-above-threshold win rate", upper.winRate, "percent"),
      metric("Minimum distinct closed trades per comparison side", sampleSize, "count"),
      metric("Below-threshold scored outcomes", lower.scoredCount, "count"),
      metric("At-or-above-threshold scored outcomes", upper.scoredCount, "count"),
      metric("Below-threshold average outcome", lower.averagePnl, "currency"),
      metric("At-or-above-threshold average outcome", upper.averagePnl, "currency")
    ],
    estimatedImpact: `Historical win-rate difference: ${formatNumber(winRateGap)} percentage points; this is descriptive, not a forecast.`,
    sampleSize,
    sampleUnit: "minimum distinct closed trades per comparison side",
    analysisPeriod,
    generatedAt
  }));
}

function addMarketRecommendations(analytics, target, analysisPeriod, generatedAt) {
  const symbols = analytics.tradePerformance.bySymbol;
  if (!Array.isArray(symbols)) {
    throw new TypeError("Validated market performance data is required.");
  }
  const underperformers = symbols
    .filter((symbol) => requireCount(symbol.closedTrades, "market closed trades") >= minimumSampleSize
      && typeof symbol.realizedPnl === "number"
      && symbol.realizedPnl < 0
      && typeof symbol.winRate === "number"
      && symbol.winRate < analytics.tradePerformance.winRate)
    .sort((left, right) => left.realizedPnl - right.realizedPnl)
    .slice(0, 3);

  for (const symbol of underperformers) {
    target.push(createRecommendation({
      category: "Market Selection",
      title: `Review exposure to ${requireText(symbol.symbol, "market symbol")}`,
      reason: `This market recorded negative realized P&L and a lower win rate than the account-wide rate during the selected period.`,
      metrics: [
        metric("Closed trades", symbol.closedTrades, "count"),
        metric("Win rate", symbol.winRate, "percent"),
        metric("Realized P&L", symbol.realizedPnl, "currency")
      ],
      estimatedImpact: "Reviewing market exposure may reduce reliance on weak historical results; future performance is not guaranteed.",
      sampleSize: symbol.closedTrades,
      sampleUnit: "closed trades",
      analysisPeriod,
      generatedAt
    }));
  }

  const outperformers = symbols
    .filter((symbol) => requireCount(symbol.closedTrades, "market closed trades") >= minimumSampleSize
      && typeof symbol.realizedPnl === "number"
      && symbol.realizedPnl > 0
      && typeof symbol.winRate === "number"
      && symbol.winRate - analytics.tradePerformance.winRate >= 10)
    .sort((left, right) =>
      right.winRate - left.winRate || right.realizedPnl - left.realizedPnl
    )
    .slice(0, 3);

  for (const symbol of outperformers) {
    target.push(createRecommendation({
      category: "Market Selection",
      title: `Review priority for ${requireText(symbol.symbol, "market symbol")}`,
      reason: "This market recorded positive realized P&L and a higher win rate than the account-wide rate during the selected period.",
      metrics: [
        metric("Closed trades", symbol.closedTrades, "count"),
        metric("Win rate", symbol.winRate, "percent"),
        metric("Realized P&L", symbol.realizedPnl, "currency")
      ],
      estimatedImpact: "Historical results support reviewing market priority; future performance is not guaranteed.",
      sampleSize: symbol.closedTrades,
      sampleUnit: "closed trades",
      analysisPeriod,
      generatedAt
    }));
  }
}

function addPortfolioRecommendation(analytics, target, analysisPeriod, generatedAt) {
  const realizedPnl = requireFinite(analytics.tradePerformance.realizedPnl, "realized P&L");
  if (realizedPnl >= 0) {
    return;
  }
  target.push(createRecommendation({
    category: "Portfolio Management",
    title: "Review portfolio allocation after the period's realized loss",
    reason: "Stored SELL executions produced a net realized loss during the selected period. Review allocation and concentration before making any manual changes.",
    metrics: [
      metric("Realized P&L", realizedPnl, "currency"),
      metric("Closed trades", analytics.tradePerformance.closedTrades, "count"),
      metric("Win rate", analytics.tradePerformance.winRate, "percent")
    ],
    estimatedImpact: "No reliable numeric impact can be estimated from historical results alone.",
    sampleSize: analytics.tradePerformance.closedTrades,
    sampleUnit: "closed trades",
    analysisPeriod,
    generatedAt
  }));
}

function addRiskRecommendation(analytics, target, analysisPeriod, generatedAt) {
  const drawdown = analytics.portfolio.maxDrawdown;
  const snapshots = requireCount(analytics.portfolio.snapshotCount, "portfolio snapshots");
  if (typeof drawdown !== "number" || !Number.isFinite(drawdown)
    || drawdown < 5 || snapshots < minimumSampleSize) {
    return;
  }
  const trades = analytics.tradePerformance.closedTrades;
  target.push(createRecommendation({
    category: "Risk Management",
    title: "Review portfolio exposure after elevated drawdown",
    reason: `The selected period includes a ${formatPercent(drawdown)} peak-to-trough drawdown across stored portfolio snapshots.`,
    metrics: [
      metric("Maximum drawdown", drawdown, "percent"),
      metric("Portfolio snapshots", snapshots, "count"),
      metric("Closed trades", trades, "count")
    ],
    estimatedImpact: "A manual risk review may help limit future drawdown; no numeric impact is forecast.",
    sampleSize: Math.min(trades, snapshots),
    sampleUnit: "trades and snapshots",
    analysisPeriod,
    generatedAt
  }));
}

function addStrategyRecommendations(analytics, target, analysisPeriod, generatedAt) {
  const strategies = analytics.aiPerformance.strategies;
  if (!Array.isArray(strategies)) {
    throw new TypeError("Validated strategy performance data is required.");
  }
  const underperformers = strategies
    .filter((strategy) => requireCount(strategy.tradeCount, "strategy closed trades") >= minimumSampleSize
      && typeof strategy.netPnl === "number"
      && strategy.netPnl < 0
      && typeof strategy.winRate === "number"
      && strategy.winRate < analytics.tradePerformance.winRate)
    .sort((left, right) => left.netPnl - right.netPnl)
    .slice(0, 3);

  for (const strategy of underperformers) {
    target.push(createRecommendation({
      category: "Strategy Quality",
      title: `Review ${requireText(strategy.label, "strategy label")}`,
      reason: "Scored outcomes for this strategy had negative net P&L and a lower win rate than the account-wide rate.",
      metrics: [
        metric("Closed trades", strategy.tradeCount, "count"),
        metric("Scored outcomes", strategy.scoredCount, "count"),
        metric("Win rate", strategy.winRate, "percent"),
        metric("Net P&L", strategy.netPnl, "currency")
      ],
      estimatedImpact: "Reviewing the strategy may help address observed weakness; future performance is not guaranteed.",
      sampleSize: strategy.tradeCount,
      sampleUnit: "closed trades",
      analysisPeriod,
      generatedAt
    }));
  }
}

function summarizeBuckets(buckets) {
  let scoredCount = 0;
  let tradeSampleSize = 0;
  let wins = 0;
  let netPnl = 0;
  for (const bucket of buckets) {
    scoredCount += requireCount(bucket.scoredCount, "confidence scored outcomes");
    tradeSampleSize = Math.max(
      tradeSampleSize,
      requireCount(bucket.tradeCount, "confidence closed trades")
    );
    wins += requireCount(bucket.wins, "confidence wins");
    netPnl += requireFinite(bucket.netPnl, "confidence net P&L");
  }
  return {
    scoredCount,
    tradeSampleSize,
    winRate: scoredCount ? wins / scoredCount * 100 : null,
    averagePnl: scoredCount ? netPnl / scoredCount : 0
  };
}

function bucketMinimum(label) {
  const match = typeof label === "string" && label.match(/^(\d+)/);
  if (!match) {
    throw new TypeError("A valid confidence bucket label is required.");
  }
  return Number(match[1]);
}

function createRecommendation({
  category,
  title,
  reason,
  metrics,
  estimatedImpact,
  sampleSize,
  sampleUnit,
  analysisPeriod,
  generatedAt
}) {
  return {
    category,
    title,
    reason,
    metrics,
    estimatedImpact,
    confidenceLevel: getConfidenceLevel(sampleSize),
    sampleSize,
    sampleUnit,
    analysisPeriod,
    generatedAt
  };
}

function getConfidenceLevel(sampleSize) {
  if (sampleSize >= 100) {
    return "High";
  }
  if (sampleSize >= 50) {
    return "Medium";
  }
  return "Preliminary";
}

function metric(label, value, format) {
  return { label, value, format };
}

function requireCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Validated ${field} data is required.`);
  }
  return value;
}

function requireFinite(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Validated ${field} data is required.`);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Validated ${field} data is required.`);
  }
  return value;
}

function formatPercent(value) {
  return `${formatNumber(value)}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
}
