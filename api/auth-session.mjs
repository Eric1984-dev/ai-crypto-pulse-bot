import authSession from "../lib/auth-session.js";

const {
  clearSessionCookie,
  createSessionCookie,
  getPublicConfig,
  verifyAccessToken
} = authSession;

export function createHandler({ env = process.env, verify = verifyAccessToken } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "DELETE") {
      res.setHeader("Set-Cookie", clearSessionCookie({ secure: env.NODE_ENV === "production" }));
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, DELETE");
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
      return;
    }

    const config = getPublicConfig(env);
    if (!config) {
      sendJson(res, 503, { error: { code: "AUTH_NOT_CONFIGURED", message: "Supabase Authentication is not configured." } });
      return;
    }

    const body = typeof req.body === "string" ? parseJson(req.body) : req.body;
    const accessToken = body && typeof body.accessToken === "string" ? body.accessToken : "";
    const expiresIn = body && Number.isFinite(body.expiresIn) ? Math.min(Math.max(Math.floor(body.expiresIn), 60), 86400) : 3600;

    if (accessToken.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) {
      sendJson(res, 400, { error: { code: "INVALID_SESSION", message: "A valid Supabase session is required." } });
      return;
    }

    try {
      if (!await verify(accessToken, config)) {
        sendJson(res, 401, { error: { code: "INVALID_SESSION", message: "The Supabase session is invalid or expired." } });
        return;
      }
    } catch {
      sendJson(res, 503, { error: { code: "AUTH_SERVICE_UNAVAILABLE", message: "Supabase Authentication is temporarily unavailable." } });
      return;
    }

    const secure = env.NODE_ENV === "production";
    res.setHeader("Set-Cookie", createSessionCookie(accessToken, { maxAge: expiresIn, secure }));
    res.statusCode = 204;
    res.end();
  };
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default createHandler();
