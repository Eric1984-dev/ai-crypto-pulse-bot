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
import { generateRecommendations } from "../lib/recommendations.mjs";
import { SHADOW_EXIT_RULES } from "../lib/shadow-exits.mjs";
import { fetchArchiveServerHealth } from "../lib/archive-server-health.mjs";

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
    let requestContext = null;
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
      requestContext = {
        view: request.view,
        exportType: request.view === "export" || request.view === "export-count"
          ? request.params.get("type")
          : null
      };

      if (request.view === "archive-health") {
        const data = await fetchArchiveServerHealth({
          baseUrl: env.ARCHIVE_SERVER_URL,
          token: env.ARCHIVE_HEALTH_TOKEN,
          environment: env.NODE_ENV,
          fetchImpl
        });
        sendJson(res, 200, { data });
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
      } else if (request.view === "recommendations") {
        const analytics = await analyticsService.load({
          config,
          accessToken,
          now: now(),
          period: readAnalyticsPeriod(request.params)
        });
        data = generateRecommendations(analytics);
      } else {
        data = await loadDashboardData({ config, accessToken, fetchImpl, now, logger });
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
        logAnalyticsQueryFailure(logger, error, requestContext);
        const diagnostics = createDevelopmentDiagnostics(env, error, requestContext);
        sendJson(res, 503, {
          error: {
            code: "DASHBOARD_DATA_UNAVAILABLE",
            message: "Dashboard data is temporarily unavailable.",
            ...(diagnostics ? { diagnostics } : {})
          }
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

function logAnalyticsQueryFailure(logger, error, requestContext) {
  const diagnostics = error && typeof error === "object"
    ? error.analyticsDiagnostics
    : null;
  if (!diagnostics || typeof logger?.error !== "function") {
    return;
  }
  const field = (value) => value === null || value === undefined || value === ""
    ? "unknown"
    : String(value).replaceAll(/[^A-Za-z0-9_.:-]/g, "_");
  const exact = (value) => typeof value === "string" ? JSON.stringify(value) : "unknown";
  logger.error(
    `Analytics query failed. VIEW=${field(requestContext?.view)} `
      + `EXPORT_TYPE=${field(requestContext?.exportType)} DATASET=${field(diagnostics.tableName)} `
      + `QUERY=${field(diagnostics.queryName)} TABLE=${field(diagnostics.tableName)} `
      + `OPERATION=${field(diagnostics.operationName)} PAGE=${field(diagnostics.pageNumber)} `
      + `RANGE=${field(diagnostics.range)} REQUEST_QUERY=${exact(diagnostics.query)} `
      + `HTTP_STATUS=${field(diagnostics.httpStatus)} ERROR_CODE=${field(diagnostics.databaseCode)} `
      + `SUPABASE_MESSAGE=${exact(diagnostics.databaseMessage)} `
      + `SUPABASE_DETAILS=${exact(diagnostics.databaseDetails)} SUPABASE_HINT=${exact(diagnostics.databaseHint)} `
      + `FAILURE_CATEGORY=${field(diagnostics.failureCategory)}`
  );
}

function createDevelopmentDiagnostics(env, error, requestContext) {
  if (env.NODE_ENV !== "development") {
    return null;
  }
  const source = error && typeof error === "object"
    ? error.analyticsDiagnostics
    : null;
  if (!source) {
    return null;
  }
  return {
    view: requestContext?.view ?? null,
    exportType: requestContext?.exportType ?? null,
    dataset: source.tableName ?? null,
    queryName: source.queryName ?? null,
    query: source.query ?? null,
    operation: source.operationName ?? null,
    page: source.pageNumber ?? null,
    range: source.range ?? null,
    responseStatus: source.httpStatus ?? null,
    supabaseCode: source.databaseCode ?? null,
    supabaseMessage: source.databaseMessage ?? null,
    supabaseDetails: source.databaseDetails ?? null,
    supabaseHint: source.databaseHint ?? null,
    failureCategory: source.failureCategory ?? null
  };
}

function readDashboardRequest(req) {
  let url;
  try {
    url = new URL(typeof req.url === "string" ? req.url : "/", "http://localhost");
  } catch {
    return null;
  }
  const views = url.searchParams.getAll("view");
  const supportedViews = new Set([
    "trade-history",
    "analytics",
    "recommendations",
    "archive-health",
    "export-count",
    "export"
  ]);
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
  const [totalCount, stats, openPositions] = await Promise.all([
    fetchCount(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", filters.query),
    fetchTradeHistoryStats(config, accessToken, fetchImpl),
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Positions", {
      select: "portfolio_id,symbol,amount,entry_price,current_price,created_at",
      status: "eq.OPEN",
      order: "created_at.desc",
      limit: String(limits.positions)
    })
  ]);
  const totalPages = Math.ceil(totalCount / tradeHistoryPageSize);
  const page = totalPages ? Math.min(filters.page, totalPages) : 1;
  const pageResultRequest = totalCount
    ? fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", {
      ...filters.query,
      select: "id,portfolio_id,symbol,side,price,quantity,fees,realized_pnl,created_at",
      order: tradeHistorySorts[filters.sort],
      limit: String(tradeHistoryPageSize),
      offset: String((page - 1) * tradeHistoryPageSize)
    })
    : Promise.resolve({ rows: [] });
  const [pageResult, marketDataBySymbol] = await Promise.all([
    pageResultRequest,
    loadMarketDataForPositions({ config, accessToken, fetchImpl }, openPositions.rows)
  ]);
  const positionItems = openPositions.rows.map((position) => (
    addCurrentMarketPrice(position, marketDataBySymbol)
  ));
  const openPositionsByTradeKey = new Map(
    positionItems.map((position) => [getPositionTradeKey(position), position])
  );
  const items = pageResult.rows.map((trade) => {
    const position = trade.side === "BUY"
      ? openPositionsByTradeKey.get(getPositionTradeKey(trade))
      : null;
    const publicTrade = Object.fromEntries(
      Object.entries(trade).filter(([field]) => field !== "portfolio_id")
    );
    return position
      ? {
        ...publicTrade,
        openPosition: {
          amount: position.amount,
          entry_price: position.entry_price,
          current_market_price: position.current_market_price,
          current_market_captured_at: position.current_market_captured_at
        }
      }
      : publicTrade;
  });

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
    items,
    stats
  };
}

