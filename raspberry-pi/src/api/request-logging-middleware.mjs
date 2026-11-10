export function requestLoggingMiddleware({
  logger = console,
  metrics,
  now = () => performance.now()
} = {}) {
  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      context.error = error;
      throw error;
    } finally {
      const statusCode = context.response.headersSent
        ? context.response.statusCode
        : context.error?.statusCode || 500;
      metrics?.record(statusCode);
      logger.info(JSON.stringify({
        event: "api_request_completed",
        requestId: context.requestId,
        method: context.request.method,
        path: context.pathname,
        statusCode,
        durationMs: Math.max(0, Math.round(now() - context.startedAt))
      }));
    }
  };
}
