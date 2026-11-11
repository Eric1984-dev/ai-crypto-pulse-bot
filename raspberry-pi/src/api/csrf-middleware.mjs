import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./api-error.mjs";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfMiddleware({ allowedOrigins = [] } = {}) {
  const allowlist = new Set(allowedOrigins);
  return async (context, next) => {
    const method = context.request.method.toUpperCase();
    if (SAFE_METHODS.has(method)) {
      await next();
      return;
    }

    const origin = context.request.headers.origin;
    if (method === "POST" && context.pathname === "/api/v1/auth/login") {
      if (!origin || !allowlist.has(origin)
        || !/^application\/json(?:\s*;|$)/i.test(context.request.headers["content-type"] || "")) {
        throw new ApiError(403, "CSRF_VALIDATION_FAILED", "Request validation failed.");
      }
      await next();
      return;
    }

    const expected = context.auth?.session?.csrfToken;
    const supplied = context.request.headers["x-csrf-token"];
    if (!origin || !allowlist.has(origin)
      || typeof expected !== "string"
      || typeof supplied !== "string"
      || !constantTimeEqual(expected, supplied)) {
      throw new ApiError(403, "CSRF_VALIDATION_FAILED", "Request validation failed.");
    }
    await next();
  };
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}
