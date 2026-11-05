const STATUS_TABLE = "AI_Crypto_Bot_Status";
const MARKETS_TABLE = "AI_Crypto_Bot_Watched_Markets";
const MARKET_DATA_TABLE = "AI_Crypto_Bot_Market_Data";
const AI_CANDLES_RPC = "AI_Crypto_Bot_Get_Latest_AI_Candles";
const DECISIONS_TABLE = "AI_Crypto_Bot_AI_Decisions";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ACTIVE_MARKETS = 2000;
const MAX_CANDLES_PER_INTERVAL = 150;
const CANDLE_QUERY_CONCURRENCY = 24;
const CANDLE_MARKET_BATCH_SIZE = 4;
const MIN_CANDLES_PER_TIMEFRAME = 26;
const MIN_TIMEFRAMES_FOR_ANALYSIS = 2;
const MIN_CONFIDENCE_FOR_SIGNAL = 65;
const MARKET_DATA_MAX_AGE_MS = 15 * 60 * 1000;
const ANALYZER_NAME = "Deterministic Technical Analysis";
const ANALYZER_VERSION = "1.0.0";
const INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
const CANDLE_MAX_AGE_MS = Object.freeze({
  "1m": 30 * 60 * 1000,
  "5m": 2 * 60 * 60 * 1000,
  "15m": 6 * 60 * 60 * 1000,
  "1h": 12 * 60 * 60 * 1000,
  "4h": 24 * 60 * 60 * 1000,
  "1d": 72 * 60 * 60 * 1000
});
const TIMEFRAME_WEIGHTS = Object.freeze({
  "1m": 0.05,
  "5m": 0.1,
  "15m": 0.15,
  "1h": 0.25,
  "4h": 0.3,
  "1d": 0.15
});

