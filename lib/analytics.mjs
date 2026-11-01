import { createPageIterator } from "./exports.mjs";

const confidenceRanges = Object.freeze([
  Object.freeze({ label: "70–75", min: 70, max: 75 }),
  Object.freeze({ label: "75–80", min: 75, max: 80 }),
  Object.freeze({ label: "80–85", min: 80, max: 85 }),
  Object.freeze({ label: "85+", min: 85, max: 101 })
]);
const maximumSeriesPoints = Object.freeze({
  daily: 365,
  weekly: 260,
  monthly: 120
});
const decisionActions = Object.freeze(["BUY", "SELL", "HOLD", "WAIT"]);
const decisionFreshnessMs = 15 * 60 * 1000;
const analyticsPeriods = Object.freeze({
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000
});

export class AnalyticsDataError extends Error {}
export class AnalyticsRequestError extends Error {}

export const ANALYTICS_PERIODS = Object.freeze(Object.keys(analyticsPeriods));

export function createAnalyticsService({ fetchImpl = globalThis.fetch } = {}) {
  async function load({ config, accessToken, now = new Date(), period = "30d" }) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new AnalyticsDataError("The analytics clock is invalid.");
    }
    if (!Object.hasOwn(analyticsPeriods, period)) {
      throw new AnalyticsRequestError("The analytics period is invalid.");
    }
    const periodStart = new Date(now.getTime() - analyticsPeriods[period]);
    const timestampFilters = { created_at: `gte.${periodStart.toISOString()}` };
    const snapshotFilters = { captured_at: `gte.${periodStart.toISOString()}` };

    const portfolios = new Map();
    let startingBalance = 0;
    let currentPortfolioValue = 0;
    await forEachRow({
      config,
      accessToken,
      fetchImpl,
      table: "AI_Crypto_Bot_Portfolios",
      select: "id,starting_balance,portfolio_value",
      order: "id.asc",
      queryName: "analytics.portfolios",
      prefetchPages: 4
    }, (row) => {
      const id = requiredText(row.id, "portfolio ID");
      if (portfolios.has(id)) {
        throw new AnalyticsDataError("Supabase returned a duplicate portfolio.");
      }
      const start = readNumber(row.starting_balance, "starting balance");
      const value = readNumber(row.portfolio_value, "portfolio value");
      if (start < 0 || value < 0) {
        throw new AnalyticsDataError("Supabase returned a negative portfolio value.");
      }
      portfolios.set(id, start);
      startingBalance += start;
      currentPortfolioValue += value;
    });

    const positionData = {
      openCount: 0,
      closedCount: 0,
      unrealizedPnl: 0,
      openPositions: new Map()
    };
    await forEachRow({
      config,
      accessToken,
      fetchImpl,
      table: "AI_Crypto_Bot_Positions",
      select: "portfolio_id,symbol,unrealized_pnl,status",
      order: "portfolio_id.asc,symbol.asc",
      queryName: "analytics.positions",
      prefetchPages: 4
    }, (row) => {
      const portfolioId = requiredText(row.portfolio_id, "position portfolio ID");
      const symbol = requiredText(row.symbol, "position symbol");
      const status = requiredText(row.status, "position status");
      if (!portfolios.has(portfolioId)) {
        throw new AnalyticsDataError("Supabase returned a position without a visible portfolio.");
      }
      if (status === "OPEN") {
        const key = positionKey(portfolioId, symbol);
        if (positionData.openPositions.has(key)) {
          throw new AnalyticsDataError("Supabase returned duplicate open positions for a market.");
        }
        const unrealizedPnl = readNumber(row.unrealized_pnl, "unrealized P&L");
        positionData.openPositions.set(key, unrealizedPnl);
        positionData.openCount += 1;
        positionData.unrealizedPnl += unrealizedPnl;
      } else if (status === "CLOSED") {
        positionData.closedCount += 1;
      } else {
        throw new AnalyticsDataError("Supabase returned an invalid position status.");
      }
    });

    const tradeData = createTradeAccumulator();
    const decisionData = createDecisionAccumulator();
    const tradeIterator = createPageIterator({
      config,
      accessToken,
      fetchImpl,
      table: "AI_Crypto_Bot_Trades",
      select: "id,portfolio_id,ai_decision_id,symbol,side,realized_pnl,created_at",
      order: "symbol.asc,created_at.asc,id.asc",
      filters: timestampFilters,
      queryName: "analytics.trades",
      prefetchPages: 4
    });
    const decisionIterator = createPageIterator({
      config,
      accessToken,
      fetchImpl,
      table: "AI_Crypto_Bot_AI_Decisions",
      select: "id,symbol,decision,confidence,strategy_name,strategy_version,created_at",
      order: "symbol.asc,created_at.asc,id.asc",
      filters: timestampFilters,
      queryName: "analytics.ai-decisions",
      prefetchPages: 4
    });
    const [portfolioData] = await Promise.all([
      loadPortfolioAnalytics({
        config,
        accessToken,
        fetchImpl,
        portfolios,
        startingBalance,
        currentPortfolioValue,
        period,
        snapshotFilters
      }),
      mergeDecisionAndTradeStreams({
        tradeIterator,
        decisionIterator,
        portfolios,
        positionData,
        tradeData,
        decisionData
      })
    ]);
    const closedTrades = tradeData.closedTradeCount;

    return {
      generatedAt: now.toISOString(),
      period,
      periodStart: periodStart.toISOString(),
      tradePerformance: {
        closedTrades,
        winningTrades: tradeData.winningTrades,
        losingTrades: tradeData.losingTrades,
        breakevenTrades: tradeData.breakevenTrades,
        winRate: closedTrades ? tradeData.winningTrades / closedTrades * 100 : null,
        lossRate: closedTrades ? tradeData.losingTrades / closedTrades * 100 : null,
        averageWin: tradeData.winningTrades
          ? tradeData.winningPnl / tradeData.winningTrades
          : null,
        averageLoss: tradeData.losingTrades
          ? tradeData.losingPnl / tradeData.losingTrades
          : null,
        profitFactor: tradeData.grossLoss
          ? tradeData.grossProfit / tradeData.grossLoss
          : null,
        realizedPnl: tradeData.realizedPnl,
        unrealizedPnl: positionData.unrealizedPnl,
        totalPnl: portfolios.size ? currentPortfolioValue - startingBalance : null,
        bestTrade: tradeData.bestTrade,
        worstTrade: tradeData.worstTrade,
        largestWinner: tradeData.largestWinner,
        largestLoser: tradeData.largestLoser,
        averageHoldTimeSeconds: tradeData.holdDurationCount
          ? tradeData.holdDurationSeconds / tradeData.holdDurationCount
          : null,
        openPositions: positionData.openCount,
        closedPositions: positionData.closedCount,
        bySymbol: finalizeSymbolStats(tradeData.symbols),
        bestSymbols: finalizeSymbolStats(tradeData.symbols)
          .filter((symbol) => symbol.closedTrades > 0)
          .slice()
          .sort((left, right) => right.realizedPnl - left.realizedPnl)
          .slice(0, 5),
        worstSymbols: finalizeSymbolStats(tradeData.symbols)
          .filter((symbol) => symbol.closedTrades > 0)
          .slice()
          .sort((left, right) => left.realizedPnl - right.realizedPnl)
          .slice(0, 5)
      },
      aiPerformance: finalizeDecisionAnalytics(decisionData),
      portfolio: portfolioData,
      dataQuality: {
        unpairedBuyTrades: tradeData.unpairedBuyTrades,
        unmatchedSellTrades: tradeData.unmatchedSellTrades,
        unmatchedDecisionTrades: tradeData.unmatchedDecisionTrades,
        openTradesWithoutPosition: tradeData.openTradesWithoutPosition
      }
    };
  }

  return { load };
}

