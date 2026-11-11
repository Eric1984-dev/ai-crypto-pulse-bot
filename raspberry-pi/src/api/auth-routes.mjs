import bcrypt from "bcryptjs";
import { requireAuthenticated } from "../auth/authentication-middleware.mjs";
import { readSessionCookie } from "../auth/authentication-provider.mjs";
import { SessionCapacityError } from "../auth/session-store.mjs";
import { ApiError } from "./api-error.mjs";
import { validateQuery } from "./request-validation.mjs";

const SESSION_PATH = "/api/v1/auth/session";
const LOGIN_PATH = "/api/v1/auth/login";
const SESSION_COOKIE = "__Host-cp_session";
const MAX_LOGIN_BODY_BYTES = 4096;

export function registerAuthRoutes(router, {
  dashboardAuth,
  sessionStore,
  sessionTtlMs
}) {
  if (!dashboardAuth || typeof dashboardAuth.username !== "string"
    || typeof dashboardAuth.passwordHash !== "string"
    || !sessionStore || typeof sessionStore.create !== "function"
    || typeof sessionStore.delete !== "function"
    || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 60_000) {
    throw new TypeError("Dashboard authentication credentials and session storage are required.");
  }

  router.register("POST", LOGIN_PATH, async (context) => {
    validateQuery(context.request);
    const body = await readLoginBody(context.request);
    if (typeof body.username !== "string" || body.username.length > 128
      || typeof body.password !== "string" || body.password.length < 1
      || Buffer.byteLength(body.password, "utf8") > 72) {
      throw new ApiError(400, "INVALID_LOGIN", "Enter a valid username and password.");
    }

    const passwordMatches = await bcrypt.compare(body.password, dashboardAuth.passwordHash);
    if (body.username !== dashboardAuth.username || !passwordMatches) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Username or password is incorrect.");
    }

    let created;
    try {
      created = sessionStore.create({ subject: "dashboard-admin", roles: ["admin"] });
    } catch (error) {
      if (error instanceof SessionCapacityError) {
        throw new ApiError(503, "SESSION_CAPACITY_EXCEEDED", "Dashboard login is temporarily unavailable.");
      }
      throw error;
    }

    context.response.setHeader("Set-Cookie", createSessionCookie(created.token, sessionTtlMs));
    sendJson(context, 200, {
      data: {
        csrfToken: created.session.csrfToken,
        expiresAt: created.session.expiresAt
      }
    });
  });

  router.register("GET", SESSION_PATH, async (context) => {
    validateQuery(context.request);
    requireAuthenticated(context);
    if (!context.auth.session) {
      throw new ApiError(401, "UNAUTHENTICATED", "Dashboard authentication is required.");
    }
    sendJson(context, 200, {
      data: {
        csrfToken: context.auth.session.csrfToken,
        expiresAt: context.auth.session.expiresAt
      }
    });
  });

  router.register("DELETE", SESSION_PATH, async (context) => {
    validateQuery(context.request);
    requireAuthenticated(context);
    const token = readSessionCookie(context.request.headers.cookie);
    if (!token || !sessionStore.delete(token)) {
      throw new ApiError(401, "UNAUTHENTICATED", "Dashboard authentication is required.");
    }
    context.response.setHeader("Set-Cookie", clearSessionCookie());
    context.response.statusCode = 204;
    context.response.end();
  });

  return router;
}

async function readLoginBody(request) {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
    throw new ApiError(413, "LOGIN_REQUEST_TOO_LARGE", "The login request is too large.");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_LOGIN_BODY_BYTES) {
      throw new ApiError(413, "LOGIN_REQUEST_TOO_LARGE", "The login request is too large.");
    }
    chunks.push(buffer);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_LOGIN", "Enter a valid username and password.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "username" && key !== "password")) {
    throw new ApiError(400, "INVALID_LOGIN", "Enter a valid username and password.");
  }
  return body;
}

function createSessionCookie(token, ttlMs) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(ttlMs / 1000)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function sendJson(context, statusCode, payload) {
  context.response.statusCode = statusCode;
  context.response.setHeader("Content-Type", "application/json; charset=utf-8");
  context.response.setHeader("Cache-Control", "no-store");
  context.response.end(JSON.stringify(payload));
}
