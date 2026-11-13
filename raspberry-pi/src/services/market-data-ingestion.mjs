import { validateEnabledWatchedMarkets } from "./watched-markets.mjs";
import {
  MAX_CANDLES_PER_MARKET,
  MAX_INGESTION_MARKETS_PER_BATCH
} from "../repositories/market-ingestion-repository.mjs";
import {
  CANDLE_INTERVAL_MS,
  isCandleClosed,
  isCandleTimestampAligned
} from "./candle-intervals.mjs";
import { BitvavoProviderError } from "./bitvavo-public-client.mjs";
import { createIngestionFailureDiagnostic } from "./ingestion-diagnostics.mjs";

export const SUPPORTED_INGESTION_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const MAX_INGESTION_WORKERS = 4;
const MARKET_SYMBOL_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const GLOBAL_PROVIDER_FAILURES = new Set([
  "PROVIDER_EMPTY",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE"
]);
const FATAL_DATABASE_CODES = new Set([
  "42501",
  "42P01",
  "42703",
  "08000",
  "08003",
  "08006",
  "08001",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT"
]);

export class MarketDataIngestionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MarketDataIngestionError";
    this.code = code;
    this.component = "market-data-ingestion";
  }
}

export function createMarketDataIngestionService({
  watchedMarketsRepository,
  ingestionRepository,
  bitvavoClient,
  now = () => new Date(),
  logger = console,
  batchSize = MAX_INGESTION_MARKETS_PER_BATCH,
  concurrency = MAX_INGESTION_WORKERS
} = {}) {
  if (!watchedMarketsRepository || typeof watchedMarketsRepository.listEnabled !== "function"
    || !ingestionRepository
    || typeof ingestionRepository.getLatestCandleCheckpoints !== "function"
    || typeof ingestionRepository.upsertSnapshots !== "function"
    || typeof ingestionRepository.upsertCandles !== "function"
    || !bitvavoClient
    || typeof bitvavoClient.fetchTickers !== "function"
    || typeof bitvavoClient.fetchCandles !== "function") {
    throw new TypeError("Watched-market, ingestion repository, and Bitvavo adapters are required.");
  }
  if (batchSize !== MAX_INGESTION_MARKETS_PER_BATCH
    || concurrency < 1 || concurrency > MAX_INGESTION_WORKERS) {
    throw new RangeError("Market ingestion batch and concurrency limits cannot be increased.");
  }

  return Object.freeze({ run });

  async function run({ intervals = SUPPORTED_INGESTION_INTERVALS } = {}) {
    validateIntervals(intervals);
    const markets = validateEnabledWatchedMarkets(await watchedMarketsRepository.listEnabled());
    const result = {
      status: "completed",
      markets: markets.length,
      batchSize,
      batchCount: Math.ceil(markets.length / batchSize),
      snapshots: {
        status: "completed",
        attempted: markets.length,
        persisted: 0,
        missing: 0,
        failed: 0,
        skipped: 0
      },
      candles: [],
      providerRequests: 0,
      warnings: []
    };
    const snapshotStage = await ingestSnapshots(markets, result);
    let providerUnavailable = snapshotStage.providerUnavailable;
    let databaseUnavailable = snapshotStage.databaseUnavailable;
    if (databaseUnavailable) {
      for (const interval of intervals) {
        result.candles.push(skippedInterval(interval, markets.length, "DATABASE_UNAVAILABLE"));
      }
      result.status = "failed";
      return result;
    }

    for (const interval of intervals) {
      if (databaseUnavailable || providerUnavailable) {
        result.candles.push(skippedInterval(
          interval,
          markets.length,
          databaseUnavailable ? "DATABASE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE"
        ));
        continue;
      }
      const intervalResult = await ingestInterval(markets, interval, result);
      result.candles.push(intervalResult);
      providerUnavailable ||= intervalResult.providerUnavailable;
      databaseUnavailable ||= intervalResult.databaseUnavailable;
    }

    if (databaseUnavailable) {
      result.status = "failed";
    } else if (providerUnavailable
      || result.snapshots.failed
      || result.snapshots.missing
      || result.candles.some((item) => item.failed || item.missing || item.skipped)) {
      result.status = "partial";
    }
    return result;
  }

  async function ingestSnapshots(markets, result) {
    let providerUnavailable = false;
    let databaseUnavailable = false;
    let tickers;
    try {
      result.providerRequests += 1;
      tickers = await bitvavoClient.fetchTickers();
    } catch (error) {
      result.snapshots.status = "failed";
      result.snapshots.failed = markets.length;
      result.snapshots.errorCode = safeErrorCode(error);
      providerUnavailable ||= error instanceof BitvavoProviderError
        && GLOBAL_PROVIDER_FAILURES.has(error.code);
      recordFailure(error, { stage: "snapshots" });
      result.warnings.push("Snapshot provider request failed; stored snapshots were left unchanged.");
      return { providerUnavailable, databaseUnavailable };
    }

    const tickerIndex = indexTickers(tickers);
    const capturedAt = currentTimestamp();
    const rowsBySymbol = new Map();
    const failureEvents = [];
    for (const market of markets) {
      if (tickerIndex.duplicates.has(market.symbol)) {
        result.snapshots.failed += 1;
        const error = new BitvavoProviderError(
          "INVALID_PROVIDER_RESPONSE",
          "Bitvavo returned duplicate ticker rows for this watched market."
        );
        failureEvents.push(scannerEvent(
          market.symbol,
          "MARKET_DATA_INVALID",
          error.message
        ));
        recordFailure(error, { stage: "snapshot-validation", symbol: market.symbol });
        continue;
      }
      const ticker = tickerIndex.bySymbol.get(market.symbol);
      if (!ticker) {
        result.snapshots.missing += 1;
        const error = new BitvavoProviderError(
          "MARKET_DATA_MISSING",
          "Bitvavo returned no 24-hour ticker for this watched market."
        );
        failureEvents.push(scannerEvent(
          market.symbol,
          "MARKET_DATA_MISSING",
          error.message
        ));
        recordFailure(error, { stage: "snapshot-validation", symbol: market.symbol });
        continue;
      }
      const parsed = parseTickerSnapshot(ticker, capturedAt);
      if (!parsed) {
        result.snapshots.failed += 1;
        const error = new BitvavoProviderError(
          "INVALID_PROVIDER_RESPONSE",
          "Bitvavo returned an invalid 24-hour ticker for this watched market."
        );
        failureEvents.push(scannerEvent(
          market.symbol,
          "MARKET_DATA_INVALID",
          error.message
        ));
        recordFailure(error, { stage: "snapshot-validation", symbol: market.symbol });
        continue;
      }
      rowsBySymbol.set(market.symbol, parsed);
    }

    const batches = chunks(markets, batchSize);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const prepared = batches[batchIndex]
        .map(({ symbol }) => rowsBySymbol.get(symbol))
        .filter(Boolean);
      if (!prepared.length || databaseUnavailable) {
        continue;
      }
      try {
        result.snapshots.persisted += await ingestionRepository.upsertSnapshots(prepared);
      } catch (error) {
        if (isFatalDatabaseError(error)) {
          databaseUnavailable = true;
          result.snapshots.failed += prepared.length;
          recordFailure(error, { stage: "snapshot-storage", batch: batchIndex });
          break;
        }
        for (const row of prepared) {
          try {
            result.snapshots.persisted += await ingestionRepository.upsertSnapshots([row]);
          } catch (marketError) {
            result.snapshots.failed += 1;
            failureEvents.push(scannerEvent(
              row.symbol,
              "MARKET_DATA_STORAGE_ERROR",
              "The validated market snapshot could not be stored."
            ));
            recordFailure(marketError, { stage: "snapshot-storage", symbol: row.symbol });
            if (isFatalDatabaseError(marketError)) {
              databaseUnavailable = true;
              break;
            }
          }
        }
        if (databaseUnavailable) {
          break;
        }
      }
      logProgress("market_snapshot_batch_completed", {
        batch: batchIndex,
        batchCount: batches.length,
        persisted: prepared.length
      });
    }

    result.snapshots.skipped = databaseUnavailable
      ? markets.length - result.snapshots.persisted - result.snapshots.missing - result.snapshots.failed
      : 0;
    if (result.snapshots.missing || result.snapshots.failed || result.snapshots.skipped) {
      result.snapshots.status = databaseUnavailable ? "failed" : "partial";
    }
    await writeFailureEvents(failureEvents);
    return { providerUnavailable, databaseUnavailable };
  }

  async function ingestInterval(markets, interval, overall) {
    const intervalResult = {
      interval,
      status: "completed",
      batchCount: Math.ceil(markets.length / batchSize),
      attempted: 0,
      refreshed: 0,
      unchanged: 0,
      missing: 0,
      failed: 0,
      skipped: 0,
      candlesPersisted: 0,
      providerUnavailable: false,
      databaseUnavailable: false
    };
    const marketBatches = chunks(markets, batchSize);

    for (let batchIndex = 0; batchIndex < marketBatches.length; batchIndex += 1) {
      if (intervalResult.providerUnavailable || intervalResult.databaseUnavailable) {
        break;
      }

      const marketBatch = marketBatches[batchIndex];
      let checkpoints;
      try {
        checkpoints = await ingestionRepository.getLatestCandleCheckpoints(
          marketBatch.map(({ symbol }) => symbol),
          interval
        );
      } catch (error) {
        intervalResult.attempted += marketBatch.length;
        intervalResult.failed += marketBatch.length;
        intervalResult.databaseUnavailable = true;
        recordFailure(error, { stage: "candle-checkpoint", interval, batch: batchIndex });
        await writeFailureEvents(marketBatch.map(({ symbol }) => scannerEvent(
          symbol,
          "CANDLE_DATA_STORAGE_ERROR",
          "The latest stored candle checkpoint could not be read."
        )));
        break;
      }

      const outcomes = await mapLimited(marketBatch, concurrency, async (market) => {
        if (intervalResult.providerUnavailable || intervalResult.databaseUnavailable) {
          return { status: "skipped" };
        }
        intervalResult.attempted += 1;
        const latestTimestamp = checkpoints.get(market.symbol);
        const intervalDuration = CANDLE_INTERVAL_MS[interval];
        const referenceTime = currentTimeMs();
        if (latestTimestamp !== undefined) {
          if (!Number.isSafeInteger(latestTimestamp) || latestTimestamp > referenceTime) {
            const error = new MarketDataIngestionError(
              "INVALID_CANDLE_CHECKPOINT",
              "The stored candle checkpoint is invalid or lies in the future."
            );
            return { status: "failed", errorCode: error.code, error };
          }
          const elapsed = referenceTime - latestTimestamp;
          if (elapsed < intervalDuration) {
            return { status: "unchanged" };
          }
        }

        const limit = latestTimestamp === undefined
          ? MAX_CANDLES_PER_MARKET
          : Math.min(
            MAX_CANDLES_PER_MARKET,
            Math.max(2, Math.floor((referenceTime - latestTimestamp) / intervalDuration) + 1)
          );
        try {
          overall.providerRequests += 1;
          const providerRows = await bitvavoClient.fetchCandles(market.symbol, interval, {
            limit,
            start: latestTimestamp ?? null
          });
          const candles = parseCandleRows(providerRows, {
            symbol: market.symbol,
            interval,
            limit,
            nowMs: referenceTime
          });
          if (candles.length === 0) {
            const error = new BitvavoProviderError(
              "CANDLE_DATA_MISSING",
              `Bitvavo returned no valid ${interval} candles for this watched market.`
            );
            return { status: "missing", errorCode: error.code, error };
          }
          const persisted = await ingestionRepository.upsertCandles(candles);
          return { status: "refreshed", candlesPersisted: persisted };
        } catch (error) {
          if (isFatalDatabaseError(error)) {
            intervalResult.databaseUnavailable = true;
          }
          if (error instanceof BitvavoProviderError
            && GLOBAL_PROVIDER_FAILURES.has(error.code)) {
            intervalResult.providerUnavailable = true;
          }
          return { status: "failed", errorCode: safeErrorCode(error), error };
        }
      });

      const failureEvents = [];
      for (let index = 0; index < marketBatch.length; index += 1) {
        const market = marketBatch[index];
        const outcome = outcomes[index];
        if (outcome.status === "refreshed") {
          intervalResult.refreshed += 1;
          intervalResult.candlesPersisted += outcome.candlesPersisted;
        } else if (outcome.status === "unchanged") {
          intervalResult.unchanged += 1;
        } else if (outcome.status === "missing") {
          intervalResult.missing += 1;
          failureEvents.push(scannerEvent(
            market.symbol,
            "CANDLE_DATA_MISSING",
            outcome.error.message
          ));
          recordFailure(outcome.error, { stage: "candle-validation", interval, symbol: market.symbol });
        } else if (outcome.status === "failed") {
          intervalResult.failed += 1;
          failureEvents.push(scannerEvent(
            market.symbol,
            outcome.error instanceof BitvavoProviderError
              ? outcome.error.code
              : "CANDLE_DATA_STORAGE_ERROR",
            `The ${interval} candle refresh failed; existing candle history was left unchanged.`
          ));
          recordFailure(outcome.error, { stage: "candle-refresh", interval, symbol: market.symbol });
        } else {
          intervalResult.skipped += 1;
        }
      }
      await writeFailureEvents(failureEvents);
      logProgress("market_candle_batch_completed", {
        interval,
        batch: batchIndex,
        batchCount: marketBatches.length,
        attempted: outcomes.filter(({ status }) => status !== "skipped").length
      });
    }

    intervalResult.skipped = markets.length - intervalResult.attempted;
    if (intervalResult.databaseUnavailable) {
      intervalResult.status = "database-unavailable";
    } else if (intervalResult.providerUnavailable) {
      intervalResult.status = "provider-unavailable";
    } else if (intervalResult.failed || intervalResult.missing || intervalResult.skipped) {
      intervalResult.status = "partial";
    } else if (intervalResult.unchanged === markets.length) {
      intervalResult.status = "up-to-date";
    }
    return intervalResult;
  }

  async function writeFailureEvents(events) {
    if (typeof ingestionRepository.insertScannerEvents !== "function") {
      return;
    }
    for (const batch of chunks(events, batchSize)) {
      if (!batch.length) {
        continue;
      }
      try {
        await ingestionRepository.insertScannerEvents(batch);
      } catch (error) {
        recordFailure(error, { stage: "scanner-event-storage" });
        logger.error(JSON.stringify({
          event: "market_data_event_storage_failed",
          ...createIngestionFailureDiagnostic(error, {
            component: "postgres-write-transaction"
          })
        }));
      }
    }
  }

  function recordFailure(error, context) {
    const diagnosticError = error || new MarketDataIngestionError(
      "INGESTION_FAILURE_DETAILS_MISSING",
      `The ${context.stage} stage failed without an error object.`
    );
    logger.error(JSON.stringify({
      event: "market_data_ingestion_failure",
      ...context,
      ...createIngestionFailureDiagnostic(diagnosticError, {
        component: "market-data-ingestion"
      })
    }));
  }

  function logProgress(event, fields) {
    logger.info(JSON.stringify({ event, ...fields }));
  }

  function currentTimeMs() {
    const value = now();
    const timestamp = value instanceof Date ? value.getTime() : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      throw new MarketDataIngestionError("INVALID_CLOCK", "The ingestion clock is invalid.");
    }
    return timestamp;
  }

  function currentTimestamp() {
    return new Date(currentTimeMs()).toISOString();
  }
}

