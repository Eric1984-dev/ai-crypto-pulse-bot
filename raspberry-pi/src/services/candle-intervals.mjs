export const CANDLE_INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000
});

export function isCandleTimestampAligned(timestamp, interval) {
  const intervalMs = CANDLE_INTERVAL_MS[interval];
  return Number.isSafeInteger(timestamp) && timestamp > 0
    && Number.isSafeInteger(intervalMs) && timestamp % intervalMs === 0;
}

export function isCandleClosed(timestamp, interval, nowMs) {
  const intervalMs = CANDLE_INTERVAL_MS[interval];
  return isCandleTimestampAligned(timestamp, interval)
    && Number.isFinite(nowMs)
    && timestamp + intervalMs <= nowMs;
}
