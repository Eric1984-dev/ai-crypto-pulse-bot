import authSession from "../lib/auth-session.js";
import cronAuth from "../lib/cron-auth.js";
import { createMarketDataService } from "../lib/market-data.mjs";

const { getPublicConfig } = authSession;
const { isAuthorizedCron } = cronAuth;
const marketDataService = createMarketDataService();

export function createMarketRefreshHandler({
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

    const cronSecret = env.CRON_SECRET;
    const authorization = req.headers.authorization || "";
    if (!cronSecret) {
      sendJson(res, 503, {
        error: { code: "CRON_NOT_CONFIGURED", message: "Scheduled market refresh is not configured." }
      });
      return;
    }
    if (!isAuthorizedCron(authorization, cronSecret)) {
      sendJson(res, 401, {
        error: { code: "CRON_AUTH_REQUIRED", message: "Scheduled market refresh authorization is required." }
      });
      return;
    }

    const config = getPublicConfig(env);
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!config || !serviceRoleKey) {
      sendJson(res, 503, {
        error: { code: "MARKET_REFRESH_NOT_CONFIGURED", message: "Scheduled market refresh is not configured." }
      });
      return;
    }

    try {
      const data = await service.refreshScheduledMarkets({ config, serviceRoleKey });
      sendJson(res, 200, { data });
    } catch (error) {
      logFailure(logger, "Scheduled market refresh failed.", error);
      sendJson(res, 503, {
        error: { code: "MARKET_REFRESH_UNAVAILABLE", message: "Market refresh is temporarily unavailable." }
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

function logFailure(logger, message, error) {
  const code = error instanceof Error ? error.code || error.name : "UnknownError";
  if (logger && typeof logger.error === "function") {
    logger.error(message, code);
  }
}

export default createMarketRefreshHandler();
