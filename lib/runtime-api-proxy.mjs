const SESSION_COOKIE_NAME = "__Host-cp_session";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "cache-control",
  "x-request-id",
  "allow",
  "retry-after"
];

export async function proxyRuntimeApiRequest(req, res, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  path,
  method = req.method,
  requireSession = true,
  body
} = {}) {
  setSecurityHeaders(res);
  const token = readSessionToken(req.headers?.cookie || "");
  if (!token && requireSession) {
    clearSessionCookie(res);
    sendError(res, 401, "AUTH_REQUIRED", "A valid dashboard session is required.");
    return;
  }

  let url;
  try {
    url = createRuntimeApiUrl(env, path);
  } catch {
    sendError(res, 503, "RUNTIME_API_NOT_CONFIGURED", "The dashboard runtime API is not configured.");
    return;
  }

  const headers = new Headers({
    accept: req.headers?.accept || "application/json"
  });
  if (token) {
    headers.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  }
  const origin = req.headers?.origin;
  const csrfToken = req.headers?.["x-csrf-token"];
  const accessToken = req.headers?.["cf-access-jwt-assertion"];
  if (typeof origin === "string" && origin.length <= 512) {
    headers.set("origin", origin);
  }
  if (typeof csrfToken === "string" && csrfToken.length <= 256) {
    headers.set("x-csrf-token", csrfToken);
  }
  if (typeof accessToken === "string" && accessToken.length <= 8192) {
    headers.set("cf-access-jwt-assertion", accessToken);
  }
  if (body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  let upstream;
  try {
    upstream = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body })
    });
    res.statusCode = upstream.status;
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) {
        res.setHeader(name, value);
      }
    }
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) {
      res.setHeader("Set-Cookie", cookie);
    }
    if (upstream.status === 401) {
      clearSessionCookie(res);
    }
    const responseBody = await upstream.arrayBuffer();
    res.end(Buffer.from(responseBody));
  } catch {
    sendError(res, 502, "RUNTIME_API_UNAVAILABLE", "The dashboard runtime API is temporarily unavailable.");
  }
}

export function createRuntimeApiUrl(env, path) {
  const rawOrigin = env.CRYPTOPULSE_RUNTIME_API_ORIGIN;
  if (typeof rawOrigin !== "string" || !rawOrigin.trim()) {
    throw new TypeError("The runtime API origin is not configured.");
  }
  let origin;
  try {
    const parsed = new URL(rawOrigin.trim());
    if (parsed.username || parsed.password || parsed.pathname !== "/"
      || parsed.search || parsed.hash
      || (parsed.protocol !== "https:" && !(env.NODE_ENV !== "production"
        && parsed.protocol === "http:" && isLoopback(parsed.hostname)))) {
      throw new Error();
    }
    origin = parsed.origin;
  } catch {
    throw new TypeError("The runtime API origin is invalid.");
  }

  if (typeof path !== "string" || path.length > 4096 || !path.startsWith("/api/v1/")) {
    throw new TypeError("A versioned runtime API path is required.");
  }
  let target;
  try {
    target = new URL(path, origin);
  } catch {
    throw new TypeError("The runtime API path is invalid.");
  }
  if (target.origin !== origin || !target.pathname.startsWith("/api/v1/")
    || target.username || target.password || target.hash) {
    throw new TypeError("The runtime API path is invalid.");
  }
  return target;
}

export function readSessionToken(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 8192) {
    return null;
  }
  let token = null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== SESSION_COOKIE_NAME) {
      continue;
    }
    if (token !== null) {
      return null;
    }
    token = item.slice(separator + 1).trim();
  }
  return token && SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

export function createSessionCookieHeader(cookieHeader) {
  const token = readSessionToken(cookieHeader);
  return token ? `${SESSION_COOKIE_NAME}=${token}` : null;
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function sendError(res, statusCode, code, message) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: { code, message } }));
}