export function parseTickerSnapshot(ticker, capturedAt) {
  if (!ticker || typeof ticker.market !== "string"
    || !MARKET_SYMBOL_PATTERN.test(ticker.market)) {
    return null;
  }
  const open = finiteNumber(ticker.open);
  const price = finiteNumber(ticker.last);
  const high = finiteNumber(ticker.high);
  const low = finiteNumber(ticker.low);
  const volume = finiteNumber(ticker.volume);
  if (open === null || open <= 0 || price === null || price <= 0
    || high === null || low === null || volume === null || volume < 0
    || low <= 0 || low > high || high < open || high < price || low > open || low > price) {
    return null;
  }
  const dailyChange = (price - open) / open * 100;
  if (!Number.isFinite(dailyChange) || Math.abs(dailyChange) >= 1_000_000) {
    return null;
  }
  return Object.freeze({
    symbol: ticker.market,
    price,
    volume,
    daily_change: dailyChange,
    high_24h: high,
    low_24h: low,
    captured_at: capturedAt
  });
}

export function parseCandleRows(rows, { symbol, interval, limit, nowMs }) {
  validateCandleRequest(symbol, interval, limit, nowMs);
  if (!Array.isArray(rows) || rows.length > limit) {
    throw new BitvavoProviderError(
      "INVALID_PROVIDER_RESPONSE",
      "Bitvavo returned an invalid candle list."
    );
  }

  const intervalDuration = CANDLE_INTERVAL_MS[interval];
  const candlesByTimestamp = new Map();
  for (const row of rows) {
    const values = Array.isArray(row) ? row : row && Array.isArray(row.value) ? row.value : null;
    if (!values || values.length < 6) {
      continue;
    }
    const timestamp = finiteNumber(values[0]);
    const open = finiteNumber(values[1]);
    const high = finiteNumber(values[2]);
    const low = finiteNumber(values[3]);
    const close = finiteNumber(values[4]);
    const volume = finiteNumber(values[5]);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > nowMs + 1000
      || !isCandleTimestampAligned(timestamp, interval)
      || open === null || open <= 0 || high === null || low === null || close === null
      || volume === null || volume < 0
      || high < low || high < open || high < close || low > open || low > close) {
      continue;
    }
    if (!isCandleClosed(timestamp, interval, nowMs)) {
      continue;
    }

    const candle = Object.freeze({
      symbol,
      interval,
      open,
      high,
      low,
      close,
      volume,
      timestamp: new Date(timestamp).toISOString()
    });
    const previous = candlesByTimestamp.get(timestamp);
    if (previous && !sameCandle(previous, candle)) {
      throw new BitvavoProviderError(
        "INVALID_PROVIDER_RESPONSE",
        "Bitvavo returned conflicting rows for one candle timestamp."
      );
    }
    candlesByTimestamp.set(timestamp, candle);
  }
  return [...candlesByTimestamp.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, candle]) => candle);
}

