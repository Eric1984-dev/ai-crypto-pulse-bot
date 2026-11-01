import authSession from "../lib/auth-session.js";
import cronAuth from "../lib/cron-auth.js";
import { createAIEngineService } from "../lib/ai-engine.mjs";

const { getPublicConfig } = authSession;
const { isAuthorizedCron } = cronAuth;
const aiEngineService = createAIEngineService();

export function createAIAnalysisHandler({
  env = process.env,
  service = aiEngineService,
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
    if (!cronSecret) {
      sendJson(res, 503, {
        error: { code: "CRON_NOT_CONFIGURED", message: "AI analysis is not configured." }
      });
      return;
    }
    if (!isAuthorizedCron(req.headers.authorization || "", cronSecret)) {
      sendJson(res, 401, {
        error: { code: "CRON_AUTH_REQUIRED", message: "Scheduled AI analysis authorization is required." }
      });
      return;
    }

    const config = getPublicConfig(env);
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!config || !serviceRoleKey) {
      sendJson(res, 503, {
        error: { code: "AI_ENGINE_NOT_CONFIGURED", message: "AI analysis is not configured." }
      });
      return;
    }

    try {
      const data = await service.runAnalysis({ config, serviceRoleKey });
      sendJson(res, 200, { data });
    } catch (error) {
      logFailure(logger, "AI analysis request failed.", error);
      sendJson(res, 503, {
        error: { code: "AI_ANALYSIS_UNAVAILABLE", message: "AI analysis is temporarily unavailable." }
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

export default createAIAnalysisHandler();
