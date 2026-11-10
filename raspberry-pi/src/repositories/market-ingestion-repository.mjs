import { withWriteTransaction } from "../database/write-transaction.mjs";
import {
  queryReadOnly,
  readTimestamp,
  RepositoryDataError
} from "./postgres-read.mjs";

export const MAX_INGESTION_MARKETS_PER_BATCH = 5;
export const MAX_CANDLES_PER_MARKET = 500;
export const CANDLE_WRITE_BATCH_SIZE = 100;
const MARKET_SYMBOL_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const CANDLE_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
const CANDLE_CHECKPOINT_SQL = `
  SELECT candle.symbol, MAX(candle."timestamp") AS latest_timestamp
  FROM public."AI_Crypto_Bot_Candles" AS candle
  WHERE candle.symbol = ANY($1::text[])
    AND candle.interval = $2
  GROUP BY candle.symbol
  ORDER BY candle.symbol ASC
`;
const SNAPSHOT_UPSERT_SQL = `
  INSERT INTO public."AI_Crypto_Bot_Market_Data"
    (symbol, price, volume, daily_change, high_24h, low_24h, captured_at)
  VALUES %VALUES%
  ON CONFLICT (symbol) DO UPDATE
  SET price = EXCLUDED.price,
      volume = EXCLUDED.volume,
      daily_change = EXCLUDED.daily_change,
      high_24h = EXCLUDED.high_24h,
      low_24h = EXCLUDED.low_24h,
      captured_at = EXCLUDED.captured_at
`;
const CANDLE_UPSERT_SQL = `
  INSERT INTO public."AI_Crypto_Bot_Candles"
    (symbol, interval, open, high, low, close, volume, "timestamp")
  VALUES %VALUES%
  ON CONFLICT (symbol, interval, "timestamp") DO UPDATE
  SET open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume
`;
const SNAPSHOT_LOCK_SQL = `
  LOCK TABLE public."AI_Crypto_Bot_Market_Data" IN SHARE ROW EXCLUSIVE MODE
`;
const CANDLE_LOCK_SQL = `
  LOCK TABLE public."AI_Crypto_Bot_Candles" IN SHARE ROW EXCLUSIVE MODE
`;

export class MarketIngestionStorageError extends Error {
  constructor(cause) {
    super("A PostgreSQL market-data write failed.", { cause });
    this.name = "MarketIngestionStorageError";
    this.code = "POSTGRES_WRITE_FAILED";
  }
}

export class MarketCheckpointError extends Error {
  constructor(reason) {
    super("The stored candle checkpoint does not match the ingestion request.");
    this.name = "MarketCheckpointError";
    this.code = "INVALID_CANDLE_CHECKPOINT";
    this.reason = reason;
  }
}

export class MarketIngestionRepository {
  constructor(pool, { logger = console } = {}) {
    this.pool = pool;
    this.logger = logger;
  }

  async getLatestCandleCheckpoints(symbols, interval) {
    validateMarketBatch(symbols);
    validateInterval(interval);
    if (symbols.length === 0) {
      return new Map();
    }

    const result = await queryReadOnly(
      this.pool,
      CANDLE_CHECKPOINT_SQL,
      [symbols, interval],
      { logger: this.logger }
    );
    const requestedSymbols = new Set(symbols);
    const checkpoints = new Map();
    for (const row of result.rows) {
      if (typeof row.symbol !== "string"
        || !requestedSymbols.has(row.symbol)
        || checkpoints.has(row.symbol)) {
        throw new MarketCheckpointError("unexpected or repeated symbol");
      }
      checkpoints.set(
        row.symbol,
        Date.parse(readTimestamp(row.latest_timestamp, "candle checkpoint"))
      );
    }
    return checkpoints;
  }

  async upsertSnapshots(rows) {
    validateSnapshotRows(rows);
    if (rows.length === 0) {
      return 0;
    }
    return this.writeWithConstraintFallback(
      rows,
      SNAPSHOT_UPSERT_SQL,
      SNAPSHOT_LOCK_SQL,
      buildSnapshotValues,
      fallbackSnapshotUpsert
    );
  }

