import authSession from "../lib/auth-session.js";

const { getPublicConfig } = authSession;

export function createHandler({ env = process.env } = {}) {
  return function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
      return;
    }

    const config = getPublicConfig(env);
    if (!config) {
      sendJson(res, 503, { error: { code: "AUTH_NOT_CONFIGURED", message: "Supabase Authentication is not configured." } });
      return;
    }

    sendJson(res, 200, config);
  };
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default createHandler();
