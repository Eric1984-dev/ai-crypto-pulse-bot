import {
  CANDLE_INTERVAL_MS,
  isCandleClosed,
  isCandleTimestampAligned
} from "./candle-intervals.mjs";

export const AI_ANALYSIS_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const AI_ANALYZER_NAME = "Deterministic Technical Analysis V2";
export const AI_ANALYZER_VERSION = "2.0.0";
export const AI_DECISION_INTERVAL = "1d";
export const MIN_CANDLES_PER_TIMEFRAME = 26;
export const MIN_TIMEFRAMES_FOR_ANALYSIS = 2;
export const MIN_CONFIDENCE_FOR_SIGNAL = 65;
export const MAX_CANDLES_PER_INTERVAL = 150;

const CANDLE_MAX_AGE_MS = Object.freeze({
  "1m": 30 * 60 * 1000,
  "5m": 2 * 60 * 60 * 1000,
  "15m": 6 * 60 * 60 * 1000,
  "1h": 12 * 60 * 60 * 1000,
  "4h": 24 * 60 * 60 * 1000,
  "1d": 72 * 60 * 60 * 1000
});
const MARKET_DATA_MAX_AGE_MS = 15 * 60 * 1000;

export function analyzeMarket({ symbol, marketData, candles, now = new Date() }) {
  const analysisTime = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(analysisTime.getTime())) {
    throw new TypeError("A valid analysis timestamp is required.");
  }

  const groupedCandles = normalizeCandles(candles, symbol);
  const timeframeResults = {};
  const validTimeframes = [];
  const staleCandleIntervals = [];
  const incompleteCandleIntervals = [];
  const missingCandleIntervals = [];
  let incompleteCandlesIgnored = 0;
  let staleCandlesIgnored = 0;
  let totalInvalidCandles = 0;

  for (const interval of AI_ANALYSIS_INTERVALS) {
    const normalized = groupedCandles.get(interval) || { candles: [], invalidCount: 0 };
    totalInvalidCandles += normalized.invalidCount;
    const closedCandles = normalized.candles.filter(({ timestamp }) =>
      isCandleClosed(Date.parse(timestamp), interval, analysisTime.getTime())
    );
    const incompleteCandleCount = normalized.candles.length - closedCandles.length;
    if (incompleteCandleCount) {
      incompleteCandleIntervals.push(interval);
      incompleteCandlesIgnored += incompleteCandleCount;
    }
    if (!normalized.candles.length) {
      missingCandleIntervals.push(interval);
    }
    const timeframeFresh = isTimeframeFresh(closedCandles, interval, analysisTime);
    const candlesForAnalysis = timeframeFresh ? closedCandles : [];
    const staleCandleCount = closedCandles.length - candlesForAnalysis.length;
    if (staleCandleCount) {
      staleCandleIntervals.push(interval);
      staleCandlesIgnored += staleCandleCount;
    }
    const result = analyzeTimeframe(candlesForAnalysis);
    timeframeResults[interval] = {
      candleCount: normalized.candles.length,
      closedCandleCount: closedCandles.length,
      incompleteCandleCount,
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
        volatility: result.indicators.volatility
      });
    }
  }

  const snapshot = validateMarketSnapshot(marketData, analysisTime);
  const v2Signal = calculateV2Signal(timeframeResults, validTimeframes);
  const score = v2Signal.available ? v2Signal.marketStrength : null;
  const candleCoverage = validTimeframes.length / AI_ANALYSIS_INTERVALS.length;
  const averageDepth = validTimeframes.length
    ? validTimeframes.reduce((total, timeframe) => total + Math.min(timeframe.candleCount / 100, 1), 0)
      / validTimeframes.length
    : 0;
  const volatilityPenalty = averageVolatilityPenalty(validTimeframes);
  const sufficientData = snapshot.available
    && validTimeframes.length >= MIN_TIMEFRAMES_FOR_ANALYSIS;
  let confidence = sufficientData && v2Signal.available
    ? clamp(
      40 + 30 * v2Signal.trendStrength + 10 * v2Signal.alignment
        + 10 * v2Signal.volumeConfirmation + 5 * v2Signal.rsiConfirmation
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
    if (!v2Signal.available) {
      decision = "WAIT";
    } else if (Math.abs(score) < 20 || confidence < MIN_CONFIDENCE_FOR_SIGNAL) {
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
    incompleteCandleIntervals,
    incompleteCandlesIgnored,
    missingCandleIntervals,
    totalInvalidCandles,
    score,
    v2InputsAvailable: v2Signal.available
  });
  const indicators = {
    interval: AI_DECISION_INTERVAL,
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
      incompleteCandleIntervals,
      incompleteCandlesIgnored,
      missingCandleIntervals,
      marketSnapshotAvailable: snapshot.available,
      sufficientForDirectionalSignal: sufficientData && v2Signal.available && validTimeframes.length >= 4
        && confidence >= MIN_CONFIDENCE_FOR_SIGNAL
    }
  };

  return {
    symbol,
    interval: AI_DECISION_INTERVAL,
    decision,
    confidence,
    reason,
    indicators,
    timestamp: analysisTime.toISOString(),
    strategy_name: AI_ANALYZER_NAME,
    strategy_version: AI_ANALYZER_VERSION
  };
}