async function mergeDecisionAndTradeStreams({
  tradeIterator,
  decisionIterator,
  portfolios,
  positionData,
  tradeData,
  decisionData
}) {
  const tradeQuery = {
    queryName: "analytics.trades",
    tableName: "AI_Crypto_Bot_Trades"
  };
  const decisionQuery = {
    queryName: "analytics.ai-decisions",
    tableName: "AI_Crypto_Bot_AI_Decisions"
  };
  let activeQuery = tradeQuery;
  try {
  let tradeResult = await tradeIterator.next();
  activeQuery = decisionQuery;
  let decisionResult = await decisionIterator.next();
  const pendingDecisions = new Map();
  const pendingBySymbol = new Map();
  const activePositions = new Map();
  let activeSymbol = null;

  while (!tradeResult.done || !decisionResult.done) {
    const useDecision = !decisionResult.done && (
      tradeResult.done || compareDecisionToTrade(decisionResult.value, tradeResult.value) <= 0
    );
    activeQuery = useDecision ? decisionQuery : tradeQuery;
    const row = useDecision ? decisionResult.value : tradeResult.value;
    const symbol = requiredText(row.symbol, "analytics symbol");
    const eventTimestamp = readTimestamp(row.created_at, "analytics timestamp");

    if (activeSymbol !== null && activeSymbol !== symbol) {
      removeSymbolPendingDecisions(activeSymbol, pendingBySymbol, pendingDecisions);
    }
    activeSymbol = symbol;
    pruneExpiredDecisions(symbol, eventTimestamp, pendingBySymbol, pendingDecisions);

    if (useDecision) {
      const decision = normalizeDecision(row);
      registerDecision(decision, decisionData);
      if (decision.decision === "HOLD") {
        const openCycles = [...activePositions.values()]
          .filter((cycle) => cycle.symbol === symbol);
        if (!openCycles.length) {
          decisionData.unscoredHoldDecisions += 1;
        } else {
          for (const cycle of openCycles) {
            addPendingHold(cycle, decision);
          }
        }
      } else if (decision.decision === "BUY" || decision.decision === "SELL") {
        pendingDecisions.set(decision.id, decision);
        const queue = pendingBySymbol.get(symbol) || [];
        queue.push({ id: decision.id, timestamp: decision.timestamp });
        pendingBySymbol.set(symbol, queue);
      }
      decisionResult = await decisionIterator.next();
    } else {
      processTrade(
        row,
        eventTimestamp,
        portfolios,
        positionData,
        tradeData,
        decisionData,
        pendingDecisions,
        activePositions
      );
      tradeResult = await tradeIterator.next();
    }
  }

  for (const cycle of activePositions.values()) {
    const key = positionKey(cycle.portfolioId, cycle.symbol);
    const currentPnl = positionData.openPositions.get(key);
    if (currentPnl === undefined) {
      tradeData.openTradesWithoutPosition += 1;
      tradeData.unpairedBuyTrades += 1;
      continue;
    }
    if (cycle.buyDecision) {
      addDecisionOutcome(decisionData, cycle.buyDecision, currentPnl, true);
    }
    resolvePendingHolds(decisionData, cycle, currentPnl, true);
  }
  } catch (error) {
    throw addAnalyticsQueryDiagnostics(error, activeQuery);
  }
}

