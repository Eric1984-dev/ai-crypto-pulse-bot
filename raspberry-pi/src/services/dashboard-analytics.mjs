const PERIOD_MS = Object.freeze({
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000
});
export const SUPPORTED_DASHBOARD_ANALYTICS_PERIODS = Object.freeze(Object.keys(PERIOD_MS));
export const ANALYTICS_CALCULATION_VERSION = "phase-11.1";
export const MIN_STRATEGY_VERSION_SAMPLE_SIZE = 5;
const ACTIONS = Object.freeze(["BUY", "SELL", "HOLD", "WAIT"]);
const BUCKETS = Object.freeze([
  Object.freeze({ label: "70–75", min: 70, max: 75 }),
  Object.freeze({ label: "75–80", min: 75, max: 80 }),
  Object.freeze({ label: "80–85", min: 80, max: 85 }),
  Object.freeze({ label: "85+", min: 85, max: 101 })
]);
const CONFIDENCE_BANDS = Object.freeze([
  Object.freeze({ label: "[50,60)", min: 50, max: 60 }),
  Object.freeze({ label: "[60,70)", min: 60, max: 70 }),
  Object.freeze({ label: "[70,80)", min: 70, max: 80 }),
  Object.freeze({ label: "[80,90)", min: 80, max: 90 }),
  Object.freeze({ label: "[90,100]", min: 90, max: 100.0000001 })
]);

export function buildDashboardAnalytics({
  period,
  now,
  portfolio,
  positions,
  trades,
  decisions,
  decisionSummary = null,
  snapshots,
  sourceCounts = null,
  shadowExitAnalytics = null,
  truncatedSources = Object.freeze({})
}) {
  const generatedAt = now.toISOString();
  const periodStart = new Date(now.getTime() - PERIOD_MS[period]).toISOString();
  const sellTrades = trades.filter(({ side }) => side === "SELL");
  const tradePerformance = createTradePerformance({
    sellTrades,
    positions,
    trades,
    portfolio
  });
  const aiPerformance = createAiPerformance(decisions, trades, decisionSummary);
  const strategyVersionPerformance = createStrategyVersionPerformance(
    decisionSummary,
    decisions,
    sellTrades
  );
  const indicatorAssociations = createIndicatorAssociations(decisions, sellTrades, period);
  const portfolioAnalytics = createPortfolioAnalytics(portfolio, snapshots, periodStart);

  return {
    calculationVersion: ANALYTICS_CALCULATION_VERSION,
    generatedAt,
    period,
    periodStart,
    tradePerformance,
    aiPerformance,
    strategyVersionPerformance,
    indicatorAssociations,
    shadowExitAnalytics,
    portfolio: portfolioAnalytics,
    sourceCounts,
    dataQuality: {
      unpairedBuyTrades: tradePerformance.unpairedBuyTrades,
      unmatchedSellTrades: tradePerformance.unmatchedSellTrades,
      unmatchedDecisionTrades: aiPerformance.unmatchedDecisionTrades,
      openTradesWithoutPosition: tradePerformance.openTradesWithoutPosition,
      confidenceOutOfRangeCount: aiPerformance.confidenceOutOfRangeCount,
      truncatedSources
    }
  };
}

