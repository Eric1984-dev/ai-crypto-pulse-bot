import {
  queryReadOnly,
  RepositoryDataError
} from "./postgres-read.mjs";

export const MAX_ENABLED_MARKETS = 500;
const MARKET_SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const ENABLED_MARKETS_SQL = `
  SELECT id, symbol, enabled, priority
  FROM public."AI_Crypto_Bot_Watched_Markets"
  WHERE enabled IS TRUE
  ORDER BY priority ASC, symbol ASC
  LIMIT $1
`;
const ENABLED_MARKET_BY_SYMBOL_SQL = `
  SELECT id, symbol, enabled, priority
  FROM public."AI_Crypto_Bot_Watched_Markets"
  WHERE enabled IS TRUE
    AND symbol = $1
  LIMIT $2
`;

export async function readEnabledWatchedMarkets(pool, { logger = console } = {}) {
  const result = await queryReadOnly(
    pool,
    ENABLED_MARKETS_SQL,
    [MAX_ENABLED_MARKETS + 1],
    { logger }
  );
  if (result.rows.length > MAX_ENABLED_MARKETS) {
    throw new RepositoryDataError("enabled watched-market capacity exceeded");
  }
  return result.rows;
}

export class WatchedMarketsRepository {
  constructor(pool, { logger = console } = {}) {
    this.pool = pool;
    this.logger = logger;
  }

  async listEnabled() {
    return readEnabledWatchedMarkets(this.pool, { logger: this.logger });
  }

  async findEnabledBySymbol(symbol) {
    if (typeof symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(symbol)) {
      throw new TypeError("A valid EUR market symbol is required.");
    }
    const result = await queryReadOnly(
      this.pool,
      ENABLED_MARKET_BY_SYMBOL_SQL,
      [symbol, 1],
      { logger: this.logger }
    );
    return result.rows[0] || null;
  }
}