  async upsertCandles(rows) {
    validateCandleRows(rows);
    if (rows.length === 0) {
      return 0;
    }

    let persisted = 0;
    for (let offset = 0; offset < rows.length; offset += CANDLE_WRITE_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + CANDLE_WRITE_BATCH_SIZE);
      persisted += await this.writeWithConstraintFallback(
        batch,
        CANDLE_UPSERT_SQL,
        CANDLE_LOCK_SQL,
        buildCandleValues,
        fallbackCandleUpsert
      );
    }
    return persisted;
  }

  async insertScannerEvents(events) {
    if (!Array.isArray(events) || events.length > MAX_INGESTION_MARKETS_PER_BATCH) {
      throw new RangeError("Scanner events must be written in bounded market batches.");
    }
    for (const event of events) {
      if (!event || !MARKET_SYMBOL_PATTERN.test(event.symbol)
        || typeof event.event_type !== "string" || event.event_type.trim() === ""
        || typeof event.reason !== "string" || event.reason.trim() === "") {
        throw new TypeError("A valid scanner event is required.");
      }
    }
    if (events.length === 0) {
      return 0;
    }

    const values = buildValues(events, [
      { name: "symbol", type: "text" },
      { name: "event_type", type: "text" },
      { name: "reason", type: "text" }
    ]);
    try {
      return await withWriteTransaction(
        this.pool,
        async (client) => (await client.query(`
          INSERT INTO public."AI_Crypto_Bot_Scanner_Events"
            (symbol, event_type, reason)
          VALUES ${values.sql}
        `, values.parameters)).rowCount,
        { logger: this.logger }
      );
    } catch (error) {
      this.logWriteFailure(error, "scanner_events");
      throw new MarketIngestionStorageError(error);
    }
  }

  async writeWithConstraintFallback(rows, upsertSql, lockSql, buildValuesForRows, fallback) {
    const values = buildValuesForRows(rows);
    try {
      return await withWriteTransaction(
        this.pool,
        async (client) => (await client.query(
          upsertSql.replace("%VALUES%", values.sql),
          values.parameters
        )).rowCount,
        { logger: this.logger }
      );
    } catch (error) {
      if (error?.code !== "42P10") {
        this.logWriteFailure(error, "market_data");
        throw new MarketIngestionStorageError(error);
      }
    }

    try {
      return await withWriteTransaction(
        this.pool,
        async (client) => {
          await client.query(lockSql);
          return fallback(client, values);
        },
        { logger: this.logger }
      );
    } catch (error) {
      this.logWriteFailure(error, "market_data_legacy_constraint_fallback");
      throw new MarketIngestionStorageError(error);
    }
  }

  logWriteFailure(error, target) {
    this.logger.error(JSON.stringify({
      event: "market_data_storage_failed",
      target,
      code: safeErrorCode(error)
    }));
  }
}

async function fallbackSnapshotUpsert(client, values) {
  const updated = await client.query(`
    UPDATE public."AI_Crypto_Bot_Market_Data" AS stored
    SET price = incoming.price,
        volume = incoming.volume,
        daily_change = incoming.daily_change,
        high_24h = incoming.high_24h,
        low_24h = incoming.low_24h,
        captured_at = incoming.captured_at
    FROM (VALUES ${values.sql}) AS incoming
      (symbol, price, volume, daily_change, high_24h, low_24h, captured_at)
    WHERE stored.symbol = incoming.symbol
  `, values.parameters);
  const inserted = await client.query(`
    INSERT INTO public."AI_Crypto_Bot_Market_Data"
      (symbol, price, volume, daily_change, high_24h, low_24h, captured_at)
    SELECT incoming.symbol, incoming.price, incoming.volume, incoming.daily_change,
           incoming.high_24h, incoming.low_24h, incoming.captured_at
    FROM (VALUES ${values.sql}) AS incoming
      (symbol, price, volume, daily_change, high_24h, low_24h, captured_at)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Market_Data" AS stored
      WHERE stored.symbol = incoming.symbol
    )
  `, values.parameters);
  return updated.rowCount + inserted.rowCount;
}

async function fallbackCandleUpsert(client, values) {
  const updated = await client.query(`
    UPDATE public."AI_Crypto_Bot_Candles" AS stored
    SET open = incoming.open,
        high = incoming.high,
        low = incoming.low,
        close = incoming.close,
        volume = incoming.volume
    FROM (VALUES ${values.sql}) AS incoming
      (symbol, interval, open, high, low, close, volume, "timestamp")
    WHERE stored.symbol = incoming.symbol
      AND stored.interval = incoming.interval
      AND stored."timestamp" = incoming."timestamp"
  `, values.parameters);
  const inserted = await client.query(`
    INSERT INTO public."AI_Crypto_Bot_Candles"
      (symbol, interval, open, high, low, close, volume, "timestamp")
    SELECT incoming.symbol, incoming.interval, incoming.open, incoming.high,
           incoming.low, incoming.close, incoming.volume, incoming."timestamp"
    FROM (VALUES ${values.sql}) AS incoming
      (symbol, interval, open, high, low, close, volume, "timestamp")
    WHERE NOT EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Candles" AS stored
      WHERE stored.symbol = incoming.symbol
        AND stored.interval = incoming.interval
        AND stored."timestamp" = incoming."timestamp"
    )
  `, values.parameters);
  return updated.rowCount + inserted.rowCount;
}

