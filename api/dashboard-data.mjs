import authSession from "../lib/auth-session.js";
import {
  createExportsService,
  ExportDataError,
  ExportRequestError,
  ExportSessionError
} from "../lib/exports.mjs";
import {
  ANALYTICS_PERIODS,
  AnalyticsDataError,
  AnalyticsRequestError,
  createAnalyticsService
} from "../lib/analytics.mjs";
import {
  createAnalyticsExportsService,
  getAnalyticsExportCounts,
  isAnalyticsExportType
} from "../lib/analytics-exports.mjs";

const {
  clearSessionCookie,
  getPublicConfig,
  readAccessToken,
  verifyAccessToken
} = authSession;

const limits = Object.freeze({
  portfolios: 1000,
  positions: 5,
  trades: 5,
  markets: 8,
  decisions: 5,
  snapshots: 100,
  dailyTrades: 1000,
  realizedTrades: 1000
});

const tradeHistoryPageSize = 25;
const tradeHistorySorts = Object.freeze({
  newest: "created_at.desc,id.desc",
  oldest: "created_at.asc,id.asc",
  market: "symbol.asc,created_at.desc,id.desc",
  action: "side.asc,created_at.desc,id.desc",
  "price-high": "price.desc,created_at.desc,id.desc",
  "price-low": "price.asc,created_at.desc,id.desc",
  "quantity-high": "quantity.desc,created_at.desc,id.desc",
  "quantity-low": "quantity.asc,created_at.desc,id.desc",
  "fees-high": "fees.desc,created_at.desc,id.desc",
  "fees-low": "fees.asc,created_at.desc,id.desc",
  "pnl-high": "realized_pnl.desc,created_at.desc,id.desc",
  "pnl-low": "realized_pnl.asc,created_at.desc,id.desc"
});

export function createHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  verify = (token, config) => verifyAccessToken(token, config, fetchImpl),
  now = () => new Date(),
  logger = console
} = {}) {
  const exportsService = createExportsService({ fetchImpl });
  const analyticsService = createAnalyticsService({ fetchImpl });
  const analyticsExportsService = createAnalyticsExportsService({ analyticsService });
  return async function handler(req, res) {
    setResponseHeaders(res);
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
      return;
    }

    const config = getPublicConfig(env);
    if (!config) {
      sendJson(res, 503, {
        error: { code: "SUPABASE_NOT_CONFIGURED", message: "Dashboard data is not configured." }
      });
      return;
    }

    const accessToken = readAccessToken(req.headers.cookie || "");
    if (!accessToken) {
      clearCookie(res, env);
      sendJson(res, 401, {
        error: { code: "AUTH_REQUIRED", message: "A valid authenticated session is required." }
      });
      return;
    }

    try {
      if (!await verify(accessToken, config)) {
        clearCookie(res, env);
        sendJson(res, 401, {
          error: { code: "INVALID_SESSION", message: "Your session is invalid or expired." }
        });
        return;
      }
    } catch {
      sendJson(res, 503, {
        error: { code: "AUTH_UNAVAILABLE", message: "Authentication could not be verified." }
      });
      return;
    }

    try {
      const request = readDashboardRequest(req);
      if (!request) {
        sendJson(res, 400, {
          error: { code: "INVALID_DASHBOARD_VIEW", message: "The requested dashboard view is invalid." }
        });
        return;
      }

      if (request.view === "export-count") {
        const exportType = request.params.get("type");
        const period = readExportPeriod(request.params, exportType);
        const service = isAnalyticsExportType(exportType) ? analyticsExportsService : exportsService;
        const recordCount = await service.getRecordCount({
          config,
          accessToken,
          exportType,
          period,
          now: now()
        });
        sendJson(res, 200, {
          data: {
            exportType,
            period,
            recordCount
          }
        });
        return;
      }

      if (request.view === "export") {
        const exportType = request.params.get("type");
        const service = isAnalyticsExportType(exportType) ? analyticsExportsService : exportsService;
        await service.streamCsv({
          config,
          accessToken,
          exportType,
          period: readExportPeriod(request.params, exportType),
          now: now(),
          response: res
        });
        return;
      }

      let data;
      if (request.view === "trade-history") {
        data = await loadTradeHistory({ config, accessToken, fetchImpl, now, params: request.params });
      } else if (request.view === "analytics") {
        data = await analyticsService.load({
          config,
          accessToken,
          now: now(),
          period: readAnalyticsPeriod(request.params)
        });
        data.exportCounts = getAnalyticsExportCounts(data);
      } else {
        data = await loadDashboardData({ config, accessToken, fetchImpl, now });
      }
      sendJson(res, 200, { data });
    } catch (error) {
      if (res.headersSent) {
        console.error("CSV export stream failed.", error instanceof Error ? error.name : "Unknown error");
        res.destroy?.();
        return;
      }
      res.removeHeader?.("Content-Disposition");

      if (error instanceof ExportRequestError) {
        sendJson(res, 400, {
          error: { code: "INVALID_EXPORT_QUERY", message: "The export type or date filter is invalid." }
        });
        return;
      }

      if (error instanceof AnalyticsRequestError) {
        sendJson(res, 400, {
          error: { code: "INVALID_ANALYTICS_PERIOD", message: "The analytics date range is invalid." }
        });
        return;
      }

      if (error instanceof ExportSessionError) {
        clearCookie(res, env);
        sendJson(res, 401, {
          error: { code: "INVALID_SESSION", message: "Your session is invalid or expired." }
        });
        return;
      }

      if (error instanceof InvalidTradeHistoryRequestError) {
        sendJson(res, 400, {
          error: { code: "INVALID_TRADE_HISTORY_QUERY", message: "The trade history filters are invalid." }
        });
        return;
      }

      if (error instanceof InvalidSessionError) {
        clearCookie(res, env);
        sendJson(res, 401, {
          error: { code: "INVALID_SESSION", message: "Your session is invalid or expired." }
        });
        return;
      }

      if (error instanceof DashboardDataError
        || error instanceof AnalyticsDataError
        || error instanceof ExportDataError
        || error instanceof TypeError) {
        logAnalyticsQueryFailure(logger, error);
        sendJson(res, 503, {
          error: { code: "DASHBOARD_DATA_UNAVAILABLE", message: "Dashboard data is temporarily unavailable." }
        });
        return;
      }

      console.error("Unexpected dashboard data failure.", error instanceof Error ? error.name : "Unknown error");
      sendJson(res, 500, {
        error: { code: "DASHBOARD_REQUEST_FAILED", message: "The dashboard request could not be completed." }
      });
    }
  };
}

