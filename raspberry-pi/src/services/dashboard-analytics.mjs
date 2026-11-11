const PERIOD_MS = Object.freeze({
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000
});
export const SUPPORTED_DASHBOARD_ANALYTICS_PERIODS = Object.freeze(Object.keys(PERIOD_MS));
const ACTIONS = Object.freeze(["BUY", "SELL", "HOLD", "WAIT"]);
const BUCKETS = Object.freeze([
  Object.freeze({ label: "70–75", min: 70, max: 75 }),
  Object.freeze({ label: "75–80", min: 75, max: 80 }),
  Object.freeze({ label: "80–85", min: 80, max: 85 }),
  Object.freeze({ label: "85+", min: 85, max: 101 })
]);

export function buildDashboardAnalytics({
  period,
  now,
  portfolio,
  positions,
  trades,
  decisions,
  decisionSummary = null,
  snapshots
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
  const aiPerformance = createAiPerformance(decisions, sellTrades, decisionSummary);
  const portfolioAnalytics = createPortfolioAnalytics(portfolio, snapshots);

  return {
    generatedAt,
    period,
    periodStart,
    tradePerformance,
    aiPerformance,
    portfolio: portfolioAnalytics,
    dataQuality: {
      unpairedBuyTrades: tradePerformance.unpairedBuyTrades,
      unmatchedSellTrades: tradePerformance.unmatchedSellTrades,
      unmatchedDecisionTrades: aiPerformance.unmatchedDecisionTrades,
      openTradesWithoutPosition: tradePerformance.openTradesWithoutPosition
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
  const openPositions = positions.filter(({ status }) => status === "OPEN");
  const openSymbols = new Set(openPositions.map(({ symbol }) => symbol));
  const openTradeSymbols = new Set(holdData.openSymbols);

  return {
    closedTrades: sellTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRate: sellTrades.length ? (winningTrades.length / sellTrades.length) * 100 : null,
    lossRate: sellTrades.length ? (losingTrades.length / sellTrades.length) * 100 : null,
    averageWin: average(winningTrades, (trade) => trade.realized_pnl),
    averageLoss: average(losingTrades, (trade) => trade.realized_pnl),
    profitFactor: grossLoss ? grossProfit / grossLoss : null,
    realizedPnl,
    unrealizedPnl: sum(openPositions, (position) => position.unrealized_pnl),
    totalPnl: portfolio ? portfolio.portfolio_value - portfolio.starting_balance : null,
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
  const actions = Object.fromEntries(ACTIONS.map((action) => [action, createDecisionGroup(action)]));
  const strategies = new Map();
  const symbols = new Map();
  const decisionById = new Map();
  let below70Count = decisionSummary?.below70Count ?? 0;
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
      actions[decision.decision].decisionCount += 1;
      getGroup(symbols, normalized.symbol).decisionCount += 1;
      const bucketIndex = BUCKETS.findIndex((bucket) =>
        normalized.confidence >= bucket.min && normalized.confidence < bucket.max
      );
      if (bucketIndex < 0) {
        below70Count += 1;
      } else {
        buckets[bucketIndex].decisionCount += 1;
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
    for (const { label, decisionCount } of decisionSummary.strategies) {
      getGroup(strategies, label).decisionCount = decisionCount;
    }
    for (const { label, decisionCount } of decisionSummary.bySymbol) {
      getGroup(symbols, label).decisionCount = decisionCount;
    }
  }

  for (const trade of trades) {
    const decision = trade.ai_decision_id
      ? decisionById.get(String(trade.ai_decision_id))
      : null;
    if (!decision) {
      unmatchedDecisionTrades += 1;
      continue;
    }
    const bucketIndex = BUCKETS.findIndex((bucket) =>
      decision.confidence >= bucket.min && decision.confidence < bucket.max
    );
    addOutcome(actions[decision.decision], trade.realized_pnl, trade.id);
    if (bucketIndex >= 0) {
      addOutcome(buckets[bucketIndex], trade.realized_pnl, trade.id);
    }
    if (decision.strategy) {
      addOutcome(getGroup(strategies, decision.strategy), trade.realized_pnl, trade.id);
    }
    addOutcome(getGroup(symbols, decision.symbol), trade.realized_pnl, trade.id);
  }

  const finalizedBuckets = buckets.map(finalizeDecisionGroup);
  const scoredBuckets = finalizedBuckets.filter(({ scoredCount }) => scoredCount > 0);
  return {
    decisionCount: decisionSummary?.decisionCount ?? decisions.length,
    below70Count,
    unscoredHoldDecisions: 0,
    unmatchedDecisionTrades,
    confidenceBuckets: finalizedBuckets,
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

function createPortfolioAnalytics(portfolio, snapshots) {
  const ordered = snapshots.slice().sort((left, right) =>
    Date.parse(left.captured_at) - Date.parse(right.captured_at)
  );
  let peak = 0;
  const equityCurve = ordered.map((snapshot) => ({
    period: snapshot.captured_at,
    portfolioValue: snapshot.portfolio_value,
    growthPercent: portfolio?.starting_balance
      ? (snapshot.portfolio_value - portfolio.starting_balance) / portfolio.starting_balance * 100
      : null
  }));
  const drawdownHistory = ordered.map((snapshot) => {
    peak = Math.max(peak, snapshot.portfolio_value);
    return {
      period: snapshot.captured_at,
      drawdownPercent: peak > 0 ? (peak - snapshot.portfolio_value) / peak * 100 : 0
    };
  });
  const dailyPerformance = summarizeSnapshotPeriods(ordered, "daily", portfolio);
  const weeklyPerformance = summarizeSnapshotPeriods(ordered, "weekly", portfolio);
  const monthlyPerformance = summarizeSnapshotPeriods(ordered, "monthly", portfolio);
  const maxDrawdown = drawdownHistory.length
    ? Math.max(...drawdownHistory.map(({ drawdownPercent }) => drawdownPercent))
    : null;
  const finalValue = ordered.at(-1)?.portfolio_value ?? portfolio?.portfolio_value ?? null;
  const startingValue = portfolio?.starting_balance ?? null;
  const growthPercent = startingValue
    ? (finalValue - startingValue) / startingValue * 100
    : null;

  return {
    growthPercent,
    maxDrawdown,
    snapshotCount: ordered.length,
    equityCurve,
    drawdownHistory,
    dailyPerformance,
    weeklyPerformance,
    monthlyPerformance
  };
}

function summarizeSnapshotPeriods(snapshots, unit, portfolio) {
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
  let previousValue = portfolio?.starting_balance ?? snapshots[0]?.portfolio_value ?? 0;
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