export function createAIEngineService({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  logger = console
} = {}) {
  async function runAnalysis({ config, serviceRoleKey }) {
    const runStartedAt = performance.now();
    const statusReadStartedAt = performance.now();
    const currentTime = readNow();
    const statusRows = await fetchRows(config, serviceRoleKey, STATUS_TABLE, {
      select: "status",
      singleton: "eq.true",
      limit: "1"
    }, fetchImpl);
    const statusReadMs = elapsedMs(statusReadStartedAt);
    if (!statusRows[0] || !isAgentStatus(statusRows[0].status)) {
      throw new AIEngineError("INVALID_AGENT_STATUS", "The agent status row is missing or invalid.");
    }
    if (statusRows[0].status === "STOPPED") {
      return {
        status: "STOPPED",
        skipped: true,
        analyzedMarkets: 0,
        decisionsStored: 0
      };
    }
    if (statusRows[0].status === "ANALYZING") {
      return {
        status: "ANALYZING",
        skipped: true,
        analyzedMarkets: 0,
        decisionsStored: 0
      };
    }

    const analyzingStatusWriteStartedAt = performance.now();
    await updateAgentStatus(config, serviceRoleKey, {
      status: "ANALYZING",
      is_active: true,
      is_analyzing: true,
      last_run: currentTime.toISOString(),
      updated_at: currentTime.toISOString(),
      error_message: null
    }, fetchImpl);
    const analyzingStatusWriteMs = elapsedMs(analyzingStatusWriteStartedAt);

    try {
      const marketLoadStartedAt = performance.now();
      const markets = await fetchRows(config, serviceRoleKey, MARKETS_TABLE, {
        select: "symbol,enabled,priority",
        enabled: "eq.true",
        order: "priority.asc,symbol.asc",
        limit: String(MAX_ACTIVE_MARKETS)
      }, fetchImpl);
      const marketLoadMs = elapsedMs(marketLoadStartedAt);
      validateMarkets(markets);

      if (markets.length === 0) {
        const completedAt = readNow().toISOString();
        const completedStatusWriteStartedAt = performance.now();
        await updateAgentStatus(config, serviceRoleKey, {
          status: "IDLE",
          is_active: false,
          is_analyzing: false,
          last_run: completedAt,
          updated_at: completedAt,
          error_message: null
        }, fetchImpl);
        const completedStatusWriteMs = elapsedMs(completedStatusWriteStartedAt);
        logAnalysisSummary(logger, {
          analyzedMarkets: 0,
          decisions: [],
          candleReads: 0,
          candlesLoaded: 0,
          runtimeMs: elapsedMs(runStartedAt),
          timingMs: {
            statusRead: statusReadMs,
            analyzingStatusWrite: analyzingStatusWriteMs,
            marketLoad: marketLoadMs,
            snapshotLoad: 0,
            candleLoad: 0,
            decisionGeneration: 0,
            decisionWrite: 0,
            completedStatusWrite: completedStatusWriteMs
          }
        });
        return {
          status: "IDLE",
          analyzedMarkets: 0,
          decisionsStored: 0
        };
      }

      const snapshotLoadStartedAt = performance.now();
      const marketDataRows = await fetchRows(config, serviceRoleKey, MARKET_DATA_TABLE, {
        select: "symbol,price,volume,daily_change,high_24h,low_24h,captured_at",
        limit: String(MAX_ACTIVE_MARKETS)
      }, fetchImpl);
      const snapshotLoadMs = elapsedMs(snapshotLoadStartedAt);
      validateMarketDataRows(marketDataRows);
      const marketDataBySymbol = new Map(marketDataRows.map((row) => [row.symbol, row]));
      const candleLoadStartedAt = performance.now();
      const { candlesBySymbol, candleQueries } = await fetchCandlesForMarkets(
        config,
        serviceRoleKey,
        markets,
        fetchImpl
      );
      const candleLoadMs = elapsedMs(candleLoadStartedAt);
      const candlesLoaded = Array.from(candlesBySymbol.values())
        .reduce((total, candles) => total + candles.length, 0);
      const decisionGenerationStartedAt = performance.now();
      const decisions = markets.map((market) => analyzeMarket({
        symbol: market.symbol,
        marketData: marketDataBySymbol.get(market.symbol) || null,
        candles: candlesBySymbol.get(market.symbol) || [],
        now: currentTime
      }));
      const decisionGenerationMs = elapsedMs(decisionGenerationStartedAt);

      const decisionWriteStartedAt = performance.now();
      if (decisions.length) {
        await writeDecisions(config, serviceRoleKey, decisions, fetchImpl);
      }
      const decisionWriteMs = elapsedMs(decisionWriteStartedAt);

      const completedAt = readNow().toISOString();
      const completedStatusWriteStartedAt = performance.now();
      await updateAgentStatus(config, serviceRoleKey, {
        status: "ACTIVE",
        is_active: true,
        is_analyzing: false,
        last_run: completedAt,
        updated_at: completedAt,
        error_message: null
      }, fetchImpl);
      const completedStatusWriteMs = elapsedMs(completedStatusWriteStartedAt);
      logAnalysisSummary(logger, {
        analyzedMarkets: markets.length,
        decisions,
        candleReads: markets.length * INTERVALS.length,
        candleQueries,
        candlesLoaded,
        runtimeMs: elapsedMs(runStartedAt),
        timingMs: {
          statusRead: statusReadMs,
          analyzingStatusWrite: analyzingStatusWriteMs,
          marketLoad: marketLoadMs,
          snapshotLoad: snapshotLoadMs,
          candleLoad: candleLoadMs,
          decisionGeneration: decisionGenerationMs,
          decisionWrite: decisionWriteMs,
          completedStatusWrite: completedStatusWriteMs
        }
      });
      return {
        status: "ACTIVE",
        analyzedMarkets: markets.length,
        decisionsStored: decisions.length,
        waitingDecisions: decisions.filter(({ decision }) => decision === "WAIT").length
      };
    } catch (error) {
      const errorCode = getErrorCode(error);
      logFailure(logger, "AI analysis failed.", errorCode, {
        runtimeMs: elapsedMs(runStartedAt)
      });
      try {
        const failedAt = readNow().toISOString();
        await updateAgentStatus(config, serviceRoleKey, {
          status: "ERROR",
          is_active: false,
          is_analyzing: false,
          last_run: failedAt,
          updated_at: failedAt,
          error_message: `AI analysis failed (${errorCode}).`
        }, fetchImpl);
      } catch (statusError) {
        logFailure(logger, "AI error status could not be persisted.", getErrorCode(statusError));
      }
      throw error;
    }
  }

  function readNow() {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AIEngineError("INVALID_CLOCK", "The AI engine clock returned an invalid time.");
    }
    return value;
  }

  return { runAnalysis };
}

