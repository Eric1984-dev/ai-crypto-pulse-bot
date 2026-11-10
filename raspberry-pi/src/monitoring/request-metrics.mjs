export function createRequestMetrics() {
  let totalRequests = 0;
  let clientFailures = 0;
  let serverFailures = 0;

  return Object.freeze({
    record(statusCode) {
      totalRequests += 1;
      if (statusCode >= 400 && statusCode < 500) {
        clientFailures += 1;
      } else if (statusCode >= 500) {
        serverFailures += 1;
      }
    },
    getSnapshot() {
      return Object.freeze({
        totalRequests,
        clientFailures,
        serverFailures
      });
    }
  });
}
