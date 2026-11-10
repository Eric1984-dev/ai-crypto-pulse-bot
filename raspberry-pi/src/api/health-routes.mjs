import { requireRole } from "../auth/authorization.mjs";
import { ApiError } from "./api-error.mjs";
import { validateQuery } from "./request-validation.mjs";

export const HEALTH_PATHS = Object.freeze({
  live: "/api/v1/health/live",
  ready: "/api/v1/health/ready",
  operational: "/api/v1/health/operational"
});

export function registerHealthRoutes(router, {
  readiness,
  getOperationalHealth
}) {
  if (!readiness || typeof readiness.check !== "function"
    || typeof getOperationalHealth !== "function") {
    throw new TypeError("Health route dependencies are required.");
  }

  router.register("GET", HEALTH_PATHS.live, async (context) => {
    validateQuery(context.request);
    sendJson(context, 200, { data: { status: "live" } });
  });

  router.register("GET", HEALTH_PATHS.ready, async (context) => {
    validateQuery(context.request);
    if (!await readiness.check()) {
      throw new ApiError(503, "SERVICE_NOT_READY", "The service is not ready.");
    }
    sendJson(context, 200, { data: { status: "ready" } });
  });

  router.register("GET", HEALTH_PATHS.operational, async (context) => {
    validateQuery(context.request);
    requireRole(context, "admin");
    sendJson(context, 200, { data: getOperationalHealth() });
  });
  return router;
}

function sendJson(context, statusCode, payload) {
  context.response.statusCode = statusCode;
  context.response.setHeader("Content-Type", "application/json; charset=utf-8");
  context.response.end(JSON.stringify(payload));
}
