import { createServer } from "node:http";
import { createHealthHandler } from "../monitoring/health-handler.mjs";

export function createHealthApiServer({
  readiness,
  getDiagnostics,
  logger = console,
  createServerImpl = createServer
}) {
  const handler = createHealthHandler({ readiness, getDiagnostics, logger });
  return createServerImpl((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      logger.error(JSON.stringify({
        event: "health_request_failed",
        code: safeErrorCode(error)
      }));
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "The request could not be completed." }
        }));
      } else {
        response.destroy();
      }
    });
  });
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}