export function analyzeMarket({ symbol, marketData, candles, now = new Date() }) {
  const groupedCandles = normalizeCandles(candles, symbol);
  const timeframeResults = {};
  const validTimeframes = [];
  const staleCandleIntervals = [];
  let staleCandlesIgnored = 0;
  let totalInvalidCandles = 0;

  for (const interval of INTERVALS) {
    const normalized = groupedCandles.get(interval) || { candles: [], invalidCount: 0 };
    totalInvalidCandles += normalized.invalidCount;
    const timeframeFresh = isTimeframeFresh(normalized.candles, interval, now);
    const candlesForAnalysis = timeframeFresh ? normalized.candles : [];
    const staleCandleCount = normalized.candles.length - candlesForAnalysis.length;
    if (staleCandleCount) {
      staleCandleIntervals.push(interval);
      staleCandlesIgnored += staleCandleCount;
    }
    const result = analyzeTimeframe(candlesForAnalysis);
    timeframeResults[interval] = {
      candleCount: normalized.candles.length,
      analyzedCandleCount: candlesForAnalysis.length,
      staleCandleCount,
      stale: staleCandleCount > 0,
      invalidCandleCount: normalized.invalidCount,
      ...result.indicators
    };
    if (candlesForAnalysis.length >= MIN_CANDLES_PER_TIMEFRAME) {
      validTimeframes.push({
        interval,
        candleCount: candlesForAnalysis.length,
        score: result.score,
        volatility: result.indicators.volatility
      });
    }
  }

  const snapshot = validateMarketSnapshot(marketData, now);
  const marketChangeScore = snapshot.available
    ? clamp(snapshot.dailyChangePct * 8, -100, 100)
    : null;
  const rangePositionScore = snapshot.rangePositionPct === null
    ? null
    : clamp((snapshot.rangePositionPct - 50) * 2, -100, 100);
  const marketContextScore = marketChangeScore === null
    ? null
    : rangePositionScore === null
      ? marketChangeScore
      : marketChangeScore * 0.7 + rangePositionScore * 0.3;
  const timeframeScore = weightedTimeframeScore(validTimeframes);
  const score = timeframeScore === null
    ? null
    : round(snapshot.available ? timeframeScore * 0.9 + marketContextScore * 0.1 : timeframeScore);
  const candleCoverage = validTimeframes.length / INTERVALS.length;
  const averageDepth = validTimeframes.length
    ? validTimeframes.reduce((total, timeframe) => total + Math.min(timeframe.candleCount / 100, 1), 0)
      / validTimeframes.length
    : 0;
  const volatilityPenalty = averageVolatilityPenalty(validTimeframes);
  const sufficientData = snapshot.available
    && validTimeframes.length >= MIN_TIMEFRAMES_FOR_ANALYSIS;
  let confidence = sufficientData
    ? clamp(
      35 + Math.abs(score) * 0.38 + candleCoverage * 15 + averageDepth * 10
        - volatilityPenalty,
      0,
      95
    )
    : clamp(12 + candleCoverage * 20 + averageDepth * 12 + (snapshot.available ? 6 : 0), 0, 49);
  if (validTimeframes.length < 4) {
    confidence = Math.min(confidence, 64);
  }
  confidence = round(confidence);

  let decision = "WAIT";
  if (sufficientData) {
    if (Math.abs(score) < 20 || confidence < MIN_CONFIDENCE_FOR_SIGNAL) {
      decision = "HOLD";
    } else {
      decision = score > 0 ? "BUY" : "SELL";
    }
  }

  const reason = buildDecisionReason({
    decision,
    snapshot,
    validTimeframes,
    staleCandleIntervals,
    totalInvalidCandles,
    score
  });
  const indicators = {
    marketData: {
      available: snapshot.available,
      price: snapshot.price,
      dailyChangePct: snapshot.dailyChangePct,
      volume: snapshot.volume,
      high24h: snapshot.high24h,
      low24h: snapshot.low24h,
      rangePositionPct: snapshot.rangePositionPct,
      capturedAt: snapshot.capturedAt,
      stale: snapshot.stale
    },
    timeframes: timeframeResults,
    marketStrength: score,
    dataQuality: {
      candleIntervalsAvailable: validTimeframes.map(({ interval }) => interval),
      candleIntervalsRequiredForAnalysis: MIN_TIMEFRAMES_FOR_ANALYSIS,
      candleCoverage: round(candleCoverage * 100),
      invalidCandlesIgnored: totalInvalidCandles,
      staleCandleIntervals,
      staleCandlesIgnored,
      marketSnapshotAvailable: snapshot.available,
      sufficientForDirectionalSignal: sufficientData && validTimeframes.length >= 4
        && confidence >= MIN_CONFIDENCE_FOR_SIGNAL
    }
  };

  return {
    symbol,
    decision,
    confidence,
    reason,
    indicators,
    strategy_name: ANALYZER_NAME,
    strategy_version: ANALYZER_VERSION
  };
}

