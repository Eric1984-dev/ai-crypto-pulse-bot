import {
  queryReadOnly,
  readFiniteNumber,
  readPositiveLimit,
  RepositoryDataError,
  readTimestamp
} from "./postgres-read.mjs";

export const MAX_MARKET_DATA_ROWS = 500;
export const MAX_CANDLE_ROWS = 500;
export const SUPPORTED_CANDLE_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
const MARKET_SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;

const MARKET_DATA_FOR_ENABLED_SQL = `
  SELECT market_data.symbol,
         market_data.price,
         market_data.volume,
         market_data.daily_change,
         market_data.high_24h,
         market_data.low_24h,
         market_data.captured_at
  FROM public."AI_Crypto_Bot_Watched_Markets" AS watched_market
  JOIN public."AI_Crypto_Bot_Market_Data" AS market_data
    ON market_data.symbol = watched_market.symbol
  WHERE watched_market.enabled IS TRUE
    AND watched_market.symbol = ANY($1::text[])
  ORDER BY watched_market.priority ASC, watched_market.symbol ASC
  LIMIT $2
`;

const MARKET_DATA_FOR_SYMBOL_SQL = `
  SELECT market_data.symbol,
         market_data.price,
         market_data.volume,
         market_data.daily_change,
         market_data.high_24h,
         market_data.low_24h,
         market_data.captured_at
  FROM public."AI_Crypto_Bot_Watched_Markets" AS watched_market
  JOIN public."AI_Crypto_Bot_Market_Data" AS market_data
    ON market_data.symbol = watched_market.symbol
  WHERE watched_market.enabled IS TRUE
    AND watched_market.symbol = $1
  LIMIT $2
`;

const CANDLES_FOR_SYMBOL_SQL = `
  SELECT candle.symbol, candle.interval, candle.open, candle.high,
         candle.low, candle.close, candle.volume, candle."timestamp"
  FROM public."AI_Crypto_Bot_Candles" AS candle
  JOIN public."AI_Crypto_Bot_Watched_Markets" AS watched_market
    ON watched_market.symbol = candle.symbol
  WHERE watched_market.enabled IS TRUE
    AND candle.symbol = $1
    AND candle.interval = $2
  ORDER BY candle."timestamp" DESC
  LIMIT $3
`;

export class MarketDataRepository {
  constructor(pool, { logger = console } = {}) {
    this.pool = pool;
    this.logger = logger;
  }

  async listForEnabledMarkets(markets, { limit = MAX_MARKET_DATA_ROWS } = {}) {
    const boundedLimit = readPositiveLimit(limit, MAX_MARKET_DATA_ROWS, MAX_MARKET_DATA_ROWS);
    if (!Array.isArray(markets) || markets.length > MAX_MARKET_DATA_ROWS) {
      throw new RangeError("A bounded enabled-market list is required.");
    }
    const symbols = markets.map(({ symbol }) => symbol);
    if (symbols.some((symbol) => typeof symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(symbol))) {
      throw new TypeError("Enabled markets contain an invalid symbol.");
    }
    if (symbols.length === 0) {
      return [];
    }
    const result = await queryReadOnly(
      this.pool,
      MARKET_DATA_FOR_ENABLED_SQL,
      [symbols, boundedLimit],
      { logger: this.logger }
    );
    return result.rows.map(normalizeMarketDataRow);
  }

  async findForEnabledSymbol(symbol) {
    validateSymbol(symbol);
    const result = await queryReadOnly(
      this.pool,
      MARKET_DATA_FOR_SYMBOL_SQL,
      [symbol, 1],
      { logger: this.logger }
    );
    return result.rows[0] ? normalizeMarketDataRow(result.rows[0]) : null;
  }

  async listCandles(symbol, interval, { limit = 200 } = {}) {
    validateSymbol(symbol);
    if (!SUPPORTED_CANDLE_INTERVALS.includes(interval)) {
      throw new TypeError("A supported candle interval is required.");
    }
    const boundedLimit = readPositiveLimit(limit, MAX_CANDLE_ROWS, 200);
    const result = await queryReadOnly(
      this.pool,
      CANDLES_FOR_SYMBOL_SQL,
      [symbol, interval, boundedLimit],
      { logger: this.logger }
    );
    return result.rows.map(normalizeCandleRow);
  }
}

function validateSymbol(symbol) {
  if (typeof symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(symbol)) {
    throw new TypeError("A valid EUR market symbol is required.");
  }
}

function normalizeMarketDataRow(row) {
  const normalized = {
    ...row,
    price: readFiniteNumber(row.price, "market price"),
    volume: readFiniteNumber(row.volume, "market volume"),
    daily_change: readFiniteNumber(row.daily_change, "market daily change"),
    high_24h: readFiniteNumber(row.high_24h, "market 24-hour high"),
    low_24h: readFiniteNumber(row.low_24h, "market 24-hour low"),
    captured_at: readTimestamp(row.captured_at, "market capture timestamp")
  };
  if (normalized.price <= 0 || normalized.volume < 0
    || normalized.high_24h <= 0 || normalized.low_24h <= 0
    || normalized.low_24h > normalized.high_24h) {
    throw new RepositoryDataError("invalid market snapshot values");
  }
  return normalized;
}

function normalizeCandleRow(row) {
  const normalized = {
    ...row,
    open: readFiniteNumber(row.open, "candle open"),
    high: readFiniteNumber(row.high, "candle high"),
    low: readFiniteNumber(row.low, "candle low"),
    close: readFiniteNumber(row.close, "candle close"),
    volume: readFiniteNumber(row.volume, "candle volume"),
    timestamp: readTimestamp(row.timestamp, "candle timestamp")
  };
  if ([normalized.open, normalized.high, normalized.low, normalized.close].some((price) => price <= 0)
    || normalized.volume < 0
    || normalized.high < normalized.low
    || normalized.high < normalized.open
    || normalized.high < normalized.close
    || normalized.low > normalized.open
    || normalized.low > normalized.close) {
    throw new RepositoryDataError("invalid candle values");
  }
  return normalized;
}