function readAnalyticsPeriod(params) {
  const values = params.getAll("period");
  if (values.length > 1) {
    throw new AnalyticsRequestError("The analytics period is invalid.");
  }
  const period = values[0] || "30d";
  if (!ANALYTICS_PERIODS.includes(period)) {
    throw new AnalyticsRequestError("The analytics period is invalid.");
  }
  return period;
}

function readExportPeriod(params, exportType) {
  const values = params.getAll("period");
  if (values.length > 1) {
    throw new ExportRequestError("The export period is invalid.");
  }
  return values[0] || (isAnalyticsExportType(exportType) ? "30d" : "all");
}

function logAnalyticsQueryFailure(logger, error) {
  const diagnostics = error && typeof error === "object"
    ? error.analyticsDiagnostics
    : null;
  if (!diagnostics || typeof logger?.error !== "function") {
    return;
  }
  const field = (value) => value === null || value === undefined || value === ""
    ? "unknown"
    : String(value).replaceAll(/[^A-Za-z0-9_.:-]/g, "_");
  logger.error(
    `Analytics query failed. QUERY=${field(diagnostics.queryName)} TABLE=${field(diagnostics.tableName)} `
      + `OPERATION=${field(diagnostics.operationName)} PAGE=${field(diagnostics.pageNumber)} `
      + `RANGE=${field(diagnostics.range)} HTTP_STATUS=${field(diagnostics.httpStatus)} `
      + `ERROR_CODE=${field(diagnostics.databaseCode)} FAILURE_CATEGORY=${field(diagnostics.failureCategory)}`
  );
}

function readDashboardRequest(req) {
  let url;
  try {
    url = new URL(typeof req.url === "string" ? req.url : "/", "http://localhost");
  } catch {
    return null;
  }
  const views = url.searchParams.getAll("view");
  const supportedViews = new Set(["trade-history", "analytics", "export-count", "export"]);
  if (views.length > 1 || (views.length === 1 && !supportedViews.has(views[0]))) {
    return null;
  }
  return {
    view: views[0] || "dashboard",
    params: url.searchParams
  };
}

