const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
const MAX_RESULTS = 10;

export const MARKET_SCANNER_TIMEFRAMES = Object.freeze({
  "24h": Object.freeze({ durationMs: DAY_MS, momentumMs: 6 * HOUR_MS, momentumLabel: "6h" }),
  "7d": Object.freeze({ durationMs: 7 * DAY_MS, momentumMs: 3 * DAY_MS, momentumLabel: "3d" }),
  "30d": Object.freeze({ durationMs: 30 * DAY_MS, momentumMs: 7 * DAY_MS, momentumLabel: "7d" })
});

const DECISION_PRIORITY = Object.freeze({ BUY: 0, SELL: 1, HOLD: 2, WAIT: 3 });

export function buildMarketScannerSummary({
  activeMarkets,
  marketData,
  dailyCandles,
  hourlyCandles,
  decisions,
  now = new Date()
}) {
  for (const [name, rows] of Object.entries({
    activeMarkets,
    marketData,
    dailyCandles,
    hourlyCandles,
    decisions
  })) {
    if (!Array.isArray(rows)) {
      throw new TypeError(`Scanner ${name} must be an array.`);
    }
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Scanner clock must be a valid Date.");
  }

  const nowMs = now.getTime();
  const markets = normalizeActiveMarkets(activeMarkets);
  const activeSymbols = new Set(markets.map(({ symbol }) => symbol));
  const snapshots = latestSnapshots(marketData, activeSymbols, nowMs);
  const dailyBySymbol = groupCandles(dailyCandles, activeSymbols, "1d", nowMs - 32 * DAY_MS, nowMs);
  const hourlyBySymbol = groupCandles(hourlyCandles, activeSymbols, "1h", nowMs - 10 * HOUR_MS, nowMs);
  const latestDecisions = latestDecisionsBySymbol(decisions, activeSymbols, nowMs);

  const freshMarkets = markets.flatMap((market) => {
    const snapshot = snapshots.get(market.symbol);
    if (!snapshot) {
      return [];
    }
    return [{ ...market, snapshot, dailyCandles: dailyBySymbol.get(market.symbol) || [] }];
  });

  const timeframes = Object.fromEntries(
    Object.entries(MARKET_SCANNER_TIMEFRAMES).map(([timeframe, settings]) => [
      timeframe,
      rankTimeframe({
        timeframe,
        settings,
        markets: freshMarkets,
        hourlyBySymbol,
        latestDecisions,
        nowMs
      })
    ])
  );

  return {
    generatedAt: now.toISOString(),
    activeMarkets: markets.length,
    watchedMarkets: markets,
    marketsWithFreshData: freshMarkets.length,
    marketsWithDecisions: latestDecisions.size,
    timeframes
  };
}

function normalizeActiveMarkets(rows) {
  const markets = new Map();
  for (const row of rows) {
    if (!row || row.enabled !== true || !isMarketSymbol(row.symbol)) {
      continue;
    }
    const priority = finiteNumber(row.priority);
    const current = markets.get(row.symbol);
    if (!current || (priority !== null && priority < current.priority)) {
      markets.set(row.symbol, {
        symbol: row.symbol,
        priority: priority ?? Number.MAX_SAFE_INTEGER
      });
    }
  }
  return [...markets.values()].sort(compareMarketIdentity);
}

function latestSnapshots(rows, activeSymbols, nowMs) {
  const snapshots = new Map();
  for (const row of rows) {
    if (!row || !activeSymbols.has(row.symbol)) {
      continue;
    }
    const capturedAt = timestampValue(row.captured_at);
    const price = finiteNumber(row.price);
    const volume = finiteNumber(row.volume);
    const dailyChange = finiteNumber(row.daily_change);
    if (capturedAt === null || capturedAt > nowMs || nowMs - capturedAt > MAX_SNAPSHOT_AGE_MS
      || price === null || price <= 0 || volume === null || volume < 0 || dailyChange === null) {
      continue;
    }
    const current = snapshots.get(row.symbol);
    if (!current || capturedAt > current.capturedAtMs) {
      snapshots.set(row.symbol, {
        price,
        volume,
        dailyChange,
        capturedAt: new Date(capturedAt).toISOString(),
        capturedAtMs: capturedAt
      });
    }
  }
  return snapshots;
}

function groupCandles(rows, activeSymbols, interval, earliestMs, nowMs) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row || row.interval !== interval || !activeSymbols.has(row.symbol)) {
      continue;
    }
    const timestamp = timestampValue(row.timestamp);
    const close = finiteNumber(row.close);
    const volume = finiteNumber(row.volume);
    if (timestamp === null || timestamp < earliestMs || timestamp > nowMs
      || close === null || close <= 0 || volume === null || volume < 0) {
      continue;
    }
    if (!grouped.has(row.symbol)) {
      grouped.set(row.symbol, []);
    }
    grouped.get(row.symbol).push({ timestamp, close, volume });
  }
  for (const candles of grouped.values()) {
    candles.sort((left, right) => left.timestamp - right.timestamp);
  }
  return grouped;
}