function compareDecisionToTrade(decision, trade) {
  const symbolOrder = String(decision.symbol).localeCompare(String(trade.symbol));
  if (symbolOrder !== 0) {
    return symbolOrder;
  }
  const timeOrder = readTimestamp(decision.created_at, "decision timestamp")
    - readTimestamp(trade.created_at, "trade timestamp");
  if (timeOrder !== 0) {
    return timeOrder;
  }
  return -1;
}

function processTrade(
  row,
  timestamp,
  portfolios,
  positionData,
  tradeData,
  decisionData,
  pendingDecisions,
  activePositions
) {
  const portfolioId = requiredText(row.portfolio_id, "trade portfolio ID");
  const id = requiredText(row.id, "trade ID");
  const symbol = requiredText(row.symbol, "trade symbol");
  const side = requiredText(row.side, "trade side");
  if (!portfolios.has(portfolioId)) {
    throw new AnalyticsDataError("Supabase returned a trade without a visible portfolio.");
  }
  if (side !== "BUY" && side !== "SELL") {
    throw new AnalyticsDataError("Supabase returned an invalid trade side.");
  }

  const linkedDecision = typeof row.ai_decision_id === "string"
    ? pendingDecisions.get(row.ai_decision_id) || null
    : null;
  if (linkedDecision) {
    pendingDecisions.delete(linkedDecision.id);
  } else if (row.ai_decision_id) {
    tradeData.unmatchedDecisionTrades += 1;
  }

  const key = positionKey(portfolioId, symbol);
  if (side === "BUY") {
    if (linkedDecision && linkedDecision.decision !== "BUY") {
      tradeData.unmatchedDecisionTrades += 1;
    }
    if (activePositions.has(key)) {
      tradeData.unpairedBuyTrades += 1;
      return;
    }
    activePositions.set(key, {
      id,
      portfolioId,
      symbol,
      createdAt: timestamp,
      buyDecision: linkedDecision && linkedDecision.decision === "BUY" ? linkedDecision : null,
      pendingHolds: new Map()
    });
    return;
  }

  const realizedPnl = readNumber(row.realized_pnl, "realized P&L");
  recordClosedTrade(tradeData, symbol, realizedPnl, row.created_at);
  const cycle = activePositions.get(key);
  if (cycle) {
    const durationSeconds = (timestamp - cycle.createdAt) / 1000;
    if (durationSeconds >= 0) {
      tradeData.holdDurationSeconds += durationSeconds;
      tradeData.holdDurationCount += 1;
      addSymbolHoldDuration(tradeData.symbols, symbol, durationSeconds);
    } else {
      tradeData.unmatchedSellTrades += 1;
    }
    if (cycle.buyDecision) {
      addDecisionOutcome(decisionData, cycle.buyDecision, realizedPnl, false);
    }
    resolvePendingHolds(decisionData, cycle, realizedPnl, false);
    activePositions.delete(key);
  } else {
    tradeData.unmatchedSellTrades += 1;
  }

  if (linkedDecision && linkedDecision.decision === "SELL") {
    addDecisionOutcome(decisionData, linkedDecision, realizedPnl, false);
  } else if (linkedDecision) {
    tradeData.unmatchedDecisionTrades += 1;
  }
}

