import authSession from "../lib/auth-session.js";
import cronAuth from "../lib/cron-auth.js";
import { createPaperTradingService } from "../lib/paper-trading.mjs";

const { getPublicConfig } = authSession;
const { isAuthorizedCron } = cronAuth;
const paperTradingService = createPaperTradingService();

export function createPaperTradingHandler({
  env = process.env,
  service = paperTradingService,
  logger = console
} = {}) {
  return async function handler(req, res) {
    setResponseHeaders(res);
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
      return;
    }

    const cronSecret = env.CRON_SECRET;
    const authorization = req.headers.authorization || "";
    if (!cronSecret) {
      sendJson(res, 503, {
        error: { code: "CRON_NOT_CONFIGURED", message: "Scheduled paper trading is not configured." }
      });
      return;
    }
    if (!isAuthorizedCron(authorization, cronSecret)) {
      sendJson(res, 401, {
        error: { code: "CRON_AUTH_REQUIRED", message: "Scheduled paper trading authorization is required." }
      });
      return;
    }

    if (env.ENABLE_LIVE_TRADING !== "false") {
      sendJson(res, 503, {
        error: {
          code: "PAPER_TRADING_ONLY",
          message: "Paper trading requires ENABLE_LIVE_TRADING=false."
        }
      });
      return;
    }

    const config = getPublicConfig(env);
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!config || !serviceRoleKey) {
      sendJson(res, 503, {
        error: { code: "PAPER_TRADING_NOT_CONFIGURED", message: "Paper trading is not configured." }
      });
      return;
    }

    const startedAt = performance.now();
    try {
      const data = await service.runPaperTrading({ config, serviceRoleKey });
      const metrics = { paperTradingDurationMs: elapsedMilliseconds(startedAt) };
      if (data.status === "COMPLETED") {
        Object.assign(metrics, {
          portfoliosProcessed: data.portfoliosProcessed,
          decisionsProcessed: data.decisionsProcessed,
          tradesExecuted: data.tradesExecuted,
          duplicates: data.duplicates,
          skipped: data.skipped
        });
      } else {
        metrics.reason = data.reason;
      }
      logSuccess(logger, metrics);
      sendJson(res, 200, { data, metrics });
    } catch (error) {
      const code = error instanceof Error ? error.code || error.name : "UnknownError";
      if (logger && typeof logger.error === "function") {
        logger.error("Scheduled paper trading failed.", code, {
          paperTradingDurationMs: elapsedMilliseconds(startedAt)
        });
      }
      sendJson(res, 503, {
        error: { code: "PAPER_TRADING_UNAVAILABLE", message: "Paper trading is temporarily unavailable." }
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
  if (logger && typeof logger.info === "function") {
    logger.info("Scheduled paper trading completed.", metrics);
  }
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export default createPaperTradingHandler();