async function loadTradeHistory({ config, accessToken, fetchImpl, now, params }) {
  const currentTime = now();
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    throw new DashboardDataError("Invalid trade-history clock.");
  }
  const filters = parseTradeHistoryFilters(params, currentTime);
  const [totalCount, stats] = await Promise.all([
    fetchCount(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", filters.query),
    fetchTradeHistoryStats(config, accessToken, fetchImpl)
  ]);
  const totalPages = Math.ceil(totalCount / tradeHistoryPageSize);
  const page = totalPages ? Math.min(filters.page, totalPages) : 1;
  const pageResult = totalCount
    ? await fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", {
      ...filters.query,
      select: "id,symbol,side,price,quantity,fees,realized_pnl,created_at",
      order: tradeHistorySorts[filters.sort],
      limit: String(tradeHistoryPageSize),
      offset: String((page - 1) * tradeHistoryPageSize)
    })
    : { rows: [] };

  return {
    page,
    pageSize: tradeHistoryPageSize,
    totalCount,
    totalPages,
    sort: filters.sort,
    filters: {
      search: filters.search,
      side: filters.side,
      period: filters.period
    },
    items: pageResult.rows,
    stats
  };
}

function parseTradeHistoryFilters(params, currentTime) {
  const pageValue = readSingleQueryValue(params, "page");
  const page = pageValue === null ? 1 : Number(pageValue);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new InvalidTradeHistoryRequestError();
  }

  const rawSearch = readSingleQueryValue(params, "search");
  const search = rawSearch === null ? "" : rawSearch.trim().toUpperCase();
  if (search.length > 32 || (search && !/^[A-Z0-9._-]+$/.test(search))) {
    throw new InvalidTradeHistoryRequestError();
  }

  const side = (readSingleQueryValue(params, "side") || "all").toUpperCase();
  if (!["ALL", "BUY", "SELL"].includes(side)) {
    throw new InvalidTradeHistoryRequestError();
  }

  const period = readSingleQueryValue(params, "period") || "all";
  if (!["all", "24h", "7d", "30d"].includes(period)) {
    throw new InvalidTradeHistoryRequestError();
  }

  const sort = readSingleQueryValue(params, "sort") || "newest";
  if (!Object.prototype.hasOwnProperty.call(tradeHistorySorts, sort)) {
    throw new InvalidTradeHistoryRequestError();
  }

  const query = {};
  if (search) {
    query.symbol = `like.${search}*`;
  }
  if (side !== "ALL") {
    query.side = `eq.${side}`;
  }
  const periodDurationMs = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000
  }[period];
  if (periodDurationMs) {
    query.created_at = `gte.${new Date(currentTime.getTime() - periodDurationMs).toISOString()}`;
  }

  return { page, search, side: side.toLowerCase(), period, sort, query };
}

function readSingleQueryValue(params, key) {
  const values = params.getAll(key);
  if (values.length > 1) {
    throw new InvalidTradeHistoryRequestError();
  }
  return values.length ? values[0] : null;
}

async function fetchTradeHistoryStats(config, accessToken, fetchImpl) {
  const url = new URL("/rest/v1/rpc/AI_Crypto_Bot_Trade_History_Stats", config.supabaseUrl);
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: createReadHeaders(config, accessToken),
    cache: "no-store"
  });
  if (response.status === 401) {
    throw new InvalidSessionError();
  }
  if (!response.ok) {
    throw new DashboardDataError("Supabase rejected a trade-history statistics request.");
  }

  let rows;
  try {
    rows = await response.json();
  } catch {
    throw new DashboardDataError("Supabase returned invalid trade-history statistics.");
  }
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new DashboardDataError("Supabase returned unexpected trade-history statistics.");
  }

  const row = rows[0];
  const stats = {
    closedTrades: readNonnegativeInteger(row.closed_trade_count, "closed_trade_count"),
    winningTrades: readNonnegativeInteger(row.winning_trade_count, "winning_trade_count"),
    losingTrades: readNonnegativeInteger(row.losing_trade_count, "losing_trade_count"),
    averageProfit: readNullableNumber(row.average_profit, "average_profit"),
    averageLoss: readNullableNumber(row.average_loss, "average_loss"),
    bestTrade: readNullableNumber(row.best_trade, "best_trade"),
    worstTrade: readNullableNumber(row.worst_trade, "worst_trade")
  };
  if (stats.winningTrades + stats.losingTrades > stats.closedTrades) {
    throw new DashboardDataError("Supabase returned inconsistent trade-history statistics.");
  }
  return stats;
}

