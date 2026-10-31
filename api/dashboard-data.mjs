import authSession from "../lib/auth-session.js";

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
  dailyTrades: 1000
});

export function createHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  verify = (token, config) => verifyAccessToken(token, config, fetchImpl),
  now = () => new Date()
} = {}) {
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
      const data = await loadDashboardData({ config, accessToken, fetchImpl, now });
      sendJson(res, 200, { data });
    } catch (error) {
      if (error instanceof InvalidSessionError) {
        clearCookie(res, env);
        sendJson(res, 401, {
          error: { code: "INVALID_SESSION", message: "Your session is invalid or expired." }
        });
        return;
      }

      if (error instanceof DashboardDataError || error instanceof TypeError) {
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
    sellTradeCount,
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
    fetchCount(config, accessToken, fetchImpl, "AI_Crypto_Bot_Trades", { side: "eq.SELL" }),
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
    dailySellTrades,
    sellTradeCount,
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

function createPortfolioSummary(portfolios, dailySellTrades, sellTradeCount, winningSellTradeCount) {
  if (!portfolios.length) {
    return {
      count: 0,
      portfolioValue: null,
      totalPnl: null,
      availableBalance: null,
      dailyPnl: dailySellTrades.count > dailySellTrades.rows.length
        ? null
        : sumNumericRows(dailySellTrades.rows, "realized_pnl"),
      dailyPnlTradeCount: dailySellTrades.count,
      winRate: sellTradeCount > 0 ? winningSellTradeCount / sellTradeCount * 100 : null,
      winRateTradeCount: sellTradeCount
    };
  }

  const startingBalance = sumNumericRows(portfolios, "starting_balance");
  const portfolioValue = sumNumericRows(portfolios, "portfolio_value");
  return {
    count: portfolios.length,
    portfolioValue,
    totalPnl: portfolioValue - startingBalance,
    availableBalance: sumNumericRows(portfolios, "available_balance"),
    dailyPnl: dailySellTrades.count > dailySellTrades.rows.length
      ? null
      : sumNumericRows(dailySellTrades.rows, "realized_pnl"),
    dailyPnlTradeCount: dailySellTrades.count,
    winRate: sellTradeCount > 0 ? winningSellTradeCount / sellTradeCount * 100 : null,
    winRateTradeCount: sellTradeCount
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

  const headers = {
    apikey: config.supabaseAnonKey,
    authorization: `Bearer ${accessToken}`,
    accept: "application/json"
  };
  if (includeCount) {
    headers.prefer = "count=exact";
  }

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
