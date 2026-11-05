import authSession from "../lib/auth-session.js";
import cronAuth from "../lib/cron-auth.js";
import { createMarketDataService, SUPPORTED_CANDLE_INTERVALS } from "../lib/market-data.mjs";
import { serializeSupabaseResponseTrafficForLog } from "../lib/supabase-response-metrics.mjs";

const { getPublicConfig } = authSession;
const { isAuthorizedCron } = cronAuth;
const marketDataService = createMarketDataService();

export function createCandleRefreshHandler({
  env = process.env,
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

    const url = new URL(req.url || "/", "https://cryptopulse.local");
    const interval = url.searchParams.get("interval");
    const batchValue = url.searchParams.get("batch");
    const batch = batchValue !== null && /^(0|[1-9]\d*)$/.test(batchValue)
      ? Number(batchValue)
      : null;
    if (!SUPPORTED_CANDLE_INTERVALS.includes(interval) || !Number.isSafeInteger(batch)) {
      sendJson(res, 400, {
        error: {
          code: "INVALID_CANDLE_REFRESH_REQUEST",
          message: "A supported interval and non-negative batch number are required."
        }
      });
      return;
    }

    const cronSecret = env.CRON_SECRET;
    const authorization = req.headers.authorization || "";
    if (!cronSecret) {
      sendJson(res, 503, {
        error: { code: "CRON_NOT_CONFIGURED", message: "Scheduled candle refresh is not configured." }
      });
      return;
    }
    if (!isAuthorizedCron(authorization, cronSecret)) {
      sendJson(res, 401, {
        error: { code: "CRON_AUTH_REQUIRED", message: "Scheduled candle refresh authorization is required." }
      });
      return;
    }

    const config = getPublicConfig(env);
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!config || !serviceRoleKey) {
      sendJson(res, 503, {
        error: {
          code: "CANDLE_REFRESH_NOT_CONFIGURED",
          message: "Scheduled candle refresh is not configured."
        }
      });
      return;
    }

    const refreshStartedAt = performance.now();
    try {
      const data = await service.refreshScheduledCandleBatch({
        config,
        serviceRoleKey,
        interval,
        batch
      });
      logSuccess(logger, data.metrics);
      sendJson(res, 200, { data });
    } catch (error) {
      if (error instanceof Error && error.code === "INVALID_CANDLE_REFRESH_REQUEST") {
        sendJson(res, 400, {
          error: { code: error.code, message: error.message }
        });
        return;
      }
      logFailure(logger, error, elapsedMilliseconds(refreshStartedAt));
      sendJson(res, 503, {
        error: { code: "CANDLE_REFRESH_UNAVAILABLE", message: "Candle refresh is temporarily unavailable." }
      });
    }
  };
}

function setResponseHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function logSuccess(logger, metrics) {
  if (logger && typeof logger.info === "function" && metrics) {
    const { supabaseResponseTraffic, ...otherMetrics } = metrics;
    logger.info("Scheduled candle refresh completed.", {
      ...otherMetrics,
      supabaseResponseTrafficJson: serializeSupabaseResponseTrafficForLog(supabaseResponseTraffic)
    });
  }
}

function logFailure(logger, error, candleRefreshDurationMs) {
  const code = error instanceof Error ? error.code || error.name : "UnknownError";
  if (logger && typeof logger.error === "function") {
    logger.error("Scheduled candle refresh failed.", code, { candleRefreshDurationMs });
  }
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export default createCandleRefreshHandler();
