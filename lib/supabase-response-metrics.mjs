const UTF8_ENCODER = new TextEncoder();

/**
 * Collects response-size diagnostics for server-side Supabase calls during one
 * function invocation. Query strings, headers, request bodies, and response
 * contents are never logged.
 */
export function createSupabaseResponseMetrics(supabaseUrl) {
  let supabaseOrigin = null;
  try {
    supabaseOrigin = new URL(supabaseUrl).origin;
  } catch {
    // Invalid configuration is handled by the existing request path.
  }

  const endpoints = new Map();

  function wrapFetch(fetchImpl) {
    return async function measuredFetch(input, init = {}) {
      const response = await fetchImpl(input, init);
      if (!supabaseOrigin) {
        return response;
      }

      const isRequest = typeof Request !== "undefined" && input instanceof Request;
      const requestUrl = isRequest ? input.url : String(input);
      let parsedUrl;
      try {
        parsedUrl = new URL(requestUrl);
      } catch {
        return response;
      }
      if (parsedUrl.origin !== supabaseOrigin) {
        return response;
      }

      const method = String(init.method || (isRequest ? input.method : "GET")).toUpperCase();
      const endpoint = `${method} ${parsedUrl.pathname}`;
      let metrics = endpoints.get(endpoint);
      if (!metrics) {
        metrics = {
          endpoint,
          requests: 0,
          responsesWithContentLength: 0,
          contentLengthBytes: 0,
          jsonResponsesMeasured: 0,
          jsonBodyBytesEstimate: 0
        };
        endpoints.set(endpoint, metrics);
      }
      metrics.requests += 1;

      const contentLength = readContentLength(response.headers);
      if (contentLength !== null) {
        metrics.responsesWithContentLength += 1;
        metrics.contentLengthBytes += contentLength;
      }

      return instrumentJsonResponse(response, metrics);
    };
  }

  function summary() {
    return {
      scope: "server-to-Supabase responses for this function invocation",
      byteNotes: "contentLengthBytes sums exposed HTTP Content-Length headers; jsonBodyBytesEstimate is UTF-8 size after JSON re-serialization and is not a wire-byte measurement.",
      endpoints: [...endpoints.values()].sort((left, right) => left.endpoint.localeCompare(right.endpoint))
    };
  }

  return { wrapFetch, summary };
}

/**
 * Vercel's log viewer can coerce nested arrays of objects to `[Object]` or omit
 * them. Keep the complete summary as a JSON string in a top-level log field.
 */
export function serializeSupabaseResponseTrafficForLog(summary) {
  if (!summary || typeof summary !== "object") {
    return "{}";
  }
  try {
    return JSON.stringify(summary);
  } catch {
    return "{}";
  }
}

function instrumentJsonResponse(response, metrics) {
  if (!response || typeof response !== "object") {
    return response;
  }

  return new Proxy(response, {
    get(target, property) {
      if (property === "json" && typeof target.json === "function") {
        return async (...args) => {
          const body = await target.json(...args);
          try {
            const serialized = JSON.stringify(body);
            if (typeof serialized === "string") {
              metrics.jsonResponsesMeasured += 1;
              metrics.jsonBodyBytesEstimate += UTF8_ENCODER.encode(serialized).byteLength;
            }
          } catch {
            // Metrics are diagnostic only and must never fail a database call.
          }
          return body;
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function readContentLength(headers) {
  if (!headers || typeof headers.get !== "function") {
    return null;
  }
  const raw = headers.get("content-length");
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
