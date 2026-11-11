import { ApiError } from "./api-error.mjs";
import { requireAuthenticated } from "../auth/authentication-middleware.mjs";
import { buildMarketScannerSummary } from "../../../lib/market-scanner.mjs";
import { generateRecommendations } from "../../../lib/recommendations.mjs";
import {
  getAnalyticsExportCounts,
  getAnalyticsExportRows,
  isAnalyticsExportType
} from "../../../lib/analytics-exports.mjs";
import {
  EXPORT_DEFINITIONS,
  streamCsvRows
} from "../../../lib/exports.mjs";
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
import { SUPPORTED_DASHBOARD_ANALYTICS_PERIODS } from "../services/dashboard-analytics.mjs";
import { collectSystemMetrics } from "../monitoring/system-metrics.mjs";

export const DATA_PATHS = Object.freeze({
  markets: "/api/v1/markets",
  market: "/api/v1/market",
  dashboard: "/api/v1/dashboard-data",
  agentStatus: "/api/v1/agent-status",
  marketSummary: "/api/v1/market-summary",
  monitoring: "/api/v1/monitoring"
});

const STATUS_VALUES = new Set(["ACTIVE", "ANALYZING", "IDLE", "STOPPED", "ERROR"]);
const MARKET_SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const MARKET_QUERY_SCHEMA = Object.freeze({
  symbol: Object.freeze({}),
  interval: Object.freeze({}),
  limit: Object.freeze({})
});
const TRADE_HISTORY_QUERY_SCHEMA = Object.freeze({
  view: Object.freeze({ validate: (value) => value === "trade-history" }),
  page: Object.freeze({
    validate: (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000000,
    parse: Number }),
  side: Object.freeze({ validate: (value) => ["all", "BUY", "SELL"].includes(value) }),
  period: Object.freeze({ validate: (value) => ["all", "24h", "7d", "30d"].includes(value) }),
  search: Object.freeze({ validate: (value) => value.length <= 80 }),
  sort: Object.freeze({
    validate: (value) => [
      "newest", "oldest", "market", "action", "price-high", "price-low",
      "quantity-high", "quantity-low", "fees-high", "fees-low", "pnl-high", "pnl-low"
    ].includes(value)
  })
});
const AI_HISTORY_QUERY_SCHEMA = Object.freeze({
  view: Object.freeze({ validate: (value) => value === "ai-history" }),
  page: Object.freeze({
    validate: (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000000,
    parse: Number }),
  pageSize: Object.freeze({
    validate: (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100,
    parse: Number })
});
const ANALYTICS_QUERY_SCHEMA = Object.freeze({
  view: Object.freeze({ validate: (value) => ["analytics", "recommendations"].includes(value) }),
  period: Object.freeze({
    validate: (value) => SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(value)
  })
});
const EXPORT_TYPES = Object.freeze([
  ...Object.keys(EXPORT_DEFINITIONS),
  "analytics-summary",
  "trade-analytics",
  "portfolio-analytics",
  "ai-analytics",
  "recommendations",
  "recommendation-history"
]);
const EXPORT_QUERY_SCHEMA = Object.freeze({
  view: Object.freeze({ validate: (value) => ["export", "export-count"].includes(value) }),
  type: Object.freeze({ required: true, validate: (value) => EXPORT_TYPES.includes(value) }),
  period: Object.freeze({
    validate: (value) => [
      "24h", "7d", "30d", "all", "90d", "365d"
    ].includes(value)
  })
});

export function registerDataRoutes(router, repositories, {
  now = () => new Date(),
  getOperationalHealth = () => null,
  getSystemMetrics = collectSystemMetrics
} = {}) {
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
    const rawView = new URL(context.request.url || "/", "http://localhost")
      .searchParams.get("view");
    const querySchema = rawView === "export" || rawView === "export-count"
      ? EXPORT_QUERY_SCHEMA
      : rawView === "trade-history"
        ? TRADE_HISTORY_QUERY_SCHEMA
        : rawView === "ai-history"
          ? AI_HISTORY_QUERY_SCHEMA
      : rawView === "analytics" || rawView === "recommendations"
        ? ANALYTICS_QUERY_SCHEMA
        : Object.freeze({});
    const query = validateQuery(context.request, querySchema);
    requireAuthenticated(context);
    if (query.view === "export-count" || query.view === "export") {
      const exportType = query.type;
      const period = query.period || (
        isAnalyticsExportType(exportType) ? "30d" : "all"
      );
      if (isAnalyticsExportType(exportType)) {
        if (!SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(period)) {
          throw new ApiError(400, "INVALID_EXPORT_PERIOD", "The export period is invalid.");
        }
        const analytics = await readRepository(
          () => repositories.dashboard.getAnalytics({
            period,
            now: new Date(readClock(now))
          }),
          "ANALYTICS_UNAVAILABLE",
          "Analytics data is temporarily unavailable."
        );
        const exportData = getAnalyticsExportRows(exportType, analytics);
        if (query.view === "export-count") {
          sendJson(context, 200, {
            data: { exportType, period, recordCount: exportData.rows.length }
          });
        } else {
          await streamCsvRows(context.response, exportType, period, exportData.headers, exportData.rows);
        }
        return;
      }

      if (!["24h", "7d", "30d", "all"].includes(period)) {
        throw new ApiError(400, "INVALID_EXPORT_PERIOD", "The export period is invalid.");
      }
      if (query.view === "export-count") {
        const recordCount = await readRepository(
          () => repositories.dashboard.getExportRecordCount({
            exportType,
            period,
            now: new Date(readClock(now))
          }),
          "EXPORT_UNAVAILABLE",
          "Export data is temporarily unavailable."
        );
        sendJson(context, 200, { data: { exportType, period, recordCount } });
        return;
      }
      const records = await readRepository(
        () => repositories.dashboard.getExportRecords({
          exportType,
          period,
          now: new Date(readClock(now))
        }),
        "EXPORT_UNAVAILABLE",
        "Export data is temporarily unavailable."
      );
      const accountData = exportType === "portfolio"
        ? await repositories.dashboard.getSystemDashboardData()
        : null;
      await streamCsvRows(
        context.response,
        exportType,
        period,
        EXPORT_DEFINITIONS[exportType].headers,
        records.map((row) => mapExportRow(exportType, row, accountData))
      );
      return;
    }
    if (query.view === "trade-history") {
      const history = await readRepository(
        () => repositories.dashboard.getTradeHistory({
          page: query.page || 1,
          side: query.side || "all",
          period: query.period || "all",
          search: query.search || "",
          sort: query.sort || "newest",
          now: readClock(now)
        }),
        "TRADE_HISTORY_UNAVAILABLE",
        "Trade history is temporarily unavailable."
      );
      sendJson(context, 200, { data: history });
      return;
    }
    if (query.view === "ai-history") {
      const history = await readRepository(
        () => repositories.aiDecisions.listHistory({
          page: query.page || 1,
          pageSize: query.pageSize || 25
        }),
        "AI_HISTORY_UNAVAILABLE",
        "AI decision history is temporarily unavailable."
      );
      sendJson(context, 200, { data: history });
      return;
    }
    if (query.view === "analytics" || query.view === "recommendations") {
      const analytics = await readRepository(
        () => repositories.dashboard.getAnalytics({
          period: query.period || "30d",
          now: new Date(readClock(now))
        }),
        "ANALYTICS_UNAVAILABLE",
        "Analytics data is temporarily unavailable."
      );
      if (query.view === "analytics") {
        analytics.exportCounts = getAnalyticsExportCounts(analytics);
        sendJson(context, 200, { data: analytics });
      } else {
        sendJson(context, 200, { data: generateRecommendations(analytics) });
      }
      return;
    }
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
    const accountData = await readRepository(
      () => repositories.dashboard.getSystemDashboardData(),
      "DASHBOARD_DATA_UNAVAILABLE",
      "Dashboard data is temporarily unavailable."
    );

    sendJson(context, 200, {
      data: {
        generatedAt,
        agentStatus: status,
        emergencyState: accountData.emergencyState,
        portfolio: accountData.portfolio,
        openPositions: accountData.openPositions,
        openPositionAiStatus: accountData.openPositionAiStatus,
        recentTrades: accountData.recentTrades,
        portfolioSnapshots: accountData.portfolioSnapshots,
        lastMarketDataAt: accountData.lastMarketDataAt || latestTimestamp(marketData),
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

  router.register("GET", DATA_PATHS.monitoring, async (context) => {
    validateQuery(context.request);
    requireAuthenticated(context);
    const generatedAt = readClock(now);
    const [operational, database, system, agentStatus] = await Promise.all([
      getOperationalHealth(),
      readRepository(
        () => repositories.dashboard.getMonitoringMetrics(),
        "MONITORING_UNAVAILABLE",
        "Runtime monitoring data is temporarily unavailable."
      ),
      getSystemMetrics(),
      readRepository(
        () => repositories.runtimeStatus.getStatus(),
        "MONITORING_UNAVAILABLE",
        "Runtime monitoring data is temporarily unavailable."
      )
    ]);
    if (!operational || typeof operational !== "object") {
      throw new ApiError(
        503,
        "MONITORING_UNAVAILABLE",
        "Runtime monitoring data is temporarily unavailable."
      );
    }
    sendJson(context, 200, {
      data: {
        server: "online",
        postgresql: "online",
        database: "online",
        diskUsage: system.disk.usedPercent,
        databaseSize: formatBytes(database.databaseSizeBytes),
        lastHealthCheck: generatedAt,
        runtime: operational,
        system,
        databaseSizeBytes: database.databaseSizeBytes,
        tableRowsAreEstimated: true,
        tableCounts: database.estimatedRows,
        stages: operational.lastCycle?.stages || null,
        agentStatus: agentStatus?.status || null
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
    const [marketData, dailyCandles, hourlyCandles, decisions] = await readRepository(
      () => Promise.all([
        repositories.marketData.listForEnabledMarkets(markets),
        repositories.marketData.listRecentCandlesForEnabledMarkets(markets, "1d", { perMarket: 35 }),
        repositories.marketData.listRecentCandlesForEnabledMarkets(markets, "1h", { perMarket: 12 }),
        repositories.aiDecisions.listRecent({ limit: 100 })
      ]),
      "MARKET_DATA_UNAVAILABLE",
      "Stored market data is temporarily unavailable."
    );
    const generatedAt = readClock(now);
    const scanner = buildMarketScannerSummary({
      activeMarkets: markets,
      marketData,
      dailyCandles,
      hourlyCandles,
      decisions,
      now: new Date(generatedAt)
    });
    sendJson(context, 200, {
      data: {
        scanner
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
    marketData: [
      "findForEnabledSymbol",
      "listCandles",
      "listForEnabledMarkets",
      "listRecentCandlesForEnabledMarkets"
    ],
    aiDecisions: ["listRecent", "listHistory"],
    dashboard: [
      "getSystemDashboardData",
      "getTradeHistory",
      "getAnalytics",
      "getExportRecordCount",
      "getExportRecords",
      "getMonitoringMetrics"
    ],
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

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function mapExportRow(exportType, row, accountData) {
  if (exportType === "trades") {
    const gross = multiplyDecimal(row.price, row.quantity);
    const fee = String(row.fees);
    const isBuy = row.side === "BUY";
    return [
      row.created_at,
      row.symbol,
      row.side,
      String(row.price),
      String(row.quantity),
      isBuy ? gross : "",
      fee,
      gross,
      isBuy ? addDecimal(gross, fee) : subtractDecimal(gross, fee),
      row.side === "SELL" ? String(row.realized_pnl) : "",
      "Executed · Paper Trade"
    ];
  }
  if (exportType === "portfolio") {
    const startingBalance = accountData?.portfolio?.startingBalance;
    if (startingBalance === null || startingBalance === undefined) {
      throw new ApiError(503, "EXPORT_UNAVAILABLE", "Portfolio export data is unavailable.");
    }
    return [
      row.captured_at,
      String(row.portfolio_value),
      String(row.available_balance),
      row.open_positions,
      subtractDecimal(row.portfolio_value, startingBalance),
      ""
    ];
  }
  if (exportType === "decisions") {
    return [
      row.created_at,
      row.symbol,
      row.decision,
      String(row.confidence),
      row.indicators?.marketStrength === null || row.indicators?.marketStrength === undefined
        ? ""
        : String(row.indicators.marketStrength),
      row.reason
    ];
  }
  if (exportType === "positions") {
    return [
      row.created_at,
      row.symbol,
      String(row.entry_price),
      String(row.current_price),
      multiplyDecimal(row.current_price, row.amount),
      String(row.unrealized_pnl),
      row.status
    ];
  }
  throw new ApiError(400, "INVALID_EXPORT_TYPE", "The export type is invalid.");
}

const DECIMAL_SCALE = 10n ** 12n;

function decimalToScaled(value) {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[3]?.length || 0) > 12) {
    throw new ApiError(503, "EXPORT_DATA_INVALID", "Stored export values are invalid.");
  }
  const fraction = (match[3] || "").padEnd(12, "0");
  const scaled = BigInt(match[2]) * DECIMAL_SCALE + BigInt(fraction || "0");
  return match[1] ? -scaled : scaled;
}

function scaledToDecimal(value) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = String(absolute % DECIMAL_SCALE).padStart(12, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function addDecimal(left, right) {
  return scaledToDecimal(decimalToScaled(left) + decimalToScaled(right));
}

function subtractDecimal(left, right) {
  return scaledToDecimal(decimalToScaled(left) - decimalToScaled(right));
}

function multiplyDecimal(left, right) {
  const product = decimalToScaled(left) * decimalToScaled(right);
  const quotient = product / DECIMAL_SCALE;
  const remainder = product % DECIMAL_SCALE;
  const rounded = (remainder < 0n ? -remainder : remainder) * 2n >= DECIMAL_SCALE
    ? quotient + (product < 0n ? -1n : 1n)
    : quotient;
  return scaledToDecimal(rounded);
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