function validateIntervals(intervals) {
  if (!Array.isArray(intervals)
    || intervals.some((interval) => !SUPPORTED_INGESTION_INTERVALS.includes(interval))
    || new Set(intervals).size !== intervals.length) {
    throw new TypeError("A unique list of supported intervals is required.");
  }
}

function validateCandleRequest(symbol, interval, limit, nowMs) {
  if (typeof symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(symbol)
    || !SUPPORTED_INGESTION_INTERVALS.includes(interval)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CANDLES_PER_MARKET
    || !Number.isFinite(nowMs)) {
    throw new TypeError("A valid bounded candle request is required.");
  }
}

function indexTickers(tickers) {
  const bySymbol = new Map();
  const duplicates = new Set();
  if (!Array.isArray(tickers) || tickers.length > 2000) {
    throw new BitvavoProviderError(
      "INVALID_PROVIDER_RESPONSE",
      "Bitvavo returned an invalid ticker list."
    );
  }
  for (const ticker of tickers) {
    if (!ticker || typeof ticker.market !== "string") {
      continue;
    }
    if (bySymbol.has(ticker.market)) {
      duplicates.add(ticker.market);
    }
    bySymbol.set(ticker.market, ticker);
  }
  return { bySymbol, duplicates };
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapLimited(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      try {
        results[index] = await operation(items[index]);
      } catch (error) {
        results[index] = { status: "failed", errorCode: safeErrorCode(error), error };
      }
    }
  }));
  return results;
}

function scannerEvent(symbol, eventType, reason) {
  return { symbol, event_type: eventType, reason };
}

function skippedInterval(interval, marketCount, code) {
  return {
    interval,
    status: "skipped",
    batchCount: 0,
    attempted: 0,
    refreshed: 0,
    unchanged: 0,
    missing: 0,
    failed: 0,
    skipped: marketCount,
    candlesPersisted: 0,
    errorCode: code
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameCandle(left, right) {
  return left.open === right.open && left.high === right.high && left.low === right.low
    && left.close === right.close && left.volume === right.volume;
}

function isFatalDatabaseError(error) {
  const code = error?.cause?.code || error?.code;
  return typeof code === "string"
    && (FATAL_DATABASE_CODES.has(code) || code.startsWith("08"));
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "INGESTION_UNEXPECTED_ERROR";
}