function recordClosedTrade(tradeData, symbol, pnl, date) {
  tradeData.closedTradeCount += 1;
  tradeData.realizedPnl += pnl;
  const stats = tradeData.symbols.get(symbol) || createSymbolAccumulator(symbol);
  stats.closedTrades += 1;
  stats.realizedPnl += pnl;
  if (pnl > 0) {
    tradeData.winningTrades += 1;
    tradeData.winningPnl += pnl;
    tradeData.grossProfit += pnl;
    stats.winningTrades += 1;
    stats.winningPnl += pnl;
    if (!tradeData.largestWinner || pnl > tradeData.largestWinner.realizedPnl) {
      tradeData.largestWinner = { symbol, date, realizedPnl: pnl };
    }
    if (!stats.largestWinner || pnl > stats.largestWinner) {
      stats.largestWinner = pnl;
    }
  } else if (pnl < 0) {
    tradeData.losingTrades += 1;
    tradeData.losingPnl += pnl;
    tradeData.grossLoss += Math.abs(pnl);
    stats.losingTrades += 1;
    stats.losingPnl += pnl;
    if (!tradeData.largestLoser || pnl < tradeData.largestLoser.realizedPnl) {
      tradeData.largestLoser = { symbol, date, realizedPnl: pnl };
    }
    if (!stats.largestLoser || pnl < stats.largestLoser) {
      stats.largestLoser = pnl;
    }
  } else {
    tradeData.breakevenTrades += 1;
    stats.breakevenTrades += 1;
  }
  if (!tradeData.bestTrade || pnl > tradeData.bestTrade.realizedPnl) {
    tradeData.bestTrade = { symbol, date, realizedPnl: pnl };
  }
  if (!tradeData.worstTrade || pnl < tradeData.worstTrade.realizedPnl) {
    tradeData.worstTrade = { symbol, date, realizedPnl: pnl };
  }
  tradeData.symbols.set(symbol, stats);
}

function createTradeAccumulator() {
  return {
    closedTradeCount: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakevenTrades: 0,
    realizedPnl: 0,
    winningPnl: 0,
    losingPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    largestWinner: null,
    largestLoser: null,
    bestTrade: null,
    worstTrade: null,
    holdDurationSeconds: 0,
    holdDurationCount: 0,
    symbols: new Map(),
    unpairedBuyTrades: 0,
    unmatchedSellTrades: 0,
    unmatchedDecisionTrades: 0,
    openTradesWithoutPosition: 0
  };
}

