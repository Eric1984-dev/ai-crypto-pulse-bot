const SCALE = 1_000_000_000_000n;
const CANDLE_INTERVAL_MS = 5 * 60 * 1000;
const CANDLE_FRESHNESS_MS = 15 * 60 * 1000;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 60 * 1000;
const MINIMUM_ATR_CANDLES = 15;
const EXIT_NET_FACTOR_NUMERATOR = 9_965_025n;
const EXIT_NET_FACTOR_DENOMINATOR = 10_000_000n;

export const POSITION_EXIT_POLICY = Object.freeze({
  version: "ATR_TRAILING_EXIT_V1",
  minimumNetProfit: "3",
  atrMultipleNumerator: 3,
  atrMultipleDenominator: 2,
  interval: "5m",
  minimumAtrCandles: MINIMUM_ATR_CANDLES
});

export function assessPositionExit(position, marketPrice, candles, now) {
  const mark = decimalToScaled(marketPrice);
  const highWater = maxScaled(
    decimalToScaled(position.high_water_price ?? position.current_price),
    mark
  );
  const existingStop = position.trailing_stop_price === null
    || position.trailing_stop_price === undefined
    ? null
    : decimalToScaled(position.trailing_stop_price);
  const quality = validateAtrCandles(candles, now);
  let dataQuality = quality.reason;
  let stop = existingStop;
  let atr = null;

  if (quality.valid) {
    atr = calculateAtr(candles);
    if (atr > 0n) {
      const minimumProfitPrice = minimumPriceForNetProfit(position);
      if (highWater >= minimumProfitPrice) {
        const trailDistance = atr
          * BigInt(POSITION_EXIT_POLICY.atrMultipleNumerator)
          / BigInt(POSITION_EXIT_POLICY.atrMultipleDenominator);
        const atrStop = highWater - trailDistance;
        const candidateStop = maxScaled(minimumProfitPrice, atrStop);
        stop = stop === null ? candidateStop : maxScaled(stop, candidateStop);
      }
    } else {
      dataQuality = "ZERO_ATR";
    }
  }

  return Object.freeze({
    highWaterPrice: scaledToDecimal(highWater),
    trailingStopPrice: stop === null ? null : scaledToDecimal(stop),
    atr: atr === null ? null : scaledToDecimal(atr),
    dataQuality,
    shouldExit: stop !== null && mark <= stop
  });
}

function validateAtrCandles(candles, now) {
  if (!Array.isArray(candles) || candles.length < MINIMUM_ATR_CANDLES) {
    return { valid: false, reason: "INSUFFICIENT_CANDLES" };
  }
  const ordered = [...candles].sort((left, right) =>
    timestampMilliseconds(left.timestamp) - timestampMilliseconds(right.timestamp));
  const selected = ordered.slice(-MINIMUM_ATR_CANDLES);
  const nowMs = timestampMilliseconds(now);

  for (let index = 0; index < selected.length; index += 1) {
    const candle = selected[index];
    const timestamp = timestampMilliseconds(candle.timestamp);
    if (timestamp + CANDLE_INTERVAL_MS > nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS) {
      return { valid: false, reason: "INCOMPLETE_CANDLE" };
    }
    if (timestamp % CANDLE_INTERVAL_MS !== 0) {
      return { valid: false, reason: "INVALID_CANDLE" };
    }
    const high = decimalToScaled(candle.high);
    const low = decimalToScaled(candle.low);
    const close = decimalToScaled(candle.close);
    if (low <= 0n || high < low || close < low || close > high) {
      return { valid: false, reason: "INVALID_CANDLE" };
    }
    if (index > 0
      && timestamp - timestampMilliseconds(selected[index - 1].timestamp)
        !== CANDLE_INTERVAL_MS) {
      return { valid: false, reason: "CANDLE_GAP" };
    }
  }

  const latestCloseTime = timestampMilliseconds(selected.at(-1).timestamp)
    + CANDLE_INTERVAL_MS;
  if (nowMs - latestCloseTime > CANDLE_FRESHNESS_MS) {
    return { valid: false, reason: "STALE_CANDLES" };
  }
  return { valid: true, reason: "VALID" };
}

function calculateAtr(candles) {
  const ordered = [...candles].sort((left, right) =>
    timestampMilliseconds(left.timestamp) - timestampMilliseconds(right.timestamp));
  const recent = ordered.slice(-MINIMUM_ATR_CANDLES);
  let total = 0n;

  for (let index = 1; index < recent.length; index += 1) {
    const previousClose = decimalToScaled(recent[index - 1].close);
    const high = decimalToScaled(recent[index].high);
    const low = decimalToScaled(recent[index].low);
    total += maxScaled(
      maxScaled(high - low, absolute(high - previousClose)),
      absolute(low - previousClose)
    );
  }
  return total / BigInt(recent.length - 1);
}

function minimumPriceForNetProfit(position) {
  const amount = decimalToScaled(position.amount);
  const entryCostBasis = position.entry_cost_basis === undefined
    ? amount * decimalToScaled(position.entry_price) / SCALE
    : decimalToScaled(position.entry_cost_basis);
  const requiredProceeds = entryCostBasis
    + decimalToScaled(POSITION_EXIT_POLICY.minimumNetProfit);
  const amountAfterExitCosts = amount * EXIT_NET_FACTOR_NUMERATOR
    / EXIT_NET_FACTOR_DENOMINATOR;
  if (amount <= 0n || amountAfterExitCosts <= 0n) {
    throw new TypeError("An open paper position must have a positive amount.");
  }
  return ceilDivide(requiredProceeds * SCALE, amountAfterExitCosts) + 1n;
}

function decimalToScaled(value) {
  const text = typeof value === "number" ? String(value) : value;
  const match = typeof text === "string"
    ? /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(text)
    : null;
  if (!match) {
    throw new TypeError("A valid decimal value is required by the position exit policy.");
  }
  const fraction = (match[3] || "").padEnd(12, "0");
  const scaled = BigInt(match[2]) * SCALE + BigInt(fraction || "0");
  return match[1] === "-" ? -scaled : scaled;
}

function scaledToDecimal(value) {
  const sign = value < 0n ? "-" : "";
  const absoluteValue = value < 0n ? -value : value;
  const whole = absoluteValue / SCALE;
  const fraction = (absoluteValue % SCALE).toString().padStart(12, "0");
  return `${sign}${whole}.${fraction}`;
}

function timestampMilliseconds(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("A valid candle timestamp is required by the position exit policy.");
  }
  return timestamp;
}

function maxScaled(left, right) {
  return left > right ? left : right;
}

function absolute(value) {
  return value < 0n ? -value : value;
}

function ceilDivide(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}