function createTradePerformance({ sellTrades, positions, trades, portfolio }) {
  const winningTrades = sellTrades.filter((trade) => trade.realized_pnl > 0);
  const losingTrades = sellTrades.filter((trade) => trade.realized_pnl < 0);
  const breakevenTrades = sellTrades.filter((trade) => trade.realized_pnl === 0);
  const realizedPnl = sum(sellTrades, (trade) => trade.realized_pnl);
  const grossProfit = sum(winningTrades, (trade) => trade.realized_pnl);
  const grossLoss = Math.abs(sum(losingTrades, (trade) => trade.realized_pnl));
  const symbols = summarizeSymbols(sellTrades);
  const holdData = getHoldDurations(trades);
  const closedTradeCount = sellTrades.length;
  const winRate = closedTradeCount ? winningTrades.length / closedTradeCount : null;
  const lossRate = closedTradeCount ? losingTrades.length / closedTradeCount : null;
  const averageWin = average(winningTrades, (trade) => trade.realized_pnl);
  const averageLoss = average(losingTrades, (trade) => trade.realized_pnl);
  const openPositions = positions.filter(({ status }) => status === "OPEN");
  const openSymbols = new Set(openPositions.map(({ symbol }) => symbol));
  const openTradeSymbols = new Set(holdData.openSymbols);

  return {
    closedTrades: closedTradeCount,
    sampleSize: closedTradeCount,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRate: winRate === null ? null : winRate * 100,
    lossRate: lossRate === null ? null : lossRate * 100,
    averageWin,
    averageLoss,
    riskReward: averageWin !== null && averageLoss !== null && averageLoss !== 0
      ? averageWin / Math.abs(averageLoss)
      : null,
    expectancy: winRate === null || lossRate === null
      ? null
      : winRate * (averageWin ?? 0) + lossRate * (averageLoss ?? 0),
    profitFactor: grossLoss ? grossProfit / grossLoss : null,
    profitFactorStatus: closedTradeCount === 0 ? "NO_CLOSED_TRADES"
      : grossLoss === 0 ? "NO_LOSSES" : "CALCULATED",
    realizedPnl,
    unrealizedPnl: sum(openPositions, (position) => position.unrealized_pnl),
    totalPnl: portfolio ? portfolio.portfolio_value - portfolio.starting_balance : null,
    totalPnlScope: "lifetime portfolio value minus starting balance at generation time",
    feesOnClosedTrades: sum(sellTrades, (trade) => trade.fees),
    feesOnAllTrades: sum(trades, (trade) => trade.fees),
    slippageOnAllTrades: sum(trades, (trade) => trade.slippage ?? 0),
    netRealizedPnlIncludesFees: true,
    unrealizedPnlScope: "current open positions at generation time",
    bestTrade: extremeTrade(sellTrades, "max"),
    worstTrade: extremeTrade(sellTrades, "min"),
    largestWinner: extremeTrade(winningTrades, "max"),
    largestLoser: extremeTrade(losingTrades, "min"),
    averageHoldTimeSeconds: holdData.durationCount
      ? holdData.durationSeconds / holdData.durationCount
      : null,
    openPositions: openPositions.length,
    closedPositions: positions.filter(({ status }) => status === "CLOSED").length,
    bySymbol: symbols,
    bestSymbols: symbols.filter((symbol) => symbol.closedTrades > 0)
      .slice().sort((left, right) => right.realizedPnl - left.realizedPnl).slice(0, 5),
    worstSymbols: symbols.filter((symbol) => symbol.closedTrades > 0)
      .slice().sort((left, right) => left.realizedPnl - right.realizedPnl).slice(0, 5),
    unpairedBuyTrades: holdData.unpairedBuyTrades,
    unmatchedSellTrades: holdData.unmatchedSellTrades,
    openTradesWithoutPosition: [...openTradeSymbols].filter((symbol) => !openSymbols.has(symbol)).length
  };
}

function summarizeSymbols(trades) {
  const groups = new Map();
  for (const trade of trades) {
    if (!groups.has(trade.symbol)) {
      groups.set(trade.symbol, []);
    }
    groups.get(trade.symbol).push(trade);
  }
  return [...groups.entries()].map(([symbol, rows]) => {
    const wins = rows.filter((trade) => trade.realized_pnl > 0).length;
    const losses = rows.filter((trade) => trade.realized_pnl < 0).length;
    return {
      symbol,
      closedTrades: rows.length,
      winningTrades: wins,
      losingTrades: losses,
      breakevenTrades: rows.length - wins - losses,
      winRate: rows.length ? wins / rows.length * 100 : null,
      realizedPnl: sum(rows, (trade) => trade.realized_pnl)
    };
  });
}