function latestDecisionsBySymbol(rows, activeSymbols, nowMs) {
  const decisions = new Map();
  for (const row of rows) {
    if (!row || !activeSymbols.has(row.symbol)
      || !Object.hasOwn(DECISION_PRIORITY, row.decision)) {
      continue;
    }
    const createdAt = timestampValue(row.created_at);
    const confidence = finiteNumber(row.confidence);
    if (createdAt === null || createdAt > nowMs || confidence === null
      || confidence < 0 || confidence > 100 || typeof row.reason !== "string" || !row.reason.trim()) {
      continue;
    }
    const current = decisions.get(row.symbol);
    if (!current || createdAt > current.createdAtMs
      || (createdAt === current.createdAtMs && String(row.id || "") > String(current.id || ""))) {
      decisions.set(row.symbol, {
        id: row.id || "",
        symbol: row.symbol,
        decision: row.decision,
        confidence,
        reason: row.reason,
        created_at: new Date(createdAt).toISOString(),
        createdAtMs: createdAt
      });
    }
  }
  return decisions;
}

function rankTimeframe({ timeframe, settings, markets, hourlyBySymbol, latestDecisions, nowMs }) {
  const startMs = nowMs - settings.durationMs;
  const momentumStartMs = nowMs - settings.momentumMs;
  const rankedMarkets = markets.map(({ symbol, priority, snapshot, dailyCandles }) => {
    const changePct = timeframe === "24h"
      ? snapshot.dailyChange
      : percentChange(snapshot.price, candleBefore(dailyCandles, startMs, 2 * DAY_MS));
    const volumeEur = timeframe === "24h"
      ? snapshot.volume * snapshot.price
      : sumQuoteVolume(dailyCandles, startMs, nowMs);
    const momentumCandles = timeframe === "24h"
      ? hourlyBySymbol.get(symbol) || []
      : dailyCandles;
    const momentumMaxGapMs = timeframe === "24h" ? 2 * HOUR_MS : 2 * DAY_MS;
    const momentumPct = percentChange(
      latestCandleAtOrBefore(momentumCandles, nowMs, momentumMaxGapMs),
      candleBefore(momentumCandles, momentumStartMs, momentumMaxGapMs)
    );
    return {
      symbol,
      priority,
      price: snapshot.price,
      captured_at: snapshot.capturedAt,
      changePct,
      volumeEur: Number.isFinite(volumeEur) ? volumeEur : null,
      momentumPct,
      momentumLabel: settings.momentumLabel
    };
  });

  const decisions = [...latestDecisions.values()]
    .filter(({ createdAtMs }) => createdAtMs >= startMs)
    .sort((left, right) =>
      right.confidence - left.confidence
      || DECISION_PRIORITY[left.decision] - DECISION_PRIORITY[right.decision]
      || right.createdAtMs - left.createdAtMs
      || left.symbol.localeCompare(right.symbol)
    )
    .slice(0, MAX_RESULTS)
    .map(({ symbol, confidence, decision, reason, created_at }) => ({
      symbol,
      confidence,
      decision,
      reason,
      created_at
    }));

  return {
    topGainers: sortRanking(rankedMarkets, "changePct", "desc"),
    topLosers: sortRanking(rankedMarkets, "changePct", "asc"),
    highestVolume: sortRanking(rankedMarkets, "volumeEur", "desc"),
    strongestMomentum: sortRanking(rankedMarkets, "momentumPct", "desc"),
    aiOpportunities: decisions
  };
}

function sortRanking(rows, metric, direction) {
  return rows
    .filter((row) => row[metric] !== null && Number.isFinite(row[metric]))
    .sort((left, right) =>
      (direction === "asc" ? left[metric] - right[metric] : right[metric] - left[metric])
      || compareMarketIdentity(left, right)
    )
    .slice(0, MAX_RESULTS)
    .map(({ symbol, priority, price, captured_at, changePct, volumeEur, momentumPct, momentumLabel }) => ({
      symbol,
      priority,
      price,
      captured_at,
      changePct,
      volumeEur,
      momentumPct,
      momentumLabel
    }));
}

function sumQuoteVolume(candles, startMs, nowMs) {
  let volumeEur = 0;
  let found = false;
  for (const candle of candles) {
    if (candle.timestamp >= startMs && candle.timestamp <= nowMs) {
      volumeEur += candle.volume * candle.close;
      found = true;
    }
  }
  return found ? volumeEur : null;
}

function candleBefore(candles, targetMs, maxGapMs) {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    if (candle.timestamp <= targetMs) {
      return targetMs - candle.timestamp <= maxGapMs ? candle : null;
    }
  }
  return null;
}

function latestCandleAtOrBefore(candles, targetMs, maxGapMs) {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    if (candle.timestamp <= targetMs) {
      return targetMs - candle.timestamp <= maxGapMs ? candle : null;
    }
  }
  return null;
}

function percentChange(current, baseline) {
  if (!current || !baseline || baseline.close <= 0) {
    return null;
  }
  const currentPrice = typeof current === "number" ? current : current.close;
  return Number.isFinite(currentPrice) && currentPrice > 0
    ? (currentPrice - baseline.close) / baseline.close * 100
    : null;
}

function compareMarketIdentity(left, right) {
  return left.priority - right.priority || left.symbol.localeCompare(right.symbol);
}

function isMarketSymbol(value) {
  return typeof value === "string" && /^[A-Z0-9]+-EUR$/.test(value);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampValue(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