function analyzeTimeframe(candles) {
  const closes = candles.map(({ close }) => close);
  const ema12 = calculateEma(closes, 12);
  const ema26 = calculateEma(closes, 26);
  const rsi14 = calculateRsi(closes, 14);
  const macd = calculateMacd(closes);
  const momentum = calculateMomentum(closes);
  const volume = calculateVolume(candles);
  const volatility = calculateVolatility(candles);
  const featureScores = [
    { key: "trend", value: ema12 !== null && ema26 !== null
      ? clamp((ema12 - ema26) / ema26 * 5000, -100, 100)
      : null, weight: 0.3 },
    { key: "momentum", value: momentum.changePct !== null
      ? clamp(momentum.changePct * 20, -100, 100)
      : null, weight: 0.25 },
    { key: "rsi", value: rsi14 !== null ? clamp((rsi14 - 50) * 2, -100, 100) : null, weight: 0.15 },
    { key: "macd", value: macd.histogram !== null && closes.length
      ? clamp(macd.histogram / closes.at(-1) * 20_000, -100, 100)
      : null, weight: 0.15 },
    { key: "volume", value: volume.score, weight: 0.15 }
  ].filter(({ value }) => value !== null);
  const weightTotal = featureScores.reduce((total, feature) => total + feature.weight, 0);
  const score = weightTotal
    ? round(featureScores.reduce((total, feature) => total + feature.value * feature.weight, 0) / weightTotal)
    : null;

  return {
    score,
    indicators: {
      trend: ema12 === null || ema26 === null
        ? null
        : {
          direction: ema12 > ema26 ? "bullish" : ema12 < ema26 ? "bearish" : "sideways",
          ema12: round(ema12),
          ema26: round(ema26),
          percentSpread: round((ema12 - ema26) / ema26 * 100)
        },
      momentum,
      rsi14: rsi14 === null ? null : round(rsi14),
      macd,
      volume,
      volatility
    }
  };
}

function normalizeCandles(rows, symbol) {
  const grouped = new Map(INTERVALS.map((interval) => [interval, { candles: [], invalidCount: 0 }]));
  if (!Array.isArray(rows)) {
    return grouped;
  }

  for (const row of rows) {
    const group = row && grouped.get(row.interval);
    const candle = normalizeCandle(row, symbol);
    if (!group || !candle) {
      if (group) {
        group.invalidCount += 1;
      }
      continue;
    }
    group.candles.push(candle);
  }

  for (const group of grouped.values()) {
    const uniqueCandles = new Map(group.candles.map((candle) => [candle.timestamp, candle]));
    group.candles = [...uniqueCandles.values()].sort((left, right) =>
      Date.parse(left.timestamp) - Date.parse(right.timestamp)
    );
  }
  return grouped;
}

function isTimeframeFresh(candles, interval, now) {
  if (!candles.length) {
    return false;
  }
  const latestTimestamp = Date.parse(candles.at(-1).timestamp);
  const ageMs = now.getTime() - latestTimestamp;
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= CANDLE_MAX_AGE_MS[interval];
}

function normalizeCandle(row, symbol) {
  if (!row || row.symbol !== symbol) {
    return null;
  }
  const open = finiteNumber(row.open);
  const high = finiteNumber(row.high);
  const low = finiteNumber(row.low);
  const close = finiteNumber(row.close);
  const volume = finiteNumber(row.volume);
  const timestamp = typeof row.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp))
    ? row.timestamp
    : null;
  if (open === null || high === null || low === null || close === null || volume === null
    || !timestamp || open <= 0 || close <= 0 || volume < 0
    || high < Math.max(open, close, low) || low > Math.min(open, close)) {
    return null;
  }
  return { open, high, low, close, volume, timestamp };
}

