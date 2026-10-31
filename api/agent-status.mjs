import authSession from "../lib/auth-session.js";

const {
  clearSessionCookie,
  getPublicConfig,
  readAccessToken,
  verifyAccessToken
} = authSession;

const validStatuses = new Set(["ACTIVE", "ANALYZING", "IDLE", "STOPPED", "ERROR"]);

export function createHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  verify = (token, config) => verifyAccessToken(token, config, fetchImpl)
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
        error: { code: "SUPABASE_NOT_CONFIGURED", message: "Agent status is not configured." }
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

    const url = new URL("/rest/v1/AI_Crypto_Bot_Status", config.supabaseUrl);
    url.searchParams.set("select", "status");
    url.searchParams.set("limit", "1");
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        headers: {
          apikey: config.supabaseAnonKey,
          authorization: `Bearer ${accessToken}`,
          accept: "application/json"
        },
        cache: "no-store"
      });
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      sendJson(res, 503, {
        error: { code: "AGENT_STATUS_UNAVAILABLE", message: "Agent status is temporarily unavailable." }
      });
      return;
    }

    if (response.status === 401) {
      clearCookie(res, env);
      sendJson(res, 401, {
        error: { code: "INVALID_SESSION", message: "Your session is invalid or expired." }
      });
      return;
    }
    if (!response.ok) {
      sendJson(res, 503, {
        error: { code: "AGENT_STATUS_UNAVAILABLE", message: "Agent status is temporarily unavailable." }
      });
      return;
    }

    let rows;
    try {
      rows = await response.json();
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) {
        throw error;
      }
      sendJson(res, 503, {
        error: { code: "AGENT_STATUS_UNAVAILABLE", message: "Agent status is temporarily unavailable." }
      });
      return;
    }
    if (!Array.isArray(rows)) {
      sendJson(res, 503, {
        error: { code: "AGENT_STATUS_UNAVAILABLE", message: "Agent status is temporarily unavailable." }
      });
      return;
    }

    const status = rows[0] && typeof rows[0].status === "string"
      ? rows[0].status.toUpperCase()
      : null;
    sendJson(res, 200, { data: { status: validStatuses.has(status) ? status : null } });
  };
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

export default createHandler();
