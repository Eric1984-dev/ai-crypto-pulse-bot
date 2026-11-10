import { randomUUID } from "node:crypto";
import { ApiError } from "./api-error.mjs";

export function createRequestContext(request, response, {
  now = () => performance.now(),
  createRequestId = randomUUID
} = {}) {
  let url;
  try {
    url = new URL(request.url || "/", "http://localhost");
  } catch {
    throw new ApiError(400, "INVALID_REQUEST", "The request path is invalid.");
  }

  const requestId = createRequestId();
  response.setHeader("X-Request-Id", requestId);
  return {
    request,
    response,
    requestId,
    startedAt: now(),
    pathname: url.pathname,
    auth: null,
    session: null,
    routeHandler: null
  };
}
