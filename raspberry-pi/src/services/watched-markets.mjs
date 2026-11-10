const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MARKET_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;

export class WatchedMarketsContractError extends Error {
  constructor(reason) {
    super(`The enabled watched-market rows are invalid: ${reason}`);
    this.name = "WatchedMarketsContractError";
    this.code = "WATCHED_MARKETS_INVALID";
  }
}

export function validateEnabledWatchedMarkets(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new WatchedMarketsContractError("no enabled markets were returned.");
  }

  const ids = new Set();
  const symbols = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
      throw new WatchedMarketsContractError("an id is not a valid UUID.");
    }
    if (typeof row.symbol !== "string" || !MARKET_PATTERN.test(row.symbol)) {
      throw new WatchedMarketsContractError("a symbol does not match the stored market format.");
    }
    if (row.enabled !== true) {
      throw new WatchedMarketsContractError("a disabled row appeared in the enabled-market result.");
    }
    if (!Number.isSafeInteger(row.priority) || row.priority < 1) {
      throw new WatchedMarketsContractError("a priority is not a positive integer.");
    }
    if (ids.has(row.id) || symbols.has(row.symbol)) {
      throw new WatchedMarketsContractError("duplicate ids or symbols were returned.");
    }

    ids.add(row.id);
    symbols.add(row.symbol);
  }

  return Object.freeze(rows.map((row) => Object.freeze({
    id: row.id,
    symbol: row.symbol,
    enabled: row.enabled,
    priority: row.priority
  })));
}