function createSymbolAccumulator(symbol) {
  return {
    symbol,
    closedTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakevenTrades: 0,
    realizedPnl: 0,
    winningPnl: 0,
    losingPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    largestWinner: null,
    largestLoser: null,
    holdDurationSeconds: 0,
    holdDurationCount: 0
  };
}

function addSymbolHoldDuration(symbols, symbol, durationSeconds) {
  const stats = symbols.get(symbol);
  if (!stats) {
    throw new AnalyticsDataError("A closed trade has no symbol summary.");
  }
  stats.holdDurationSeconds += durationSeconds;
  stats.holdDurationCount += 1;
}

function createDecisionAccumulator() {
  const confidenceBuckets = confidenceRanges.map(({ label }) => ({
    label,
    decisionCount: 0,
    scoredCount: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    netPnl: 0,
    unrealizedCount: 0
  }));
  const actions = Object.fromEntries(decisionActions.map((action) => [
    action,
    createDecisionGroup(action)
  ]));
  return {
    decisionCount: 0,
    below70Count: 0,
    unscoredHoldDecisions: 0,
    confidenceBuckets,
    actions,
    strategies: new Map(),
    symbols: new Map()
  };
}

function createDecisionGroup(label) {
  return {
    label,
    decisionCount: 0,
    scoredCount: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    netPnl: 0,
    unrealizedCount: 0
  };
}

function registerDecision(decision, data) {
  data.decisionCount += 1;
  const actionGroup = data.actions[decision.decision];
  actionGroup.decisionCount += 1;
  if (decision.bucketIndex === null) {
    data.below70Count += 1;
  } else {
    data.confidenceBuckets[decision.bucketIndex].decisionCount += 1;
  }
  const symbolGroup = getOrCreateGroup(data.symbols, decision.symbol, decision.symbol);
  symbolGroup.decisionCount += 1;
  if (decision.strategyName) {
    const key = `${decision.strategyName}\u0000${decision.strategyVersion}`;
    const group = getOrCreateGroup(data.strategies, key, `${decision.strategyName} · ${decision.strategyVersion}`);
    group.decisionCount += 1;
  }
}

function addPendingHold(cycle, decision) {
  const strategyKey = decision.strategyName
    ? `${decision.strategyName}\u0000${decision.strategyVersion}`
    : "";
  const key = JSON.stringify([decision.bucketIndex, strategyKey]);
  const current = cycle.pendingHolds.get(key);
  if (current) {
    current.count += 1;
  } else {
    cycle.pendingHolds.set(key, { decision, count: 1 });
  }
}

function resolvePendingHolds(data, cycle, pnl, unrealized) {
  for (const { decision, count } of cycle.pendingHolds.values()) {
    addDecisionOutcome(data, decision, pnl, unrealized, count);
  }
  cycle.pendingHolds.clear();
}

function addDecisionOutcome(data, decision, pnl, unrealized, count = 1) {
  const groups = [
    data.actions[decision.decision],
    decision.bucketIndex === null ? null : data.confidenceBuckets[decision.bucketIndex],
    getOrCreateGroup(data.symbols, decision.symbol, decision.symbol),
    decision.strategyName
      ? getOrCreateGroup(
        data.strategies,
        `${decision.strategyName}\u0000${decision.strategyVersion}`,
        `${decision.strategyName} · ${decision.strategyVersion}`
      )
      : null
  ];
  for (const group of groups) {
    if (group) {
      recordDecisionPnl(group, pnl, unrealized, count);
    }
  }
}

function recordDecisionPnl(group, pnl, unrealized, count) {
  group.scoredCount += count;
  group.netPnl += pnl * count;
  if (pnl > 0) {
    group.wins += count;
  } else if (pnl < 0) {
    group.losses += count;
  } else {
    group.breakeven += count;
  }
  if (unrealized) {
    group.unrealizedCount += count;
  }
}

function getOrCreateGroup(groups, key, label) {
  if (!groups.has(key)) {
    groups.set(key, createDecisionGroup(label));
  }
  return groups.get(key);
}

