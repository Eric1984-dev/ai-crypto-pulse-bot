import { ApiError } from "./api-error.mjs";
import { requireAuthenticated } from "../auth/authentication-middleware.mjs";
import {
  MAX_CANDLE_ROWS,
  SUPPORTED_CANDLE_INTERVALS
} from "../repositories/market-data-repository.mjs";
import {
  RepositoryDataError,
  RepositoryUnavailableError
} from "../repositories/postgres-read.mjs";
import { MAX_ENABLED_MARKETS } from "../repositories/watched-markets-repository.mjs";
import { validateEnabledWatchedMarkets } from "../services/watched-markets.mjs";
import { validateQuery } from "./request-validation.mjs";

export const DATA_PATHS = Object.freeze({
  markets: "/api/v1/markets",
  market: "/api/v1/market",
  dashboard: "/api/v1/dashboard-data",
  agentStatus: "/api/v1/agent-status",
  marketSummary: "/api/v1/market-summary"
});

const STATUS_VALUES = new Set(["ACTIVE", "ANALYZING", "IDLE", "STOPPED", "ERROR"]);
const MARKET_SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const MARKET_QUERY_SCHEMA = Object.freeze({
  symbol: Object.freeze({}),
  interval: Object.freeze({}),
  limit: Object.freeze({})
});

export function registerDataRoutes(router, repositories, { now = () => new Date() } = {}) {
  validateRepositories(repositories);

  router.register("GET", DATA_PATHS.markets, async (context) => {
    validateQuery(context.request);
    requireAuthenticated(context);
    const markets = await readRepository(
      () => repositories.watchedMarkets.listEnabled(),
      "MARKETS_UNAVAILABLE",
      "Watched markets are temporarily unavailable."
    );
    validateMarketRows(markets);
    sendJson(context, 200, {
      data: {
        count: markets.length,
        items: markets.map(({ id, symbol, enabled, priority }) => ({
          id,
          symbol,
          enabled,
          priority
        }))
      }
    });
  });

  router.register("GET", DATA_PATHS.market, async (context) => {
    const { symbol, interval, limit } = parseMarketQuery(context.request);
    requireAuthenticated(context);
    const market = await readRepository(
      () => repositories.watchedMarkets.findEnabledBySymbol(symbol),
      "MARKET_DATA_UNAVAILABLE",
      "Stored market data is temporarily unavailable."
    );
    if (!market || market.enabled !== true) {
      throw new ApiError(404, "MARKET_NOT_TRACKED", "The requested market is not enabled.");
    }

    const [marketData, candles] = await readRepository(
      () => Promise.all([
        repositories.marketData.findForEnabledSymbol(symbol),
        repositories.marketData.listCandles(symbol, interval, { limit })
      ]),
      "MARKET_DATA_UNAVAILABLE",
      "Stored market data is temporarily unavailable."
    );
    sendJson(context, 200, {
      data: {
        symbol,
        interval,
        marketData,
        candles,
        refreshStatus: "read-only"
      }
    });
  });

  router.register("GET", DATA_PATHS.dashboard, async (context) => {
    validateQuery(context.request);
    requireAuthenticated(context);
    const generatedAt = readClock(now);
    const [markets, status, recentDecisions] = await readRepository(
      () => Promise.all([
        repositories.watchedMarkets.listEnabled(),
        repositories.runtimeStatus.getStatus(),
        repositories.aiDecisions.listRecent({ limit: 5 })
      ]),
      "DASHBOARD_DATA_UNAVAILABLE",
      "Dashboard data is temporarily unavailable."
    );
    validateMarketRows(markets);
    const marketData = await readRepository(
      () => repositories.marketData.listForEnabledMarkets(markets),
      "DASHBOARD_DATA_UNAVAILABLE",
      "Dashboard data is temporarily unavailable."
    );

    sendJson(context, 200, {
      data: {
        generatedAt,
        agentStatus: status,
        lastMarketDataAt: latestTimestamp(marketData),
        watchedMarkets: {
          count: markets.length,
          items: markets.map(({ id, symbol, enabled, priority }) => ({
            id,
            symbol,
            enabled,
            priority
          }))
        },
        marketData: {
          count: marketData.length,
          items: marketData
        },
        aiDecisions: {
          count: recentDecisions.length,
          items: recentDecisions
        }
      }
    });
  });

  router.register("GET", DATA_PATHS.agentStatus, async (context) => {
    validateQuery(context.request);
    requireAuthenticated(context);
    const status = await readRepository(
      () => repositories.runtimeStatus.getStatus(),
      "AGENT_STATUS_UNAVAILABLE",
      "Agent status is temporarily unavailable."
    );
    const value = typeof status?.status === "string" ? status.status.toUpperCase() : null;
    sendJson(context, 200, {
      data: { status: STATUS_VALUES.has(value) ? value : null }
    });
  });

  router.register("GET", DATA_PATHS.marketSummary, async (context) => {
    validateQuery(context.request);
    requireAuthenticated(context);
    const markets = await readRepository(
      () => repositories.watchedMarkets.listEnabled(),
      "MARKET_DATA_UNAVAILABLE",
      "Stored market data is temporarily unavailable."
    );
    validateMarketRows(markets);
    const items = await readRepository(
      () => repositories.marketData.listForEnabledMarkets(markets),
      "MARKET_DATA_UNAVAILABLE",
      "Stored market data is temporarily unavailable."
    );
    sendJson(context, 200, {
      data: {
        activeMarkets: markets.length,
        marketsWithData: items.length,
        items,
        refreshedAt: latestTimestamp(items),
        refreshStatus: "read-only"
      }
    });
  });

  return router;
}