export function calculateEma(values, period) {
  if (!Array.isArray(values) || !Number.isSafeInteger(period) || period < 1
    || values.length < period || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
  }
  return ema;
}

export function calculateRsi(values, period = 14) {
  if (!Array.isArray(values) || !Number.isSafeInteger(period) || period < 1
    || values.some((value) => !Number.isFinite(value)) || values.length <= period) {
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

export function calculateMacd(values) {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value))
    || values.length < 34) {
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

function analyzeTimeframe(candles) {
  const closes = candles.map(({ close }) => close);
  const ema12 = calculateEma(closes, 12);
  const ema26 = calculateEma(closes, 26);
  const rsi14 = calculateRsi(closes, 14);
  const macd = calculateMacd(closes);
  const momentum = calculateMomentum(closes);
  const volume = calculateVolume(candles);
  const volatility = calculateVolatility(candles);

  return {
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

function calculateV2Signal(timeframes, validTimeframes) {
  const validIntervals = new Set(validTimeframes.map(({ interval }) => interval));
  const hourly = timeframes["1h"];
  const daily = timeframes["1d"];
  const dailySpread = finiteNumber(daily && daily.trend && daily.trend.percentSpread);
  const dailyRsi = finiteNumber(daily && daily.rsi14);
  const hourlyVolumeRatio = finiteNumber(hourly && hourly.volume && hourly.volume.ratio);
  const hourlyDirection = hourly && hourly.trend && hourly.trend.direction;
  const dailyDirection = daily && daily.trend && daily.trend.direction;
  const validDirections = ["bullish", "bearish", "sideways"];
  if (!validIntervals.has("1h") || !validIntervals.has("1d")
    || dailySpread === null || dailyRsi === null || hourlyVolumeRatio === null
    || hourlyVolumeRatio < 0
    || !validDirections.includes(hourlyDirection)
    || !validDirections.includes(dailyDirection)) {
    return { available: false };
  }

  const dailyEmaScore = clamp(dailySpread * 50, -100, 100);
  const dailyRsiScore = clamp((dailyRsi - 50) * 2, -100, 100);
  const alignment = hourlyDirection === dailyDirection && dailyDirection !== "sideways" ? 1 : 0;
  const volumeConfirmation = clamp(hourlyVolumeRatio - 0.5, 0, 1);
  const rsiConfirmation = clamp(Math.max(0, Math.sign(dailyEmaScore) * dailyRsiScore / 100), 0, 1);
  const marketStrength = round(clamp(
    0.75 * dailyEmaScore
      + 0.10 * dailyEmaScore * alignment
      + 0.10 * dailyEmaScore * volumeConfirmation
      + 0.05 * dailyRsiScore,
    -100,
    100
  ));

  return {
    available: true,
    marketStrength,
    trendStrength: Math.abs(dailyEmaScore) / 100,
    alignment,
    volumeConfirmation,
    rsiConfirmation
  };
}

function normalizeCandles(rows, symbol) {
  const grouped = new Map(AI_ANALYSIS_INTERVALS.map((interval) =>
    [interval, { candles: [], invalidCount: 0 }]
  ));
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
  const latestCloseTime = Date.parse(candles.at(-1).timestamp) + CANDLE_INTERVAL_MS[interval];
  const ageMs = now.getTime() - latestCloseTime;
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
    : row.timestamp instanceof Date && Number.isFinite(row.timestamp.getTime())
      ? row.timestamp.toISOString()
      : null;
  if (open === null || high === null || low === null || close === null || volume === null
    || !timestamp || open <= 0 || close <= 0 || volume < 0
    || !isCandleTimestampAligned(Date.parse(timestamp), row.interval)
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
  const capturedAt = marketData.captured_at instanceof Date
    ? marketData.captured_at.toISOString()
    : typeof marketData.captured_at === "string" ? marketData.captured_at : null;
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
    return {
      latest: candles.at(-1)?.volume ?? null,
      average: null,
      ratio: null,
      classification: "insufficient",
      score: null
    };
  }
  const previousVolumes = candles.slice(-21, -1).map(({ volume }) => volume);
  if (!previousVolumes.length) {
    return {
      latest: candles.at(-1).volume,
      average: null,
      ratio: null,
      classification: "insufficient",
      score: null
    };
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
  incompleteCandleIntervals,
  incompleteCandlesIgnored,
  missingCandleIntervals,
  totalInvalidCandles,
  score,
  v2InputsAvailable
}) {
  const timeframeText = `${validTimeframes.length}/${AI_ANALYSIS_INTERVALS.length} candle intervals have at least ${MIN_CANDLES_PER_TIMEFRAME} valid candles`;
  if (validTimeframes.length < MIN_TIMEFRAMES_FOR_ANALYSIS && staleCandleIntervals.length) {
    return "STALE_CANDLE_DATA";
  }
  if (!snapshot.available) {
    return `WAIT: current market snapshot is missing, invalid, or stale; ${timeframeText}.`;
  }
  if (validTimeframes.length < MIN_TIMEFRAMES_FOR_ANALYSIS) {
    return `WAIT: insufficient real candle history; ${timeframeText}.`;
  }
  if (!v2InputsAvailable) {
    return `WAIT: fresh 1h volume ratio and 1d EMA/RSI inputs are required for V2 analysis; ${timeframeText}.`;
  }
  if (decision === "HOLD") {
    return `HOLD: market strength ${score} is neutral or confidence is reduced by incomplete data; ${timeframeText}.`;
  }
  const qualityDetails = [];
  if (incompleteCandlesIgnored) {
    qualityDetails.push(`${incompleteCandlesIgnored} in-progress candles were ignored`);
  }
  if (staleCandleIntervals.length) {
    qualityDetails.push(`stale intervals ignored: ${staleCandleIntervals.join(", ")}`);
  }
  if (missingCandleIntervals.length) {
    qualityDetails.push(`missing intervals: ${missingCandleIntervals.join(", ")}`);
  }
  if (totalInvalidCandles) {
    qualityDetails.push(`${totalInvalidCandles} invalid candles ignored`);
  }
  const qualityText = qualityDetails.length ? ` Data quality: ${qualityDetails.join("; ")}.` : "";
  return `${decision}: daily EMA trend, hourly volume confirmation, daily RSI, and volatility produced a ${score} V2 market-strength score.${qualityText}`;
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