function normalizeDecision(row) {
  const id = requiredText(row.id, "decision ID");
  const symbol = requiredText(row.symbol, "decision symbol");
  const decision = requiredText(row.decision, "decision action");
  if (!decisionActions.includes(decision)) {
    throw new AnalyticsDataError("Supabase returned an invalid AI decision.");
  }
  const confidence = readNumber(row.confidence, "decision confidence");
  if (confidence < 0 || confidence > 100) {
    throw new AnalyticsDataError("Supabase returned an out-of-range AI confidence.");
  }
  const strategyName = optionalText(row.strategy_name, "strategy name");
  const strategyVersion = optionalText(row.strategy_version, "strategy version");
  if ((strategyName === null) !== (strategyVersion === null)) {
    throw new AnalyticsDataError("Supabase returned an incomplete strategy version.");
  }
  return {
    id,
    symbol,
    decision,
    confidence,
    bucketIndex: confidenceBucketIndex(confidence),
    strategyName,
    strategyVersion,
    timestamp: readTimestamp(row.created_at, "decision timestamp")
  };
}

function confidenceBucketIndex(confidence) {
  if (confidence < 70) {
    return null;
  }
  return confidenceRanges.findIndex(({ min, max }) => confidence >= min && confidence < max);
}

function finalizeDecisionAnalytics(data) {
  const finalizeGroup = (group) => ({
    ...group,
    winRate: group.scoredCount
      ? group.wins / group.scoredCount * 100
      : null,
    averagePnl: group.scoredCount
      ? group.netPnl / group.scoredCount
      : null,
    unscoredCount: Math.max(0, group.decisionCount - group.scoredCount)
  });
  const confidenceBuckets = data.confidenceBuckets.map(finalizeGroup);
  const scoredBuckets = confidenceBuckets.filter((bucket) => bucket.scoredCount > 0);
  const bestConfidenceRange = scoredBuckets.slice().sort((left, right) =>
    right.averagePnl - left.averagePnl || right.scoredCount - left.scoredCount
  )[0] || null;
  const worstConfidenceRange = scoredBuckets.slice().sort((left, right) =>
    left.averagePnl - right.averagePnl || right.scoredCount - left.scoredCount
  )[0] || null;
  const actions = Object.fromEntries(decisionActions.map((action) => [
    action,
    finalizeGroup(data.actions[action])
  ]));
  return {
    decisionCount: data.decisionCount,
    below70Count: data.below70Count,
    unscoredHoldDecisions: data.unscoredHoldDecisions,
    confidenceBuckets,
    bestConfidenceRange,
    worstConfidenceRange,
    actions,
    strategies: [...data.strategies.values()]
      .map(finalizeGroup)
      .sort((left, right) => right.netPnl - left.netPnl || right.decisionCount - left.decisionCount),
    bySymbol: [...data.symbols.values()]
      .map(finalizeGroup)
      .sort((left, right) => right.netPnl - left.netPnl || right.decisionCount - left.decisionCount)
  };
}

function finalizeSymbolStats(symbols) {
  return [...symbols.values()].map((stats) => ({
    symbol: stats.symbol,
    closedTrades: stats.closedTrades,
    winningTrades: stats.winningTrades,
    losingTrades: stats.losingTrades,
    breakevenTrades: stats.breakevenTrades,
    winRate: stats.closedTrades ? stats.winningTrades / stats.closedTrades * 100 : null,
    averageWin: stats.winningTrades ? stats.winningPnl / stats.winningTrades : null,
    averageLoss: stats.losingTrades ? stats.losingPnl / stats.losingTrades : null,
    profitFactor: stats.grossLoss ? stats.grossProfit / stats.grossLoss : null,
    realizedPnl: stats.realizedPnl,
    largestWinner: stats.largestWinner,
    largestLoser: stats.largestLoser,
    averageHoldTimeSeconds: stats.holdDurationCount
      ? stats.holdDurationSeconds / stats.holdDurationCount
      : null
  })).sort((left, right) => right.realizedPnl - left.realizedPnl || left.symbol.localeCompare(right.symbol));
}