function buildSnapshotValues(rows) {
  return buildValues(rows, [
    { name: "symbol", type: "text" },
    { name: "price", type: "numeric" },
    { name: "volume", type: "numeric" },
    { name: "daily_change", type: "numeric" },
    { name: "high_24h", type: "numeric" },
    { name: "low_24h", type: "numeric" },
    { name: "captured_at", type: "timestamptz" }
  ]);
}

function buildCandleValues(rows) {
  return buildValues(rows, [
    { name: "symbol", type: "text" },
    { name: "interval", type: "text" },
    { name: "open", type: "numeric" },
    { name: "high", type: "numeric" },
    { name: "low", type: "numeric" },
    { name: "close", type: "numeric" },
    { name: "volume", type: "numeric" },
    { name: "timestamp", type: "timestamptz" }
  ]);
}

function buildValues(rows, columns) {
  const parameters = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map(({ name, type }) => {
      parameters.push(row[name]);
      return `$${parameters.length}::${type}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return { sql: tuples.join(", "), parameters };
}

function validateMarketBatch(symbols) {
  if (!Array.isArray(symbols)
    || symbols.length > MAX_INGESTION_MARKETS_PER_BATCH
    || symbols.some((symbol) => typeof symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(symbol))
    || new Set(symbols).size !== symbols.length) {
    throw new TypeError("A unique, bounded watched-market batch is required.");
  }
}

function validateInterval(interval) {
  if (!CANDLE_INTERVALS.includes(interval)) {
    throw new TypeError("A supported candle interval is required.");
  }
}

function validateSnapshotRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_INGESTION_MARKETS_PER_BATCH) {
    throw new RangeError("Snapshots must be persisted in bounded market batches.");
  }
  const symbols = new Set();
  for (const row of rows) {
    if (!row || typeof row.symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(row.symbol)
      || symbols.has(row.symbol)
      || !Number.isFinite(row.price) || row.price <= 0
      || !Number.isFinite(row.volume) || row.volume < 0
      || !Number.isFinite(row.daily_change)
      || !Number.isFinite(row.high_24h) || row.high_24h <= 0
      || !Number.isFinite(row.low_24h) || row.low_24h <= 0
      || row.low_24h > row.high_24h
      || row.high_24h < row.price || row.low_24h > row.price
      || !Number.isFinite(Date.parse(row.captured_at))) {
      throw new RepositoryDataError("invalid market snapshot write");
    }
    symbols.add(row.symbol);
  }
}

function validateCandleRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_CANDLES_PER_MARKET) {
    throw new RangeError("Candle writes must be bounded to one market's response.");
  }
  const keys = new Set();
  let marketKey = null;
  for (const row of rows) {
    if (!row || typeof row.symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(row.symbol)
      || !CANDLE_INTERVALS.includes(row.interval)) {
      throw new RepositoryDataError("invalid candle symbol or interval");
    }
    const currentMarketKey = `${row.symbol}:${row.interval}`;
    if (marketKey !== null && marketKey !== currentMarketKey) {
      throw new RepositoryDataError("mixed market candle batch");
    }
    marketKey = currentMarketKey;
    const timestamp = Date.parse(row.timestamp);
    const key = `${currentMarketKey}:${timestamp}`;
    if (!Number.isFinite(timestamp) || keys.has(key)
      || !Number.isFinite(row.open) || row.open <= 0
      || !Number.isFinite(row.high) || row.high <= 0
      || !Number.isFinite(row.low) || row.low <= 0
      || !Number.isFinite(row.close) || row.close <= 0
      || !Number.isFinite(row.volume) || row.volume < 0
      || row.high < row.low || row.high < row.open || row.high < row.close
      || row.low > row.open || row.low > row.close) {
      throw new RepositoryDataError("invalid or duplicate candle write");
    }
    keys.add(key);
  }
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}