async function loadMarketDataForPositions({ config, accessToken, fetchImpl }, positions) {
  const symbols = getOpenPositionSymbols(positions);
  if (!symbols.length) {
    return new Map();
  }

  const marketData = await fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Market_Data", {
    select: "symbol,price,captured_at",
    symbol: `in.(${symbols.join(",")})`,
    limit: String(symbols.length)
  });
  return new Map(marketData.rows.map((row) => [row.symbol, row]));
}

async function loadLatestAiDecisionsForPositions({ config, accessToken, fetchImpl }, positions) {
  const symbols = getOpenPositionSymbols(positions);
  const decisions = await Promise.all(symbols.map(async (symbol) => {
    const result = await fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_AI_Decisions", {
      select: "symbol,decision,confidence,indicators,created_at",
      symbol: `eq.${symbol}`,
      order: "created_at.desc,id.desc",
      limit: "1"
    });
    const row = result.rows[0];
    return [symbol, row
      ? {
          decision: row.decision,
          confidence: row.confidence === null || row.confidence === undefined
            ? null
            : toFiniteNumber(row.confidence, "decision confidence"),
          marketStrength: readMarketStrength(row.indicators),
          created_at: row.created_at
        }
      : null];
  }));
  return new Map(decisions);
}

function getOpenPositionSymbols(positions) {
  const symbols = [...new Set(positions.map((position) => position.symbol))];
  if (symbols.some((symbol) => typeof symbol !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(symbol))) {
    throw new DashboardDataError("Supabase returned an invalid open-position symbol.");
  }
  return symbols;
}

function addCurrentMarketPrice(position, marketDataBySymbol) {
  const snapshot = marketDataBySymbol.get(position.symbol);
  return {
    ...position,
    current_market_price: snapshot ? snapshot.price : position.current_price,
    current_market_captured_at: snapshot ? snapshot.captured_at : null
  };
}