async function loadPortfolioAnalytics({
  config,
  accessToken,
  fetchImpl,
  portfolios,
  startingBalance,
  currentPortfolioValue,
  period,
  snapshotFilters
}) {
  const currentValues = new Map([...portfolios].map(([id, value]) => [id, value]));
  let currentEquity = startingBalance;
  let peakEquity = startingBalance;
  let periodStartEquity = startingBalance;
  let maxDrawdown = null;
  let snapshotCount = 0;
  let pendingTimestamp = null;
  let pendingRows = [];
  let day = null;
  let lastDailyEquity = startingBalance;
  let dailyPerformance = [];
  let weeklyPerformance = [];
  let monthlyPerformance = [];
  let week = null;
  let month = null;

  const flushPeriod = (period, target) => {
    if (!period) {
      return null;
    }
    target.push({
      period: period.label,
      portfolioValue: period.endValue,
      pnl: period.endValue - period.startValue
    });
    if (target.length > maximumSeriesPoints[period.kind]) {
      target.shift();
    }
    return null;
  };
  const flushDay = () => {
    if (!day) {
      return;
    }
    const daily = {
      period: day.label,
      portfolioValue: day.endValue,
      pnl: day.endValue - lastDailyEquity,
      drawdownPercent: day.drawdownPercent,
      growthPercent: periodStartEquity > 0
        ? (day.endValue - periodStartEquity) / periodStartEquity * 100
        : null
    };
    dailyPerformance.push(daily);
    if (dailyPerformance.length > maximumSeriesPoints.daily) {
      dailyPerformance.shift();
    }

    const weekLabel = getWeekStart(day.label);
    if (week && week.label !== weekLabel) {
      week = flushPeriod(week, weeklyPerformance);
    }
    if (!week) {
      week = {
        kind: "weekly",
        label: weekLabel,
        startValue: lastDailyEquity,
        endValue: day.endValue
      };
    } else {
      week.endValue = day.endValue;
    }

    const monthLabel = day.label.slice(0, 7);
    if (month && month.label !== monthLabel) {
      month = flushPeriod(month, monthlyPerformance);
    }
    if (!month) {
      month = {
        kind: "monthly",
        label: monthLabel,
        startValue: lastDailyEquity,
        endValue: day.endValue
      };
    } else {
      month.endValue = day.endValue;
    }
    lastDailyEquity = day.endValue;
    day = null;
  };
  const flushSnapshotGroup = () => {
    if (!pendingRows.length) {
      return;
    }
    for (const row of pendingRows) {
      const portfolioId = requiredText(row.portfolio_id, "snapshot portfolio ID");
      if (!currentValues.has(portfolioId)) {
        throw new AnalyticsDataError("Supabase returned a snapshot without a visible portfolio.");
      }
      const value = readNumber(row.portfolio_value, "snapshot portfolio value");
      if (value < 0) {
        throw new AnalyticsDataError("Supabase returned a negative snapshot value.");
      }
      currentEquity += value - currentValues.get(portfolioId);
      currentValues.set(portfolioId, value);
      snapshotCount += 1;
    }
    if (snapshotCount === pendingRows.length) {
      periodStartEquity = currentEquity;
      lastDailyEquity = currentEquity;
      peakEquity = currentEquity;
      maxDrawdown = 0;
    }
    const timestamp = pendingTimestamp;
    const drawdownPercent = peakEquity > 0
      ? Math.max(0, (peakEquity - currentEquity) / peakEquity * 100)
      : 0;
    peakEquity = Math.max(peakEquity, currentEquity);
    maxDrawdown = maxDrawdown === null
      ? drawdownPercent
      : Math.max(maxDrawdown, drawdownPercent);
    const label = new Date(timestamp).toISOString().slice(0, 10);
    if (day && day.label !== label) {
      flushDay();
    }
    if (!day) {
      day = { label, endValue: currentEquity, drawdownPercent };
    } else {
      day.endValue = currentEquity;
      day.drawdownPercent = Math.max(day.drawdownPercent, drawdownPercent);
    }
    pendingRows = [];
    pendingTimestamp = null;
  };

  try {
    for await (const row of createPageIterator({
      config,
      accessToken,
      fetchImpl,
      table: "AI_Crypto_Bot_Portfolio_Snapshots",
      select: "id,portfolio_id,portfolio_value,captured_at",
      order: "captured_at.asc,id.asc",
      filters: snapshotFilters,
      queryName: "analytics.portfolio-snapshots",
      prefetchPages: 4
    })) {
      const timestamp = requiredText(row.captured_at, "snapshot timestamp");
      readTimestamp(timestamp, "snapshot timestamp");
      if (pendingTimestamp !== null && pendingTimestamp !== timestamp) {
        flushSnapshotGroup();
      }
      pendingTimestamp = timestamp;
      pendingRows.push(row);
    }
  } catch (error) {
    throw addAnalyticsQueryDiagnostics(error, {
      queryName: "analytics.portfolio-snapshots",
      tableName: "AI_Crypto_Bot_Portfolio_Snapshots"
    });
  }
  flushSnapshotGroup();
  flushDay();
  week = flushPeriod(week, weeklyPerformance);
  month = flushPeriod(month, monthlyPerformance);

  return {
    period,
    portfolioCount: portfolios.size,
    startingBalance: portfolios.size ? startingBalance : null,
    portfolioValue: portfolios.size ? currentPortfolioValue : null,
    totalPnl: portfolios.size ? currentPortfolioValue - startingBalance : null,
    growthPercent: startingBalance > 0 && portfolios.size
      ? (currentPortfolioValue - startingBalance) / startingBalance * 100
      : null,
    snapshotCount,
    maxDrawdown,
    equityCurve: dailyPerformance.map(({ period, portfolioValue: value, growthPercent }) => ({
      period,
      portfolioValue: value,
      growthPercent
    })),
    drawdownHistory: dailyPerformance.map(({ period, drawdownPercent }) => ({
      period,
      drawdownPercent
    })),
    dailyPerformance,
    weeklyPerformance,
    monthlyPerformance
  };
}