function parseMarketQuery(request) {
  const query = validateQuery(request, MARKET_QUERY_SCHEMA);
  if (!query.symbol || !MARKET_SYMBOL_PATTERN.test(query.symbol)) {
    throw new ApiError(400, "INVALID_MARKET", "A valid EUR market symbol is required.");
  }
  const interval = query.interval || "1m";
  if (!SUPPORTED_CANDLE_INTERVALS.includes(interval)) {
    throw new ApiError(400, "INVALID_INTERVAL", "The requested candle interval is not supported.");
  }
  const rawLimit = query.limit === undefined ? "200" : query.limit;
  if (!/^\d+$/.test(rawLimit)) {
    throw invalidLimit();
  }
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CANDLE_ROWS) {
    throw invalidLimit();
  }
  return Object.freeze({ symbol: query.symbol, interval, limit });
}

function invalidLimit() {
  return new ApiError(400, "INVALID_LIMIT", `Candle limit must be between 1 and ${MAX_CANDLE_ROWS}.`);
}

function validateMarketRows(markets) {
  if (!Array.isArray(markets) || markets.length > MAX_ENABLED_MARKETS) {
    throw new ApiError(503, "MARKETS_UNAVAILABLE", "Watched markets are temporarily unavailable.");
  }
  if (markets.length > 0) {
    try {
      validateEnabledWatchedMarkets(markets);
    } catch (error) {
      if (error?.code === "WATCHED_MARKETS_INVALID") {
        throw new ApiError(503, "MARKETS_UNAVAILABLE", "Watched markets are temporarily unavailable.");
      }
      throw error;
    }
  }
}

async function readRepository(operation, errorCode, message) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RepositoryUnavailableError || error instanceof RepositoryDataError) {
      throw new ApiError(503, errorCode, message);
    }
    throw error;
  }
}

function validateRepositories(repositories) {
  const requiredMethods = {
    watchedMarkets: ["listEnabled", "findEnabledBySymbol"],
    marketData: ["findForEnabledSymbol", "listCandles", "listForEnabledMarkets"],
    aiDecisions: ["listRecent"],
    runtimeStatus: ["getStatus"]
  };
  if (!repositories || Object.entries(requiredMethods).some(([name, methods]) =>
    !repositories[name] || methods.some((method) => typeof repositories[name][method] !== "function"))) {
    throw new TypeError("All read-only data repositories are required.");
  }
}

function latestTimestamp(rows) {
  let latest = null;
  let latestTime = -Infinity;
  for (const row of rows) {
    const timestamp = row.captured_at;
    const parsed = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
    if (!Number.isFinite(parsed)) {
      throw new ApiError(503, "DATA_UNAVAILABLE", "Stored data is temporarily unavailable.");
    }
    if (parsed > latestTime) {
      latest = timestamp instanceof Date ? timestamp.toISOString() : new Date(parsed).toISOString();
      latestTime = parsed;
    }
  }
  return latest;
}

function readClock(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("The runtime clock returned an invalid timestamp.");
  }
  return value.toISOString();
}

function sendJson(context, statusCode, payload) {
  context.response.statusCode = statusCode;
  context.response.setHeader("Content-Type", "application/json; charset=utf-8");
  context.response.end(JSON.stringify(payload));
}
