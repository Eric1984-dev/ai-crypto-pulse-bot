import {
  clearSessionCookie,
  proxyRuntimeApiRequest,
  readSessionToken
} from "../lib/runtime-api-proxy.mjs";

export function createHandler({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "POST", "DELETE"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST, DELETE");
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
      return;
    }

    if (req.method === "DELETE" && !readSessionToken(req.headers?.cookie || "")) {
      clearSessionCookie(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    const body = req.method === "POST" ? serializeLoginBody(req.body) : undefined;
    if (req.method === "POST" && body === null) {
      sendJson(res, 400, { error: { code: "INVALID_LOGIN", message: "Enter a valid username and password." } });
      return;
    }
    await proxyRuntimeApiRequest(req, res, {
      env,
      fetchImpl,
      path: req.method === "POST" ? "/api/v1/auth/login" : "/api/v1/auth/session",
      method: req.method,
      requireSession: req.method !== "POST",
      ...(body === undefined ? {} : { body })
    });
  };
}

function serializeLoginBody(body) {
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return JSON.stringify(value);
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default createHandler();
