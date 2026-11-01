import authSession from "./auth-session.js";
import {
  createMarketDataService,
  MAX_CANDLE_LIMIT,
  SUPPORTED_CANDLE_INTERVALS
} from "./market-data.mjs";

const {
  clearSessionCookie,
  getPublicConfig,
  readAccessToken,
  verifyAccessToken
} = authSession;

const marketDataService = createMarketDataService();

export function createMarketHandler(options = {}) {
  return createAuthenticatedHandler("market", options);
}

export function createMarketSummaryHandler(options = {}) {
  return createAuthenticatedHandler("summary", options);
}

function createAuthenticatedHandler(kind, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  verify = (token, config) => verifyAccessToken(token, config, fetchImpl),
  service = marketDataService,
  logger = console
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
        error: { code: "SUPABASE_NOT_CONFIGURED", message: "Market data is not configured." }
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

    const request = kind === "market" ? parseMarketRequest(req) : null;
    if (request && request.error) {
      sendJson(res, 400, { error: request.error });
      return;
    }

    try {
      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
      if (kind === "summary") {
        const summary = await service.getMarketSummary({ config, accessToken, serviceRoleKey });
        const { enabledMarketRows, ...publicSummary } = summary;
        const scanner = await service.getMarketScannerSummary({
          config,
          accessToken,
          serviceRoleKey,
          activeMarkets: enabledMarketRows,
          marketData: summary.items
        });
        sendJson(res, 200, { data: { ...publicSummary, scanner } });
        return;
      }

      const result = await service.getMarket({ config, accessToken, serviceRoleKey, ...request });
      if (!result.found) {
        sendJson(res, 404, {
          error: { code: "MARKET_NOT_TRACKED", message: "The requested market is not enabled." }
        });
        return;
      }
      sendJson(res, 200, { data: result.data });
    } catch (error) {
      if (error && error.code === "INVALID_SESSION") {
        clearCookie(res, env);
        sendJson(res, 401, {
          error: { code: "INVALID_SESSION", message: "Your session is invalid or expired." }
        });
        return;
      }
      if (error && error.code === "STORAGE_UNAVAILABLE") {
        logFailure(logger, "Market data storage request failed.", error);
        sendJson(res, 503, {
          error: { code: "MARKET_DATA_UNAVAILABLE", message: "Stored market data is temporarily unavailable." }
        });
        return;
      }
      logFailure(logger, "Market data request failed.", error);
      sendJson(res, 500, {
        error: { code: "MARKET_REQUEST_FAILED", message: "The market data request could not be completed." }
      });
    }
  };
}

function parseMarketRequest(req) {
  const url = new URL(req.url || "/", "https://cryptopulse.local");
  const symbol = url.searchParams.get("symbol");
  const interval = url.searchParams.get("interval") || "1m";
  const limitValue = url.searchParams.get("limit");
  const limit = limitValue === null ? 200 : Number(limitValue);

  if (!symbol || !/^[A-Z0-9]+-EUR$/.test(symbol)) {
    return {
      error: { code: "INVALID_MARKET", message: "A valid EUR market symbol is required." }
    };
  }
  if (!SUPPORTED_CANDLE_INTERVALS.includes(interval)) {
    return {
      error: { code: "INVALID_INTERVAL", message: "The requested candle interval is not supported." }
    };
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CANDLE_LIMIT) {
    return {
      error: { code: "INVALID_LIMIT", message: `Candle limit must be between 1 and ${MAX_CANDLE_LIMIT}.` }
    };
  }
  return { symbol, interval, limit };
}

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

function logFailure(logger, message, error) {
  const code = error instanceof Error ? error.code || error.name : "UnknownError";
  if (logger && typeof logger.error === "function") {
    logger.error(message, code);
  }
}