function readNonnegativeInteger(value, field) {
  const number = toFiniteNumber(value, field);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new DashboardDataError(`Invalid trade-history count: ${field}.`);
  }
  return number;
}

function readNullableNumber(value, field) {
  return value === null ? null : toFiniteNumber(value, field);
}

async function loadDashboardData({ config, accessToken, fetchImpl, now }) {
  const currentTime = now();
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    throw new DashboardDataError("Invalid dashboard clock.");
  }
  const todayStart = new Date(currentTime);
  todayStart.setUTCHours(0, 0, 0, 0);

  const [
    agentStatus,
    emergencyState,
    portfolios,
    openPositions,
    recentTrades,
    watchedMarkets,
    aiDecisions,
    portfolioSnapshots,
    dailySellTrades,
    realizedSellTrades,
    winningSellTradeCount
  ] = await Promise.all([
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Status", {
      select: "status,is_active,is_analyzing,last_run,updated_at",
      limit: "1"
    }),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Emergency_State", {
      select: "status,created_at",
      order: "created_at.desc",
      limit: "1"
    }),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Portfolios", {
      select: "id,starting_balance,available_balance,portfolio_value",
      order: "created_at.asc",
      limit: String(limits.portfolios)
    }, true),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Positions", {
      select: "id,portfolio_id,symbol,amount,entry_price,current_price,unrealized_pnl,status,created_at",
      status: "eq.OPEN",
      order: "created_at.desc",
      limit: String(limits.positions)
    }, true),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", {
      select: "id,portfolio_id,symbol,side,price,quantity,fees,slippage,realized_pnl,created_at",
      order: "created_at.desc",
      limit: String(limits.trades)
    }, true),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Watched_Markets", {
      select: "id,symbol,enabled,priority",
      enabled: "eq.true",
      order: "priority.asc",
      limit: String(limits.markets)
    }, true),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_AI_Decisions", {
      select: "id,symbol,decision,confidence,reason,strategy_name,strategy_version,created_at",
      order: "created_at.desc",
      limit: String(limits.decisions)
    }, true),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Portfolio_Snapshots", {
      select: "portfolio_id,portfolio_value,captured_at",
      order: "captured_at.desc",
      limit: String(limits.snapshots)
    }),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", {
      select: "realized_pnl",
      side: "eq.SELL",
      created_at: `gte.${todayStart.toISOString()}`,
      order: "created_at.asc",
      limit: String(limits.dailyTrades)
    }, true),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", {
      select: "realized_pnl",
      side: "eq.SELL",
      order: "created_at.desc",
      limit: String(limits.realizedTrades)
    }, true),
    fetchCount(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", {
      side: "eq.SELL",
      realized_pnl: "gt.0"
    })
  ]);

  if (portfolios.count > portfolios.rows.length) {
    throw new DashboardDataError("Portfolio summary exceeded the supported page size.");
  }

  const portfolioSummary = createPortfolioSummary(
    portfolios.rows,
    openPositions,
    dailySellTrades,
    realizedSellTrades,
    winningSellTradeCount
  );

  return {
    generatedAt: currentTime.toISOString(),
    agentStatus: agentStatus.rows[0] || null,
    emergencyState: emergencyState.rows[0] || null,
    portfolio: portfolioSummary,
    openPositions: {
      count: openPositions.count,
      items: openPositions.rows
    },
    recentTrades: {
      count: recentTrades.count,
      items: recentTrades.rows
    },
    watchedMarkets: {
      count: watchedMarkets.count,
      items: watchedMarkets.rows
    },
    aiDecisions: {
      count: aiDecisions.count,
      items: aiDecisions.rows
    },
    portfolioSnapshots: portfolioSnapshots.rows.reverse()
  };
}

