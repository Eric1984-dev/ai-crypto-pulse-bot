import { ApiError } from "./api-error.mjs";

export function securityHeadersMiddleware() {
  return async (context, next) => {
    const { response } = context;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    await next();
  };
}

export function corsMiddleware({ allowedOrigins = [] } = {}) {
  const allowlist = new Set(allowedOrigins);
  return async (context, next) => {
    const { request, response } = context;
    const origin = request.headers.origin;

    if (origin && !allowlist.has(origin)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
    }

    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Vary", "Origin");
    }

    if (request.method.toUpperCase() !== "OPTIONS") {
      await next();
      return;
    }

    if (origin) {
      const requestedMethod = request.headers["access-control-request-method"]?.toUpperCase();
      if (requestedMethod && requestedMethod !== "GET") {
        throw new ApiError(403, "CORS_METHOD_NOT_ALLOWED", "Request method is not allowed.");
      }

      const requestedHeaders = (request.headers["access-control-request-headers"] || "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      const allowedHeaders = new Set(["content-type", "x-csrf-token"]);
      if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
        throw new ApiError(403, "CORS_HEADERS_NOT_ALLOWED", "Request headers are not allowed.");
      }

      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      response.setHeader("Access-Control-Max-Age", "600");
      response.setHeader(
        "Vary",
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
      );
    }
    response.statusCode = 204;
    response.end();
  };
}
