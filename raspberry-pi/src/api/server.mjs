import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { CloudflareAccessAuthenticationProvider } from "../auth/cloudflare-access-provider.mjs";
import {
  DisabledAuthenticationProvider,
  SessionAuthenticationProvider
} from "../auth/authentication-provider.mjs";
import { authenticationMiddleware } from "../auth/authentication-middleware.mjs";
import { csrfMiddleware } from "./csrf-middleware.mjs";
import { ApiError, toErrorResponse } from "./api-error.mjs";
import { createRequestContext } from "./request-context.mjs";
import { composeMiddleware } from "./middleware-pipeline.mjs";
import { FixedWindowRateLimiter, rateLimitMiddleware } from "./rate-limiter.mjs";
import { registerHealthRoutes } from "./health-routes.mjs";
import { registerAuthRoutes } from "./auth-routes.mjs";
import { registerDataRoutes } from "./data-routes.mjs";
import { ApiRouter, routerMiddleware } from "./router.mjs";
import { corsMiddleware, securityHeadersMiddleware } from "./security-middleware.mjs";
import { requestLoggingMiddleware } from "./request-logging-middleware.mjs";

export function createApiServer({
  readiness,
  getOperationalHealth,
  authenticationProvider,
  sessionStore,
  dashboardAuth,
  cloudflareAccess,
  dataRepositories,
  now,
  getSystemMetrics,
  allowedOrigins = [],
  rateLimitMaxRequests = 60,
  rateLimitWindowMs = 60000,
  logger = console,
  metrics,
  createServerImpl = createServer
}) {
  const cloudflareAccessEnabled = cloudflareAccess?.enabled === true;
  const anonymousReadOnly = !authenticationProvider && !sessionStore && !cloudflareAccessEnabled;
  const sessionAuthenticationProvider = sessionStore
    ? new SessionAuthenticationProvider(sessionStore)
    : null;
  const cloudflareAccessProvider = cloudflareAccessEnabled
    ? new CloudflareAccessAuthenticationProvider(cloudflareAccess)
    : null;
  const resolvedAuthenticationProvider = authenticationProvider || (
    sessionAuthenticationProvider
      ? {
        async authenticate(request) {
          const identity = await sessionAuthenticationProvider.authenticate(request);
          if (!identity || !cloudflareAccessProvider) {
            return identity;
          }
          return await cloudflareAccessProvider.authenticate(request) ? identity : null;
        }
      }
      : cloudflareAccessProvider || new DisabledAuthenticationProvider()
  );
  if (!resolvedAuthenticationProvider
    || typeof resolvedAuthenticationProvider.authenticate !== "function") {
    throw new TypeError("An authentication provider interface is required.");
  }

  const router = registerHealthRoutes(new ApiRouter(), {
    readiness,
    getOperationalHealth
  });
  if (sessionStore || dashboardAuth) {
    if (!sessionStore || !dashboardAuth) {
      throw new TypeError("Dashboard authentication requires both credentials and a session store.");
    }
    registerAuthRoutes(router, {
      dashboardAuth,
      sessionStore,
      sessionTtlMs: sessionStore.ttlMs
    });
  }
  if (dataRepositories) {
    registerDataRoutes(router, dataRepositories, { now, getOperationalHealth, getSystemMetrics });
  }
  const rateLimiter = new FixedWindowRateLimiter({
    limit: rateLimitMaxRequests,
    windowMs: rateLimitWindowMs
  });
  const runPipeline = composeMiddleware([
    securityHeadersMiddleware(),
    requestLoggingMiddleware({ logger, metrics }),
    rateLimitMiddleware(rateLimiter),
    corsMiddleware({ allowedOrigins }),
    routerMiddleware(router),
    authenticationMiddleware(resolvedAuthenticationProvider),
    csrfMiddleware({ allowedOrigins })
  ], async (context) => {
    await context.routeHandler(context);
  });

  return createServerImpl((request, response) => {
    let context;
    try {
      context = createRequestContext(request, response);
      context.dashboardAccessMode = anonymousReadOnly
        ? "anonymous-read-only"
        : "authenticated";
    } catch (error) {
      writeErrorResponse(response, error, randomUUID());
      return;
    }

    runPipeline(context).catch((error) => {
      if (!(error instanceof ApiError) || error.statusCode >= 500) {
        logger.error(JSON.stringify({
          event: "api_request_failed",
          requestId: context.requestId,
          code: safeErrorCode(error)
        }));
      }
      if (response.headersSent) {
        response.destroy();
        return;
      }
      writeErrorResponse(response, error, context.requestId);
    });
  });
}

function writeErrorResponse(response, error, requestId) {
  const result = toErrorResponse(error, requestId);
  response.statusCode = result.statusCode;
  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, value);
  }
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.end(JSON.stringify(result.body));
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

export { ApiError };