function getHoldDurations(trades) {
  const queues = new Map();
  const sorted = trades.slice().sort((left, right) =>
    left.symbol.localeCompare(right.symbol)
    || Date.parse(left.created_at) - Date.parse(right.created_at)
    || String(left.id).localeCompare(String(right.id))
  );
  let durationSeconds = 0;
  let durationCount = 0;
  let unpairedBuyTrades = 0;
  let unmatchedSellTrades = 0;

  for (const trade of sorted) {
    if (!queues.has(trade.symbol)) {
      queues.set(trade.symbol, []);
    }
    const queue = queues.get(trade.symbol);
    if (trade.side === "BUY") {
      queue.push({
        quantity: trade.quantity,
        createdAt: Date.parse(trade.created_at)
      });
      continue;
    }
    let remaining = trade.quantity;
    let matched = false;
    while (remaining > 0 && queue.length > 0) {
      const buy = queue[0];
      const matchedQuantity = Math.min(remaining, buy.quantity);
      const seconds = Math.max(0, (Date.parse(trade.created_at) - buy.createdAt) / 1000);
      durationSeconds += seconds * matchedQuantity;
      durationCount += matchedQuantity;
      remaining -= matchedQuantity;
      buy.quantity -= matchedQuantity;
      matched = true;
      if (buy.quantity <= Number.EPSILON) {
        queue.shift();
      }
    }
    if (!matched) {
      unmatchedSellTrades += 1;
    }
  }

  const openSymbols = [];
  for (const [symbol, queue] of queues) {
    if (queue.length) {
      unpairedBuyTrades += queue.length;
      openSymbols.push(symbol);
    }
  }
  return {
    durationSeconds,
    durationCount,
    unpairedBuyTrades,
    unmatchedSellTrades,
    openSymbols
  };
}

