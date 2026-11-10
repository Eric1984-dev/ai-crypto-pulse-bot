function setHeaders(response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  setHeaders(response);
  response.end(JSON.stringify(payload));
}

export function createHealthHandler({
  readiness,
  getDiagnostics,
  logger = console
}) {
  if (!readiness || typeof readiness.check !== "function"
    || typeof readiness.getSnapshot !== "function"
    || typeof getDiagnostics !== "function") {
    throw new TypeError("Health monitoring dependencies are required.");
  }

  return async function handleHealthRequest(request, response) {
    let pathname;
    try {
      pathname = new URL(request.url || "/", "http://localhost").pathname;
    } catch {
      sendJson(response, 400, {
        error: { code: "INVALID_REQUEST", message: "The request path is invalid." }
      });
      return;
    }

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." }
      });
      return;
    }

    if (pathname === "/api/v1/health/live") {
      sendJson(response, 200, { data: { status: "live" } });
      return;
    }

    if (pathname === "/api/v1/health/ready") {
      const ready = await readiness.check();
      if (!ready) {
        sendJson(response, 503, {
          error: { code: "RUNTIME_NOT_READY", message: "Runtime readiness checks failed." }
        });
        return;
      }
      const snapshot = readiness.getSnapshot();
      sendJson(response, 200, {
        data: {
          status: "ready",
          database: "available",
          contracts: snapshot.contracts,
          enabledMarkets: snapshot.enabledMarkets
        }
      });
      return;
    }

    if (pathname === "/api/v1/health/diagnostics") {
      try {
        sendJson(response, 200, { data: getDiagnostics() });
      } catch (error) {
        logger.error(JSON.stringify({
          event: "health_diagnostics_failed",
          code: safeErrorCode(error)
        }));
        sendJson(response, 503, {
          error: { code: "DIAGNOSTICS_UNAVAILABLE", message: "Runtime diagnostics are unavailable." }
        });
      }
      return;
    }

    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Endpoint not found." }
    });
  };
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}