function getPositionTradeKey(position) {
  if (
    !position
    || typeof position.portfolio_id !== "string"
    || typeof position.symbol !== "string"
    || typeof position.created_at !== "string"
  ) {
    return null;
  }
  return `${position.portfolio_id}\u0000${position.symbol}\u0000${position.created_at}`;
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

function readMarketStrength(indicators) {
  if (!indicators || typeof indicators !== "object" || Array.isArray(indicators)) {
    return null;
  }
  const value = indicators.marketStrength;
  return value === null || value === undefined
    ? null
    : toFiniteNumber(value, "market strength");
}

async function loadDashboardData({ config, accessToken, fetchImpl, now, logger }) {
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
    latestMarketData,
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
    fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Market_Data", {
      select: "captured_at",
      order: "captured_at.desc",
      limit: "1"
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
  const positionDataArgs = { config, accessToken, fetchImpl };
  const [marketDataBySymbol, latestAiDecisionsBySymbol, shadowExitScenarios] = await Promise.all([
    loadMarketDataForPositions(positionDataArgs, openPositions.rows),
    loadLatestAiDecisionsForPositions(positionDataArgs, openPositions.rows),
    loadShadowExitScenarios({
      config,
      accessToken,
      fetchImpl,
      openPositions: openPositions.rows,
      logger
    })
  ]);
  const positionItems = openPositions.rows.map((position) => (
    addCurrentMarketPrice(position, marketDataBySymbol)
  ));
  const openPositionAiStatusItems = positionItems.map((position) => ({
    ...position,
    latestAiDecision: latestAiDecisionsBySymbol.get(position.symbol) || null
  }));
  const openPositionsByTradeKey = new Map(
    positionItems.map((position) => [getPositionTradeKey(position), position])
  );
  const recentTradeItems = recentTrades.rows.map((trade) => {
    const position = trade.side === "BUY"
      ? openPositionsByTradeKey.get(getPositionTradeKey(trade))
      : null;
    return position ? { ...trade, openPosition: position } : trade;
  });

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
    lastMarketDataAt: latestMarketData.rows[0]
      ? latestMarketData.rows[0].captured_at
      : null,
    portfolio: portfolioSummary,
    openPositions: {
      count: openPositions.count,
      items: positionItems
    },
    openPositionAiStatus: {
      count: openPositions.count,
      items: openPositionAiStatusItems
    },
    shadowExitScenarios,
    recentTrades: {
      count: recentTrades.count,
      items: recentTradeItems
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

async function loadShadowExitScenarios({
  config,
  accessToken,
  fetchImpl,
  openPositions,
  logger
}) {
  const columns = [
    "id",
    "position_id",
    "portfolio_id",
    "symbol",
    "position_opened_at",
    "amount",
    "entry_price",
    "rule_id",
    "rule_version",
    "parameters",
    "status",
    "data_quality_status",
    "tracking_started_at",
    "last_evaluated_at",
    "last_mark",
    "last_mark_captured_at",
    "high_water_mark",
    "trailing_armed",
    "activated_at",
    "triggered_at",
    "trigger_mark",
    "modeled_exit_price",
    "modeled_net_pnl",
    "actual_trade_id",
    "actual_closed_at",
    "actual_close_price",
    "actual_net_pnl",
    "finalized_at"
  ].join(",");
  const validOpenPositions = openPositions.filter((position) => (
    typeof position.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(position.id)
  ));
  const openPositionIds = validOpenPositions.map(({ id }) => id);

  try {
    const [openRows, closedRows] = await Promise.all([
      openPositionIds.length
        ? fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Shadow_Exit_Scenarios", {
          select: columns,
          position_id: `in.(${openPositionIds.join(",")})`,
          order: "position_id.asc,rule_id.asc",
          limit: String(openPositionIds.length * SHADOW_EXIT_RULES.length)
        })
        : Promise.resolve({ rows: [], count: 0 }),
      fetchRows(config, accessToken, fetchImpl, "AI_Crypto_Bot_Shadow_Exit_Scenarios", {
        select: columns,
        actual_closed_at: "not.is.null",
        order: "actual_closed_at.desc,position_id.asc,rule_id.asc",
        limit: String(5 * SHADOW_EXIT_RULES.length)
      })
    ]);
    const openScenarios = openRows.rows.map(normalizeShadowExitScenario);
    const closedScenarios = closedRows.rows.map(normalizeShadowExitScenario);
    const openByPosition = new Map();
    const closedByPosition = new Map();
    for (const scenario of openScenarios) {
      addShadowScenario(openByPosition, scenario);
    }
    for (const scenario of closedScenarios) {
      addShadowScenario(closedByPosition, scenario);
    }

    const positions = validOpenPositions.map((position) => ({
      positionId: position.id,
      symbol: position.symbol,
      positionOpenedAt: position.created_at,
      isOpen: true,
      actualClosedAt: null,
      actualClosePrice: null,
      actualNetPnl: null,
      scenarios: SHADOW_EXIT_RULES.map((rule) => (
        openByPosition.get(position.id)?.get(rule.id)
          || createUninitializedShadowScenario(position, rule)
      ))
    }));

    for (const [positionId, scenariosByRule] of closedByPosition) {
      const firstScenario = scenariosByRule.values().next().value;
      if (!firstScenario) {
        continue;
      }
      positions.push({
        positionId,
        symbol: firstScenario.symbol,
        positionOpenedAt: firstScenario.position_opened_at,
        isOpen: false,
        actualClosedAt: firstScenario.actual_closed_at,
        actualClosePrice: firstScenario.actual_close_price,
        actualNetPnl: firstScenario.actual_net_pnl,
        scenarios: SHADOW_EXIT_RULES
          .map(({ id }) => scenariosByRule.get(id))
          .filter(Boolean)
      });
    }

    return { status: "AVAILABLE", positions };
  } catch (error) {
    if (logger && typeof logger.error === "function") {
      logger.error(
        "Shadow exit dashboard data unavailable.",
        error instanceof Error ? error.name : "UnknownError"
      );
    }
    return { status: "UNAVAILABLE", positions: [] };
  }
}

function addShadowScenario(positionMap, scenario) {
  let scenarios = positionMap.get(scenario.position_id);
  if (!scenarios) {
    scenarios = new Map();
    positionMap.set(scenario.position_id, scenarios);
  }
  scenarios.set(scenario.rule_id, scenario);
}

function normalizeShadowExitScenario(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)
    || typeof row.id !== "string"
    || typeof row.position_id !== "string"
    || typeof row.symbol !== "string"
    || typeof row.rule_id !== "string"
    || typeof row.rule_version !== "string"
    || !SHADOW_EXIT_RULES.some((rule) => rule.id === row.rule_id)
    || !row.parameters
    || typeof row.parameters !== "object"
    || Array.isArray(row.parameters)
    || !["TRACKING", "TRIGGERED", "CLOSED_WITHOUT_TRIGGER"].includes(row.status)
    || !["AWAITING_FIRST_FRESH_MARK", "FRESH", "STALE", "INVALID", "UNAVAILABLE"]
      .includes(row.data_quality_status)) {
    throw new DashboardDataError("Supabase returned invalid shadow exit scenario data.");
  }

  const status = row.status === "TRIGGERED"
    ? "TRIGGERED_HYPOTHETICALLY"
    : row.status === "CLOSED_WITHOUT_TRIGGER"
      ? "CLOSED_WITHOUT_TRIGGER"
      : row.data_quality_status === "FRESH"
        ? "TRACKING"
        : "WAITING_FOR_FRESH_DATA";

  return {
    id: row.id,
    position_id: row.position_id,
    portfolio_id: row.portfolio_id,
    symbol: row.symbol,
    position_opened_at: readShadowTimestamp(row.position_opened_at, "position opened"),
    amount: readNullableNumber(row.amount, "shadow position amount"),
    entry_price: readNullableNumber(row.entry_price, "shadow entry price"),
    rule_id: row.rule_id,
    rule_name: SHADOW_EXIT_RULES.find((rule) => rule.id === row.rule_id).name,
    rule_version: row.rule_version,
    parameters: row.parameters,
    status,
    data_quality_status: row.data_quality_status,
    tracking_started_at: readShadowTimestamp(row.tracking_started_at, "tracking start"),
    last_evaluated_at: readShadowTimestamp(row.last_evaluated_at, "last evaluation"),
    last_mark: readNullableNumber(row.last_mark, "last mark"),
    last_mark_captured_at: readShadowTimestamp(row.last_mark_captured_at, "last mark timestamp"),
    high_water_mark: readNullableNumber(row.high_water_mark, "high-water mark"),
    trailing_armed: row.trailing_armed === true,
    activated_at: readShadowTimestamp(row.activated_at, "trailing activation"),
    triggered_at: readShadowTimestamp(row.triggered_at, "hypothetical trigger"),
    trigger_mark: readNullableNumber(row.trigger_mark, "hypothetical trigger mark"),
    modeled_exit_price: readNullableNumber(row.modeled_exit_price, "modeled exit price"),
    modeled_net_pnl: readNullableNumber(row.modeled_net_pnl, "modeled net P&L"),
    actual_trade_id: row.actual_trade_id,
    actual_closed_at: readShadowTimestamp(row.actual_closed_at, "actual close"),
    actual_close_price: readNullableNumber(row.actual_close_price, "actual close price"),
    actual_net_pnl: readNullableNumber(row.actual_net_pnl, "actual net P&L"),
    finalized_at: readShadowTimestamp(row.finalized_at, "scenario finalization")
  };
}

function readShadowTimestamp(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DashboardDataError(`Invalid shadow exit timestamp: ${field}.`);
  }
  return value;
}

function createUninitializedShadowScenario(position, rule) {
  return {
    id: null,
    position_id: position.id,
    portfolio_id: position.portfolio_id,
    symbol: position.symbol,
    position_opened_at: position.created_at,
    amount: readNullableNumber(position.amount, "position amount"),
    entry_price: readNullableNumber(position.entry_price, "position entry price"),
    rule_id: rule.id,
    rule_name: rule.name,
    rule_version: rule.version,
    parameters: rule.parameters,
    status: "WAITING_FOR_FRESH_DATA",
    data_quality_status: "AWAITING_FIRST_FRESH_MARK",
    tracking_started_at: null,
    last_evaluated_at: null,
    last_mark: null,
    last_mark_captured_at: null,
    high_water_mark: null,
    trailing_armed: false,
    activated_at: null,
    triggered_at: null,
    trigger_mark: null,
    modeled_exit_price: null,
    modeled_net_pnl: null,
    actual_trade_id: null,
    actual_closed_at: null,
    actual_close_price: null,
    actual_net_pnl: null,
    finalized_at: null
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