function createAiPerformance(decisions, trades, decisionSummary = null) {
  const buckets = BUCKETS.map(({ label }) => createDecisionGroup(label));
  const confidenceBands = CONFIDENCE_BANDS.map(({ label }) => createDecisionGroup(label));
  const confidenceBandsByAction = Object.fromEntries(ACTIONS.map((action) => [
    action,
    CONFIDENCE_BANDS.map(({ label }) => createDecisionGroup(label))
  ]));
  const actions = Object.fromEntries(ACTIONS.map((action) => [action, createDecisionGroup(action)]));
  const strategies = new Map();
  const symbols = new Map();
  const decisionById = new Map();
  let below70Count = decisionSummary?.below70Count ?? 0;
  let below50Count = decisionSummary?.below50Count ?? 0;
  let confidenceOutOfRangeCount = decisionSummary?.confidenceOutOfRangeCount ?? 0;
  let unmatchedDecisionTrades = 0;

  for (const decision of decisions) {
    const normalized = {
      ...decision,
      confidence: Number(decision.confidence),
      strategy: decision.strategy_name
        ? `${decision.strategy_name} · ${decision.strategy_version}`
        : null
    };
    decisionById.set(String(decision.id), normalized);
    if (!decisionSummary) {
      if (actions[decision.decision]) {
        actions[decision.decision].decisionCount += 1;
      }
      getGroup(symbols, normalized.symbol).decisionCount += 1;
      const bucketIndex = BUCKETS.findIndex((bucket) =>
        normalized.confidence >= bucket.min && normalized.confidence < bucket.max
      );
      if (normalized.confidence < 50) {
        below50Count += 1;
      }
      if (normalized.confidence < 70) {
        below70Count += 1;
      }
      if (normalized.confidence > 100 || !Number.isFinite(normalized.confidence)) {
        confidenceOutOfRangeCount += 1;
      } else {
        if (normalized.confidence >= 70 && bucketIndex >= 0) {
          buckets[bucketIndex].decisionCount += 1;
        }
        const bandIndex = CONFIDENCE_BANDS.findIndex((band) =>
          normalized.confidence >= band.min && normalized.confidence < band.max
        );
        if (bandIndex >= 0) {
          confidenceBands[bandIndex].decisionCount += 1;
          const actionBands = confidenceBandsByAction[normalized.decision];
          if (actionBands) {
            actionBands[bandIndex].decisionCount += 1;
          }
        }
      }
      if (normalized.strategy) {
        const group = getGroup(strategies, normalized.strategy);
        group.decisionCount += 1;
      }
    }
  }

  if (decisionSummary) {
    for (const { label, decisionCount } of decisionSummary.actions) {
      actions[label].decisionCount = decisionCount;
    }
    for (const { label, decisionCount } of decisionSummary.confidenceBuckets) {
      const bucket = buckets.find((item) => item.label === label);
      if (bucket) {
        bucket.decisionCount = decisionCount;
      }
    }
    for (const { label, decisionCount } of decisionSummary.confidenceBands || []) {
      const band = confidenceBands.find((item) => item.label === label);
      if (band) {
        band.decisionCount = decisionCount;
      }
    }
    for (const { action, label, decisionCount }
      of decisionSummary.confidenceBandsByAction || []) {
      const bandIndex = CONFIDENCE_BANDS.findIndex((band) => band.label === label);
      if (bandIndex >= 0 && confidenceBandsByAction[action]) {
        confidenceBandsByAction[action][bandIndex].decisionCount = decisionCount;
      }
    }
    for (const { label, decisionCount } of decisionSummary.strategies) {
      getGroup(strategies, label).decisionCount = decisionCount;
    }
    for (const { label, decisionCount } of decisionSummary.bySymbol) {
      getGroup(symbols, label).decisionCount = decisionCount;
    }
  }

  const buyOutcomes = matchBuyDecisionOutcomes(trades, decisionById);
  const sellTrades = trades.filter(({ side }) => side === "SELL");
  for (const trade of sellTrades) {
    if (trade.execution_reason === "ATR_TRAILING_EXIT" && !trade.ai_decision_id) {
      continue;
    }
    const decision = trade.ai_decision_id
      ? decisionById.get(String(trade.ai_decision_id))
      : null;
    if (!decision || decision.decision !== "SELL") {
      unmatchedDecisionTrades += 1;
      continue;
    }
    addDecisionOutcome({
      decision,
      pnl: trade.realized_pnl,
      outcomeTradeId: trade.id,
      actions,
      buckets,
      confidenceBands,
      confidenceBandsByAction,
      strategies,
      symbols
    });
  }
  for (const outcome of buyOutcomes) {
    if (!outcome.decision || outcome.decision.decision !== "BUY") {
      unmatchedDecisionTrades += 1;
      continue;
    }
    addOutcome(actions.BUY, outcome.realizedPnl, outcome.sellTradeId);
    const bandIndex = CONFIDENCE_BANDS.findIndex((band) =>
      outcome.decision.confidence >= band.min && outcome.decision.confidence < band.max
    );
    if (bandIndex >= 0) {
      addOutcome(
        confidenceBandsByAction.BUY[bandIndex],
        outcome.realizedPnl,
        outcome.sellTradeId
      );
    }
  }

  const finalizedBuckets = buckets.map(finalizeDecisionGroup);
  const finalizedConfidenceBands = confidenceBands.map(finalizeDecisionGroup);
  const scoredBuckets = finalizedBuckets.filter(({ scoredCount }) => scoredCount > 0);
  return {
    decisionCount: decisionSummary?.decisionCount ?? decisions.length,
    below70Count,
    below50Count,
    confidenceOutOfRangeCount,
    unscoredHoldDecisions: actions.HOLD.decisionCount,
    unscoredWaitDecisions: actions.WAIT.decisionCount,
    unmatchedDecisionTrades,
    confidenceBuckets: finalizedBuckets,
    confidenceBands: finalizedConfidenceBands,
    confidenceBandsByAction: Object.fromEntries(ACTIONS.map((action) => [
      action,
      confidenceBandsByAction[action].map(finalizeDecisionGroup)
    ])),
    bestConfidenceRange: scoredBuckets.slice().sort((left, right) =>
      right.averagePnl - left.averagePnl || right.scoredCount - left.scoredCount
    )[0] || null,
    worstConfidenceRange: scoredBuckets.slice().sort((left, right) =>
      left.averagePnl - right.averagePnl || right.scoredCount - left.scoredCount
    )[0] || null,
    actions: Object.fromEntries(ACTIONS.map((action) => [
      action,
      finalizeDecisionGroup(actions[action])
    ])),
    strategies: [...strategies.values()].map(finalizeDecisionGroup)
      .sort((left, right) => right.netPnl - left.netPnl || right.decisionCount - left.decisionCount),
    bySymbol: [...symbols.values()].map(finalizeDecisionGroup)
      .sort((left, right) => right.netPnl - left.netPnl || right.decisionCount - left.decisionCount)
  };
}

