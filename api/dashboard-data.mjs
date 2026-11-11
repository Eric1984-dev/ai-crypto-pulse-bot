import { proxyRuntimeApiRequest } from "../lib/runtime-api-proxy.mjs";

export function createHandler({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." }
      });
      return;
    }

    const path = readRuntimeProxyPath(req);
    if (path === null) {
      sendJson(res, 400, {
        error: {
          code: "INVALID_RUNTIME_API_PATH",
          message: "The runtime API path is invalid."
        }
      });
      return;
    }

    await proxyRuntimeApiRequest(req, res, { env, fetchImpl, path });
  };
}

function readRuntimeProxyPath(req) {
  if (req.query && Object.hasOwn(req.query, "path")) {
    return typeof req.query.path === "string" ? req.query.path : null;
  }
  try {
    const paths = new URL(req.url || "/", "http://localhost").searchParams.getAll("path");
    return paths.length === 1 ? paths[0] : null;
  } catch {
    return null;
  }
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default createHandler();