function createPortfolioSummary(
  portfolios,
  openPositions,
  dailySellTrades,
  realizedSellTrades,
  winningSellTradeCount
) {
  const realizedPnl = realizedSellTrades.count > realizedSellTrades.rows.length
    ? null
    : sumNumericRows(realizedSellTrades.rows, "realized_pnl");
  const unrealizedPnl = openPositions.count > openPositions.rows.length
    ? null
    : sumNumericRows(openPositions.rows, "unrealized_pnl");

  if (!portfolios.length) {
    return {
      count: 0,
      portfolioValue: null,
      totalPnl: null,
      availableBalance: null,
      realizedPnl,
      realizedPnlTradeCount: realizedSellTrades.count,
      unrealizedPnl,
      dailyPnl: dailySellTrades.count > dailySellTrades.rows.length
        ? null
        : sumNumericRows(dailySellTrades.rows, "realized_pnl"),
      dailyPnlTradeCount: dailySellTrades.count,
      winRate: realizedSellTrades.count > 0
        ? winningSellTradeCount / realizedSellTrades.count * 100
        : null,
      winRateTradeCount: realizedSellTrades.count
    };
  }

  const startingBalance = sumNumericRows(portfolios, "starting_balance");
  const portfolioValue = sumNumericRows(portfolios, "portfolio_value");
  return {
    count: portfolios.length,
    portfolioValue,
    totalPnl: portfolioValue - startingBalance,
    availableBalance: sumNumericRows(portfolios, "available_balance"),
    realizedPnl,
    realizedPnlTradeCount: realizedSellTrades.count,
    unrealizedPnl,
    dailyPnl: dailySellTrades.count > dailySellTrades.rows.length
      ? null
      : sumNumericRows(dailySellTrades.rows, "realized_pnl"),
    dailyPnlTradeCount: dailySellTrades.count,
    winRate: realizedSellTrades.count > 0
      ? winningSellTradeCount / realizedSellTrades.count * 100
      : null,
    winRateTradeCount: realizedSellTrades.count
  };
}

function sumNumericRows(rows, field) {
  return rows.reduce((total, row) => total + toFiniteNumber(row[field], field), 0);
}

function toFiniteNumber(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new DashboardDataError(`Invalid numeric database value: ${field}.`);
  }
  return number;
}

async function fetchRows(config, accessToken, fetchImpl, table, filters, includeCount = false) {
  const result = await fetchTable(config, accessToken, fetchImpl, table, filters, includeCount);
  return {
    rows: result.rows,
    count: includeCount ? result.count : result.rows.length
  };
}

async function fetchCount(config, accessToken, fetchImpl, table, filters) {
  const result = await fetchTable(config, accessToken, fetchImpl, table, {
    select: "id",
    ...filters,
    limit: "1"
  }, true);
  return result.count;
}

async function fetchTable(config, accessToken, fetchImpl, table, filters, includeCount) {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const headers = createReadHeaders(config, accessToken, includeCount);
  const response = await fetchImpl(url.toString(), { headers, cache: "no-store" });
  if (response.status === 401) {
    throw new InvalidSessionError();
  }
  if (!response.ok) {
    throw new DashboardDataError("Supabase rejected a dashboard data request.");
  }

  let rows;
  try {
    rows = await response.json();
  } catch {
    throw new DashboardDataError("Supabase returned invalid dashboard data.");
  }
  if (!Array.isArray(rows)) {
    throw new DashboardDataError("Supabase returned an unexpected dashboard response.");
  }

  return {
    rows,
    count: includeCount ? readExactCount(response.headers) : rows.length
  };
}

function createReadHeaders(config, accessToken, includeCount = false) {
  const headers = {
    apikey: config.supabaseAnonKey,
    authorization: `Bearer ${accessToken}`,
    accept: "application/json"
  };
  if (includeCount) {
    headers.prefer = "count=exact";
  }
  return headers;
}

function readExactCount(headers) {
  const contentRange = headers.get("content-range");
  const total = contentRange && contentRange.slice(contentRange.lastIndexOf("/") + 1);
  if (!total || total === "*" || !/^\d+$/.test(total)) {
    throw new DashboardDataError("Supabase did not return an exact row count.");
  }
  return Number(total);
}

class InvalidSessionError extends Error {}
class DashboardDataError extends Error {}
class InvalidTradeHistoryRequestError extends Error {}

function setResponseHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function clearCookie(res, env) {
  res.setHeader("Set-Cookie", clearSessionCookie({ secure: env.NODE_ENV === "production" }));
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default createHandler();