function addDecisionOutcome({
  decision,
  pnl,
  outcomeTradeId,
  actions,
  buckets,
  confidenceBands,
  confidenceBandsByAction,
  strategies,
  symbols
}) {
  const action = actions[decision.decision];
  if (!action) {
    return;
  }
  addOutcome(action, pnl, outcomeTradeId);
  const bucketIndex = BUCKETS.findIndex((bucket) =>
    decision.confidence >= bucket.min && decision.confidence < bucket.max
  );
  if (bucketIndex >= 0) {
    addOutcome(buckets[bucketIndex], pnl, outcomeTradeId);
  }
  const bandIndex = CONFIDENCE_BANDS.findIndex((band) =>
    decision.confidence >= band.min && decision.confidence < band.max
  );
  if (bandIndex >= 0) {
    addOutcome(confidenceBands[bandIndex], pnl, outcomeTradeId);
    addOutcome(confidenceBandsByAction[decision.decision][bandIndex], pnl, outcomeTradeId);
  }
  if (decision.strategy) {
    addOutcome(getGroup(strategies, decision.strategy), pnl, outcomeTradeId);
  }
  addOutcome(getGroup(symbols, decision.symbol), pnl, outcomeTradeId);
}

function matchBuyDecisionOutcomes(trades, decisionById) {
  const queues = new Map();
  const outcomes = [];
  const sorted = trades.slice().sort((left, right) =>
    left.symbol.localeCompare(right.symbol)
    || Date.parse(left.created_at) - Date.parse(right.created_at)
    || String(left.id).localeCompare(String(right.id))
  );

  for (const trade of sorted) {
    if (!queues.has(trade.symbol)) {
      queues.set(trade.symbol, []);
    }
    const queue = queues.get(trade.symbol);
    if (trade.side === "BUY") {
      queue.push({
        quantity: trade.quantity,
        decision: trade.ai_decision_id
          ? decisionById.get(String(trade.ai_decision_id))
          : null
      });
      continue;
    }
    let remaining = trade.quantity;
    while (remaining > 0 && queue.length > 0) {
      const buy = queue[0];
      const matchedQuantity = Math.min(remaining, buy.quantity);
      outcomes.push({
        decision: buy.decision,
        sellTradeId: trade.id,
        realizedPnl: trade.realized_pnl * (matchedQuantity / trade.quantity)
      });
      remaining -= matchedQuantity;
      buy.quantity -= matchedQuantity;
      if (buy.quantity <= Number.EPSILON) {
        queue.shift();
      }
    }
  }
  return outcomes;
}

function createStrategyVersionPerformance(decisionSummary, decisions, sellTrades) {
  const groups = new Map();
  for (const item of decisionSummary?.strategyVersions || []) {
    groups.set(`${item.strategyName}\u0000${item.strategyVersion}`, {
      strategyName: item.strategyName,
      strategyVersion: item.strategyVersion,
      decisionCount: item.decisionCount,
      trades: []
    });
  }
  if (!decisionSummary) {
    for (const decision of decisions) {
      if (!decision.strategy_name || !decision.strategy_version) {
        continue;
      }
      const key = `${decision.strategy_name}\u0000${decision.strategy_version}`;
      if (!groups.has(key)) {
        groups.set(key, {
          strategyName: decision.strategy_name,
          strategyVersion: decision.strategy_version,
          decisionCount: 0,
          trades: []
        });
      }
      groups.get(key).decisionCount += 1;
    }
  }
  const decisionById = new Map(decisions.map((decision) => [
    String(decision.id),
    decision
  ]));
  for (const trade of sellTrades) {
    const decision = trade.ai_decision_id
      ? decisionById.get(String(trade.ai_decision_id))
      : null;
    if (!decision || decision.decision !== "SELL"
      || !decision.strategy_name || !decision.strategy_version) {
      continue;
    }
    const key = `${decision.strategy_name}\u0000${decision.strategy_version}`;
    if (!groups.has(key)) {
      groups.set(key, {
        strategyName: decision.strategy_name,
        strategyVersion: decision.strategy_version,
        decisionCount: 0,
        trades: []
      });
    }
    groups.get(key).trades.push(trade);
  }

  const versions = [...groups.values()].map((group) => {
    const sorted = group.trades.slice().sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at)
      || String(left.id).localeCompare(String(right.id))
    );
    const markets = new Map();
    for (const trade of sorted) {
      if (!markets.has(trade.symbol)) {
        markets.set(trade.symbol, []);
      }
      markets.get(trade.symbol).push(trade);
    }
    return {
      strategyName: group.strategyName,
      strategyVersion: group.strategyVersion,
      decisionCount: group.decisionCount,
      ...summarizeStrategyTrades(sorted),
      byMarket: [...markets.entries()].map(([symbol, rows]) => ({
        symbol,
        ...summarizeStrategyTrades(rows)
      })),
      comparisonEligible: sorted.length >= MIN_STRATEGY_VERSION_SAMPLE_SIZE
    };
  }).sort((left, right) =>
    right.realizedPnl - left.realizedPnl
    || left.strategyName.localeCompare(right.strategyName)
    || left.strategyVersion.localeCompare(right.strategyVersion)
  );
  const eligible = versions.filter(({ comparisonEligible }) => comparisonEligible);
  const comparisons = [];
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      comparisons.push({
        left: `${eligible[left].strategyName} · ${eligible[left].strategyVersion}`,
        right: `${eligible[right].strategyName} · ${eligible[right].strategyVersion}`,
        realizedPnlDifference: eligible[left].realizedPnl - eligible[right].realizedPnl,
        expectancyDifference: eligible[left].expectancy - eligible[right].expectancy,
        winRateDifference: eligible[left].winRate - eligible[right].winRate
      });
    }
  }
  return {
    minimumComparisonSampleSize: MIN_STRATEGY_VERSION_SAMPLE_SIZE,
    versions,
    comparisons
  };
}