function validateMarketSnapshot(marketData, now) {
  if (!marketData) {
    return {
      available: false,
      stale: false,
      price: null,
      dailyChangePct: null,
      volume: null,
      high24h: null,
      low24h: null,
      rangePositionPct: null,
      capturedAt: null
    };
  }
  const price = finiteNumber(marketData.price);
  const dailyChangePct = finiteNumber(marketData.daily_change);
  const volume = finiteNumber(marketData.volume);
  const high24h = finiteNumber(marketData.high_24h);
  const low24h = finiteNumber(marketData.low_24h);
  const capturedAt = typeof marketData.captured_at === "string" ? marketData.captured_at : null;
  const timestamp = capturedAt ? Date.parse(capturedAt) : NaN;
  const stale = !Number.isFinite(timestamp) || now.getTime() - timestamp > MARKET_DATA_MAX_AGE_MS
    || now.getTime() < timestamp;
  const available = price !== null && price > 0 && dailyChangePct !== null
    && volume !== null && volume >= 0 && !stale;
  const validDailyRange = price !== null && high24h !== null && low24h !== null
    && low24h >= 0 && high24h > low24h && price >= low24h && price <= high24h;
  return {
    available,
    stale,
    price: price !== null && price > 0 ? price : null,
    dailyChangePct,
    volume: volume !== null && volume >= 0 ? volume : null,
    high24h: high24h !== null && high24h > 0 ? high24h : null,
    low24h: low24h !== null && low24h >= 0 ? low24h : null,
    rangePositionPct: validDailyRange
      ? round((price - low24h) / (high24h - low24h) * 100)
      : null,
    capturedAt
  };
}

function calculateEma(values, period) {
  if (values.length < period) {
    return null;
  }
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
  }
  return ema;
}

function calculateEmaSeries(values, period) {
  const series = Array(values.length).fill(null);
  if (values.length < period) {
    return series;
  }
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  series[period - 1] = ema;
  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
    series[index] = ema;
  }
  return series;
}

function calculateRsi(values, period) {
  if (values.length <= period) {
    return null;
  }
  let gains = 0;
  let losses = 0;
  const start = values.length - period;
  for (let index = start; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }
  if (averageLoss === 0) {
    return 100;
  }
  if (averageGain === 0) {
    return 0;
  }
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function calculateMacd(values) {
  if (values.length < 34) {
    return { line: null, signal: null, histogram: null };
  }
  const shortEma = calculateEmaSeries(values, 12);
  const longEma = calculateEmaSeries(values, 26);
  const line = values.map((_, index) =>
    shortEma[index] === null || longEma[index] === null ? null : shortEma[index] - longEma[index]
  );
  const firstMacdIndex = line.findIndex((value) => value !== null);
  const macdValues = line.slice(firstMacdIndex).filter((value) => value !== null);
  const signalLine = calculateEmaSeries(macdValues, 9);
  const currentLine = line.at(-1);
  const currentSignal = signalLine.at(-1);
  if (currentLine === null || currentSignal === null || currentSignal === undefined) {
    return { line: null, signal: null, histogram: null };
  }
  return {
    line: round(currentLine),
    signal: round(currentSignal),
    histogram: round(currentLine - currentSignal)
  };
}

function calculateMomentum(values) {
  if (values.length < 6) {
    return { changePct: null, accelerationPct: null, direction: null };
  }
  const currentChange = percentageChange(values.at(-6), values.at(-1));
  const previousChange = values.length >= 11
    ? percentageChange(values.at(-11), values.at(-6))
    : null;
  const currentMomentum = Math.abs(currentChange);
  const previousMomentum = previousChange === null ? null : Math.abs(previousChange);
  return {
    changePct: round(currentChange),
    accelerationPct: previousChange === null ? null : round(currentChange - previousChange),
    direction: previousMomentum === null
      ? null
      : currentMomentum === 0
        ? "sideways"
        : currentMomentum > previousMomentum ? "accelerating" : "weakening"
  };
}

function calculateVolume(candles) {
  if (candles.length < 6) {
    return { latest: candles.at(-1)?.volume ?? null, average: null, ratio: null, classification: "insufficient", score: null };
  }
  const previousVolumes = candles.slice(-21, -1).map(({ volume }) => volume);
  if (!previousVolumes.length) {
    return { latest: candles.at(-1).volume, average: null, ratio: null, classification: "insufficient", score: null };
  }
  const average = previousVolumes.reduce((sum, value) => sum + value, 0) / previousVolumes.length;
  const latest = candles.at(-1).volume;
  const ratio = average > 0 ? latest / average : null;
  const lastChange = percentageChange(candles.at(-2).close, candles.at(-1).close);
  const score = ratio === null ? null
    : ratio >= 1.5 ? Math.sign(lastChange) * clamp((ratio - 1) * 25, 0, 60)
      : ratio <= 0.5 ? -Math.sign(lastChange) * 10
        : 0;
  return {
    latest: round(latest),
    average: round(average),
    ratio: ratio === null ? null : round(ratio),
    classification: ratio === null ? "insufficient"
      : ratio >= 1.5 ? "increasing"
        : ratio <= 0.5 ? "decreasing"
          : "normal",
    score: score === null ? null : round(score)
  };
}

function calculateVolatility(candles) {
  if (candles.length < 2) {
    return { atrPct: null, level: "insufficient" };
  }
  const recent = candles.slice(-15);
  const trueRanges = [];
  for (let index = 1; index < recent.length; index += 1) {
    const previousClose = recent[index - 1].close;
    const candle = recent[index];
    trueRanges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    ));
  }
  const meanPrice = recent.reduce((sum, candle) => sum + candle.close, 0) / recent.length;
  const atrPct = meanPrice > 0
    ? trueRanges.reduce((sum, range) => sum + range, 0) / trueRanges.length / meanPrice * 100
    : null;
  return {
    atrPct: atrPct === null ? null : round(atrPct),
    level: atrPct === null ? "insufficient" : atrPct < 0.5 ? "low" : atrPct < 2 ? "medium" : "high"
  };
}