async function forEachRow(options, onRow) {
  const context = {
    queryName: options.queryName,
    tableName: options.table
  };
  try {
    for await (const row of createPageIterator(options)) {
      onRow(row);
    }
  } catch (error) {
    throw addAnalyticsQueryDiagnostics(error, context);
  }
}

function addAnalyticsQueryDiagnostics(error, context) {
  if (error && typeof error === "object") {
    if (!error.analyticsDiagnostics) {
      error.analyticsDiagnostics = {
        queryName: context.queryName,
        tableName: context.tableName,
        operationName: "PROCESS",
        pageNumber: null,
        range: null,
        httpStatus: null,
        databaseCode: null,
        failureCategory: "DATA_VALIDATION"
      };
    }
    return error;
  }
  const validationError = new AnalyticsDataError("Analytics data processing failed.");
  validationError.analyticsDiagnostics = {
    queryName: context.queryName,
    tableName: context.tableName,
    operationName: "PROCESS",
    pageNumber: null,
    range: null,
    httpStatus: null,
    databaseCode: null,
    failureCategory: "DATA_VALIDATION"
  };
  return validationError;
}

function pruneExpiredDecisions(symbol, timestamp, queues, pendingDecisions) {
  const queue = queues.get(symbol);
  if (!queue) {
    return;
  }
  while (queue.length && timestamp - queue[0].timestamp > decisionFreshnessMs) {
    const expired = queue.shift();
    pendingDecisions.delete(expired.id);
  }
  if (!queue.length) {
    queues.delete(symbol);
  }
}

function removeSymbolPendingDecisions(symbol, queues, pendingDecisions) {
  const queue = queues.get(symbol) || [];
  for (const entry of queue) {
    pendingDecisions.delete(entry.id);
  }
  queues.delete(symbol);
}

function positionKey(portfolioId, symbol) {
  return `${portfolioId}\u0000${symbol}`;
}

function getWeekStart(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 1);
  return date.toISOString().slice(0, 10);
}

function readNumber(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new AnalyticsDataError(`Supabase returned an invalid ${field}.`);
  }
  return number;
}

function readTimestamp(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AnalyticsDataError(`Supabase returned an invalid ${field}.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new AnalyticsDataError(`Supabase returned an invalid ${field}.`);
  }
  return timestamp;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AnalyticsDataError(`Supabase returned an invalid ${field}.`);
  }
  return value;
}

function optionalText(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  return requiredText(value, field);
}