function summarizeStrategyTrades(trades) {
  const sorted = trades.slice().sort((left, right) =>
    Date.parse(left.created_at) - Date.parse(right.created_at)
    || String(left.id).localeCompare(String(right.id))
  );
  const wins = sorted.filter(({ realized_pnl }) => realized_pnl > 0);
  const losses = sorted.filter(({ realized_pnl }) => realized_pnl < 0);
  const grossLoss = Math.abs(sum(losses, ({ realized_pnl }) => realized_pnl));
  let cumulativePnl = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  for (const trade of sorted) {
    cumulativePnl += trade.realized_pnl;
    peak = Math.max(peak, cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulativePnl);
    if (peak > 0) {
      maxDrawdownPercent = Math.max(
        maxDrawdownPercent,
        (peak - cumulativePnl) / peak * 100
      );
    }
  }
  return {
    tradeCount: sorted.length,
    sampleSize: sorted.length,
    winRate: sorted.length ? wins.length / sorted.length * 100 : null,
    profitFactor: grossLoss
      ? sum(wins, ({ realized_pnl }) => realized_pnl) / grossLoss
      : null,
    profitFactorStatus: sorted.length === 0 ? "NO_CLOSED_TRADES"
      : grossLoss === 0 ? "NO_LOSSES" : "CALCULATED",
    expectancy: sorted.length
      ? sum(sorted, ({ realized_pnl }) => realized_pnl) / sorted.length
      : null,
    realizedPnl: sum(sorted, ({ realized_pnl }) => realized_pnl),
    maxDrawdown,
    maxDrawdownPercent
  };
}