function weightedTimeframeScore(timeframes) {
  if (!timeframes.length) {
    return null;
  }
  const weightTotal = timeframes.reduce((total, timeframe) => total + TIMEFRAME_WEIGHTS[timeframe.interval], 0);
  return round(timeframes.reduce((total, timeframe) =>
    total + timeframe.score * TIMEFRAME_WEIGHTS[timeframe.interval], 0
  ) / weightTotal);
}

function averageVolatilityPenalty(timeframes) {
  if (!timeframes.length) {
    return 0;
  }
  const penaltyTotal = timeframes.reduce((total, { volatility }) =>
    total + (volatility.level === "high" ? 12 : volatility.level === "medium" ? 4 : 0), 0);
  return penaltyTotal / timeframes.length;
}

function buildDecisionReason({
  decision,
  snapshot,
  validTimeframes,
  staleCandleIntervals,
  totalInvalidCandles,
  score
}) {
  const timeframeText = `${validTimeframes.length}/${INTERVALS.length} candle intervals have at least ${MIN_CANDLES_PER_TIMEFRAME} valid candles`;
  if (validTimeframes.length < MIN_TIMEFRAMES_FOR_ANALYSIS && staleCandleIntervals.length) {
    return "STALE_CANDLE_DATA";
  }
  if (!snapshot.available) {
    return `WAIT: current market snapshot is missing, invalid, or stale; ${timeframeText}.`;
  }
  if (validTimeframes.length < MIN_TIMEFRAMES_FOR_ANALYSIS) {
    return `WAIT: insufficient real candle history; ${timeframeText}.`;
  }
  if (decision === "HOLD") {
    return `HOLD: market strength ${score} is neutral or confidence is reduced by incomplete data; ${timeframeText}.`;
  }
  const invalidText = totalInvalidCandles ? ` ${totalInvalidCandles} invalid candle records were ignored.` : "";
  return `${decision}: combined trend, momentum, RSI, MACD, volume, volatility, and 24-hour market data produced a ${score} market-strength score.${invalidText}`;
}

