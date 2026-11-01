import authSession from "../lib/auth-session.js";
import adminAuth from "../lib/admin-auth.js";
import { createAIEngineService } from "../lib/ai-engine.mjs";
import { createPaperTradingService } from "../lib/paper-trading.mjs";

const { getPublicConfig } = authSession;
const { authorizeAdminRequest } = adminAuth;
const aiEngineService = createAIEngineService();
const paperTradingService = createPaperTradingService();

export function createAdminActionsHandler({
  env = process.env,
  authorize = authorizeAdminRequest,
  fetchImpl = globalThis.fetch,
  aiService = aiEngineService,
  paperService = paperTradingService,
  logger = console
} = {}) {
  return async function handler(req, res) {
    setResponseHeaders(res);
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
      return;
    }

    const authorization = await authorize({
      cookieHeader: req.headers.cookie || "",
      env,
      fetchImpl
    });
    if (!authorization.authorized) {
      if (authorization.status >= 500 && logger && typeof logger.error === "function") {
        logger.error("Admin authorization failed.", authorization.code);
      }
      sendJson(res, authorization.status, {
        error: { code: authorization.code, message: authorization.message }
      });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, { data: { isAdmin: true } });
      return;
    }

    const body = parseRequestBody(req.body);
    const action = body && body.action;
    if (action !== "ai-analysis" && action !== "paper-trading") {
      sendJson(res, 400, {
        error: { code: "INVALID_ADMIN_ACTION", message: "Choose a supported admin action." }
      });
      return;
    }

    if (action === "paper-trading" && env.ENABLE_LIVE_TRADING !== "false") {
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
        error: { code: "ADMIN_ACTION_NOT_CONFIGURED", message: "Admin actions are not configured." }
      });
      return;
    }

    const startedAt = performance.now();
    try {
      const data = action === "ai-analysis"
        ? await aiService.runAnalysis({ config, serviceRoleKey })
        : await paperService.runPaperTrading({ config, serviceRoleKey });
      const metrics = { executionDurationMs: elapsedMilliseconds(startedAt) };
      if (logger && typeof logger.info === "function") {
        logger.info("Dashboard admin action completed.", { action, ...metrics });
      }
      sendJson(res, 200, { data, metrics });
    } catch (error) {
      const code = error instanceof Error ? error.code || error.name : "UnknownError";
      const metrics = { executionDurationMs: elapsedMilliseconds(startedAt) };
      if (logger && typeof logger.error === "function") {
        logger.error("Dashboard admin action failed.", { action, code, ...metrics });
      }
      const failureCode = action === "ai-analysis"
        ? "AI_ANALYSIS_UNAVAILABLE"
        : "PAPER_TRADING_UNAVAILABLE";
      const message = action === "ai-analysis"
        ? "AI analysis is temporarily unavailable."
        : "Paper trading is temporarily unavailable.";
      sendJson(res, 503, { error: { code: failureCode, message }, metrics });
    }
  };
}

function parseRequestBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
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

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export default createAdminActionsHandler();