function createIndicatorAssociations(decisions, sellTrades, period) {
  const decisionById = new Map(decisions.map((decision) => [String(decision.id), decision]));
  const groups = new Map();
  for (const trade of sellTrades) {
    const decision = trade.ai_decision_id
      ? decisionById.get(String(trade.ai_decision_id))
      : null;
    if (!decision || decision.decision !== "SELL") {
      continue;
    }
    const timeframes = decision.indicators?.timeframes;
    if (!timeframes || typeof timeframes !== "object" || Array.isArray(timeframes)) {
      continue;
    }
    for (const [timeframe, indicators] of Object.entries(timeframes)) {
      const strategyName = decision.strategy_name || null;
      const strategyVersion = decision.strategy_version || null;
      const values = {
        ema12: indicators?.trend?.ema12,
        ema26: indicators?.trend?.ema26,
        rsi14: indicators?.rsi14,
        macdLine: indicators?.macd?.line,
        macdSignal: indicators?.macd?.signal,
        macdHistogram: indicators?.macd?.histogram
      };
      for (const [name, rawValue] of Object.entries(values)) {
        if (rawValue === null || rawValue === undefined) {
          continue;
        }
        const value = Number(rawValue);
        if (!Number.isFinite(value)) {
          continue;
        }
        const key = [
          period,
          decision.symbol,
          strategyName || "",
          strategyVersion || "",
          timeframe,
          name
        ].join("\u0000");
        if (!groups.has(key)) {
          groups.set(key, {
            period,
            symbol: decision.symbol,
            strategyName,
            strategyVersion,
            timeframe,
            indicator: name,
            winners: [],
            losers: [],
            breakeven: []
          });
        }
        const group = groups.get(key);
        if (trade.realized_pnl > 0) {
          group.winners.push(value);
        } else if (trade.realized_pnl < 0) {
          group.losers.push(value);
        } else {
          group.breakeven.push(value);
        }
      }
    }
  }
  return [...groups.values()].map((group) => ({
    period: group.period,
    symbol: group.symbol,
    strategyName: group.strategyName,
    strategyVersion: group.strategyVersion,
    timeframe: group.timeframe,
    indicator: group.indicator,
    sampleSize: group.winners.length + group.losers.length + group.breakeven.length,
    winningTradeCount: group.winners.length,
    losingTradeCount: group.losers.length,
    breakevenTradeCount: group.breakeven.length,
    averageValueForWins: averageValues(group.winners),
    averageValueForLosses: averageValues(group.losers),
    averageValueForBreakeven: averageValues(group.breakeven),
    interpretation: "descriptive association; not evidence of causation"
  })).sort((left, right) =>
    left.timeframe.localeCompare(right.timeframe)
    || left.indicator.localeCompare(right.indicator)
  );
}