async function fetchCandlesForMarkets(config, serviceRoleKey, markets, fetchImpl) {
  const results = new Map(markets.map(({ symbol }) => [symbol, []]));
  const marketBatches = [];
  for (let index = 0; index < markets.length; index += CANDLE_MARKET_BATCH_SIZE) {
    marketBatches.push(markets.slice(index, index + CANDLE_MARKET_BATCH_SIZE).map(({ symbol }) => symbol));
  }
  const jobs = marketBatches.flatMap((symbols) =>
    INTERVALS.map((interval) => ({ symbols, interval }))
  );
  const resultsByJob = new Array(jobs.length);
  let nextJobIndex = 0;
  let candleQueries = 0;
  let hasError = false;
  let firstError;

  async function runWorker() {
    while (!hasError) {
      const jobIndex = nextJobIndex;
      nextJobIndex += 1;
      if (jobIndex >= jobs.length) {
        return;
      }

      const { symbols, interval } = jobs[jobIndex];
      try {
        candleQueries += 1;
        const candlesByMarket = await fetchLatestCandles(
          config,
          serviceRoleKey,
          symbols,
          interval,
          fetchImpl
        );
        resultsByJob[jobIndex] = { symbols, interval, candlesByMarket };
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
        return;
      }
    }
  }

  const workerCount = Math.min(CANDLE_QUERY_CONCURRENCY, jobs.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  if (hasError) {
    throw firstError;
  }

  for (const { symbols, candlesByMarket } of resultsByJob) {
    for (const symbol of symbols) {
      results.get(symbol).push(...candlesByMarket.get(symbol));
    }
  }
  return { candlesBySymbol: results, candleQueries };
}

async function fetchLatestCandles(config, serviceRoleKey, symbols, interval, fetchImpl) {
  const url = new URL(`/rest/v1/rpc/${AI_CANDLES_RPC}`, config.supabaseUrl);
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "count=exact"
      },
      body: JSON.stringify({ p_symbols: symbols, p_interval: interval }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new AIEngineError("DATABASE_UNAVAILABLE", "Supabase AI engine data could not be loaded.", error);
  }
  if (!response.ok) {
    throw new AIEngineError("DATABASE_READ_FAILED", "Supabase rejected an AI engine read.");
  }
  let rows;
  try {
    rows = await response.json();
  } catch (error) {
    throw new AIEngineError("INVALID_DATABASE_RESPONSE", "Supabase returned invalid AI engine data.", error);
  }
  if (!Array.isArray(rows) || rows.length > symbols.length * MAX_CANDLES_PER_INTERVAL) {
    throw new AIEngineError("INVALID_DATABASE_RESPONSE", "Supabase returned an unexpected AI engine response.");
  }
  if (!hasCompletePostgrestResult(response, rows.length)) {
    throw new AIEngineError("INVALID_DATABASE_RESPONSE", "Supabase returned an incomplete AI engine candle response.");
  }

  const candlesByMarket = new Map(symbols.map((symbol) => [symbol, []]));
  for (const row of rows) {
    const marketCandles = row && candlesByMarket.get(row.symbol);
    if (!marketCandles || row.interval !== interval || marketCandles.length >= MAX_CANDLES_PER_INTERVAL) {
      throw new AIEngineError("INVALID_DATABASE_RESPONSE", "Supabase returned an unexpected AI engine response.");
    }
    marketCandles.push(row);
  }
  return candlesByMarket;
}