function averageValues(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function createDecisionGroup(label) {
  return {
    label,
    decisionCount: 0,
    scoredCount: 0,
    closedTradeIds: new Set(),
    wins: 0,
    losses: 0,
    breakeven: 0,
    netPnl: 0
  };
}

function getGroup(groups, label) {
  if (!groups.has(label)) {
    groups.set(label, createDecisionGroup(label));
  }
  return groups.get(label);
}

function addOutcome(group, pnl, tradeId) {
  group.scoredCount += 1;
  group.netPnl += pnl;
  if (tradeId !== undefined && tradeId !== null) {
    group.closedTradeIds.add(String(tradeId));
  }
  if (pnl > 0) {
    group.wins += 1;
  } else if (pnl < 0) {
    group.losses += 1;
  } else {
    group.breakeven += 1;
  }
}

function finalizeDecisionGroup(group) {
  const { closedTradeIds, ...metrics } = group;
  return {
    ...metrics,
    tradeCount: closedTradeIds.size,
    unscoredCount: Math.max(0, group.decisionCount - group.scoredCount),
    winRate: group.scoredCount ? group.wins / group.scoredCount * 100 : null,
    averagePnl: group.scoredCount ? group.netPnl / group.scoredCount : null
  };
}

function createPortfolioAnalytics(portfolio, snapshots, periodStart) {
  const ordered = snapshots.slice().sort((left, right) =>
    Date.parse(left.captured_at) - Date.parse(right.captured_at)
      || compareSnapshotOrder(left.snapshot_order, right.snapshot_order)
  );
  const periodStartMs = Date.parse(periodStart);
  const baseline = ordered.filter(({ captured_at }) =>
    Date.parse(captured_at) < periodStartMs
  ).at(-1) || null;
  const periodSnapshots = ordered.filter(({ captured_at }) =>
    Date.parse(captured_at) >= periodStartMs
  );
  const drawdownSnapshots = baseline ? [baseline, ...periodSnapshots] : periodSnapshots;
  let peak = 0;
  const equityCurve = periodSnapshots.map((snapshot) => ({
    period: snapshot.captured_at,
    snapshotOrder: snapshot.snapshot_order,
    portfolioValue: snapshot.portfolio_value,
    growthPercent: portfolio?.starting_balance
      ? (snapshot.portfolio_value - portfolio.starting_balance) / portfolio.starting_balance * 100
      : null
  }));
  const drawdownHistory = drawdownSnapshots.map((snapshot) => {
    peak = Math.max(peak, snapshot.portfolio_value);
    return {
      period: snapshot.captured_at,
      snapshotOrder: snapshot.snapshot_order,
      drawdownPercent: peak > 0 ? (peak - snapshot.portfolio_value) / peak * 100 : 0
    };
  });
  const baselineValue = baseline?.portfolio_value ?? null;
  const dailyPerformance = summarizeSnapshotPeriods(
    periodSnapshots, "daily", portfolio, baselineValue
  );
  const weeklyPerformance = summarizeSnapshotPeriods(
    periodSnapshots, "weekly", portfolio, baselineValue
  );
  const monthlyPerformance = summarizeSnapshotPeriods(
    periodSnapshots, "monthly", portfolio, baselineValue
  );
  const maxDrawdown = drawdownSnapshots.length > 1
    ? Math.max(...drawdownHistory.map(({ drawdownPercent }) => drawdownPercent))
    : null;
  const firstValue = periodSnapshots[0]?.portfolio_value ?? null;
  const finalValue = periodSnapshots.at(-1)?.portfolio_value ?? null;
  const startingValue = portfolio?.starting_balance ?? null;
  const growthPercent = startingValue
    ? ((portfolio?.portfolio_value ?? startingValue) - startingValue) / startingValue * 100
    : null;

  return {
    growthPercent,
    maxDrawdown,
    maxDrawdownStatus: drawdownSnapshots.length > 1
      ? baseline ? "CALCULATED_WITH_PERIOD_BASELINE"
        : "CALCULATED_WITHIN_AVAILABLE_SNAPSHOT_SAMPLE"
      : "INSUFFICIENT_SNAPSHOTS",
    periodPnl: baselineValue !== null && finalValue !== null
      ? finalValue - baselineValue
      : null,
    periodPnlStatus: baselineValue !== null && finalValue !== null
      ? "CALCULATED_FROM_SNAPSHOTS" : "INSUFFICIENT_BASELINE",
    maximumDrawdownSampleCount: drawdownSnapshots.length,
    snapshotCount: periodSnapshots.length,
    equityCurve,
    drawdownHistory,
    dailyPerformance,
    weeklyPerformance,
    monthlyPerformance
  };
}

function compareSnapshotOrder(left, right) {
  const leftOrder = BigInt(left);
  const rightOrder = BigInt(right);
  return leftOrder < rightOrder ? -1 : leftOrder > rightOrder ? 1 : 0;
}

function summarizeSnapshotPeriods(snapshots, unit, portfolio, baselineValue) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    const date = new Date(snapshot.captured_at);
    const key = unit === "daily" ? date.toISOString().slice(0, 10)
      : unit === "monthly" ? date.toISOString().slice(0, 7)
        : isoWeekKey(date);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(snapshot);
  }
  let previousValue = baselineValue ?? snapshots[0]?.portfolio_value ?? 0;
  return [...groups.entries()].map(([period, rows]) => {
    const lastValue = rows[rows.length - 1].portfolio_value;
    const peak = Math.max(...snapshots
      .filter(({ captured_at }) => captured_at <= rows[rows.length - 1].captured_at)
      .map(({ portfolio_value }) => portfolio_value), lastValue);
    const point = {
      period,
      pnl: lastValue - previousValue,
      portfolioValue: lastValue,
      drawdownPercent: peak > 0 ? (peak - lastValue) / peak * 100 : 0,
      growthPercent: portfolio?.starting_balance
        ? (lastValue - portfolio.starting_balance) / portfolio.starting_balance * 100
        : null
    };
    previousValue = lastValue;
    return point;
  });
}

function isoWeekKey(date) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function extremeTrade(trades, direction) {
  if (trades.length === 0) {
    return null;
  }
  const sort = direction === "max"
    ? (left, right) => right.realized_pnl - left.realized_pnl
    : (left, right) => left.realized_pnl - right.realized_pnl;
  const trade = trades.slice().sort(sort)[0];
  return { symbol: trade.symbol, realizedPnl: trade.realized_pnl };
}

function average(rows, select) {
  return rows.length ? sum(rows, select) / rows.length : null;
}

function sum(rows, select) {
  return rows.reduce((total, row) => total + select(row), 0);
}