function hasCompletePostgrestResult(response, rowCount) {
  const contentRange = response.headers && typeof response.headers.get === "function"
    ? response.headers.get("content-range")
    : null;
  if (typeof contentRange !== "string") {
    return false;
  }

  const match = /^(?:items\s+)?(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/i.exec(contentRange.trim());
  if (!match || match[3] === "*") {
    return false;
  }

  const total = Number(match[3]);
  if (!Number.isSafeInteger(total) || total !== rowCount) {
    return false;
  }
  if (total === 0) {
    return match[1] === undefined;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start)
    && Number.isSafeInteger(end)
    && start === 0
    && end >= start
    && end - start + 1 === rowCount;
}

async function updateAgentStatus(config, serviceRoleKey, status, fetchImpl) {
  const url = new URL(`/rest/v1/${STATUS_TABLE}`, config.supabaseUrl);
  url.searchParams.set("singleton", "eq.true");
  await writeDatabaseRows(config, serviceRoleKey, url, status, fetchImpl, "PATCH", true);
}

async function writeDecisions(config, serviceRoleKey, decisions, fetchImpl) {
  const url = new URL(`/rest/v1/${DECISIONS_TABLE}`, config.supabaseUrl);
  await writeDatabaseRows(config, serviceRoleKey, url, decisions, fetchImpl, "POST", false);
}

async function writeDatabaseRows(config, serviceRoleKey, url, rows, fetchImpl, method, requireOneRow) {
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method,
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=representation"
      },
      body: JSON.stringify(rows),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new AIEngineError("DATABASE_UNAVAILABLE", "Supabase could not store AI engine data.", error);
  }
  if (!response.ok) {
    throw new AIEngineError("DATABASE_WRITE_FAILED", "Supabase rejected an AI engine write.");
  }
  let writtenRows;
  try {
    writtenRows = await response.json();
  } catch (error) {
    throw new AIEngineError("INVALID_DATABASE_RESPONSE", "Supabase returned an invalid write response.", error);
  }
  if (!Array.isArray(writtenRows) || (requireOneRow && writtenRows.length !== 1)) {
    throw new AIEngineError("DATABASE_WRITE_FAILED", "Supabase did not confirm the AI engine write.");
  }
  return writtenRows;
}

async function fetchRows(config, serviceRoleKey, table, filters, fetchImpl) {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        accept: "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new AIEngineError("DATABASE_UNAVAILABLE", "Supabase AI engine data could not be loaded.", error);
  }
  if (!response.ok) {
    throw new AIEngineError("DATABASE_READ_FAILED", "Supabase rejected an AI engine read.");
  }
  let rows;
  try {
    rows = await response.json();
  } catch (error) {
    throw new AIEngineError("INVALID_DATABASE_RESPONSE", "Supabase returned invalid AI engine data.", error);
  }
  if (!Array.isArray(rows)) {
    throw new AIEngineError("INVALID_DATABASE_RESPONSE", "Supabase returned an unexpected AI engine response.");
  }
  return rows;
}

function validateMarkets(markets) {
  if (!Array.isArray(markets)) {
    throw new AIEngineError("INVALID_MARKET_DATA", "Watched markets response is invalid.");
  }
  for (const market of markets) {
    if (!market || typeof market.symbol !== "string" || !/^[A-Z0-9]+-EUR$/.test(market.symbol)
      || market.enabled !== true) {
      throw new AIEngineError("INVALID_MARKET_DATA", "Watched markets contain an invalid active market.");
    }
  }
}

function validateMarketDataRows(rows) {
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.symbol !== "string")) {
    throw new AIEngineError("INVALID_MARKET_DATA", "Market data response contains invalid records.");
  }
}

function isAgentStatus(status) {
  return ["ACTIVE", "ANALYZING", "IDLE", "STOPPED", "ERROR"].includes(status);
}

function finiteNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentageChange(start, end) {
  return start > 0 ? (end - start) / start * 100 : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function readNow() {
  return new Date();
}

function getErrorCode(error) {
  return error instanceof AIEngineError ? error.code
    : error instanceof Error ? error.name
      : "UNKNOWN_ERROR";
}

function logInfo(logger, message, fields) {
  if (logger && typeof logger.info === "function") {
    logger.info(message, fields);
  }
}

function logAnalysisSummary(logger, {
  analyzedMarkets,
  decisions,
  candleReads,
  candleQueries,
  candlesLoaded,
  runtimeMs,
  timingMs
}) {
  const decisionCounts = { BUY: 0, SELL: 0, HOLD: 0, WAIT: 0 };
  for (const { decision } of decisions) {
    decisionCounts[decision] += 1;
  }

  logInfo(logger, "AI analysis completed.", {
    analyzedMarkets,
    decisionsStored: decisions.length,
    buyCount: decisionCounts.BUY,
    sellCount: decisionCounts.SELL,
    holdCount: decisionCounts.HOLD,
    waitCount: decisionCounts.WAIT,
    candleReads,
    candleQueries,
    failedReads: 0,
    candlesLoaded,
    runtimeMs,
    timingMs
  });
}

function logFailure(logger, message, code, fields) {
  if (logger && typeof logger.error === "function") {
    logger.error(message, fields ? { code, ...fields } : code);
  }
}

function elapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt);
}

class AIEngineError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.code = code;
  }
}
