const BITVAVO_API_BASE = "https://api.bitvavo.com/v2";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MARKET_SYMBOL_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const CANDLE_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
const MAX_CANDLES_PER_REQUEST = 500;

export class BitvavoProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BitvavoProviderError";
    this.code = code;
  }
}

export function createBitvavoPublicClient({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new RangeError("The Bitvavo request timeout is outside its supported range.");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024
    || maxResponseBytes > 8 * 1024 * 1024) {
    throw new RangeError("The Bitvavo response limit is outside its supported range.");
  }

  return Object.freeze({
    async fetchTickers() {
      const response = await requestJson("/ticker/24h");
      if (!Array.isArray(response) || response.length === 0 || response.length > 2000) {
        const code = Array.isArray(response) && response.length === 0
          ? "PROVIDER_EMPTY"
          : "INVALID_PROVIDER_RESPONSE";
        throw new BitvavoProviderError(
          code,
          "Bitvavo returned an invalid ticker response."
        );
      }
      return response;
    },

    async fetchCandles(symbol, interval, { limit, start = null } = {}) {
      if (typeof symbol !== "string" || !MARKET_SYMBOL_PATTERN.test(symbol)) {
        throw new TypeError("A valid watched-market symbol is required.");
      }
      if (!CANDLE_INTERVALS.includes(interval)) {
        throw new TypeError("A supported candle interval is required.");
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CANDLES_PER_REQUEST) {
        throw new RangeError("The candle request limit is outside its supported range.");
      }
      if (start !== null && (!Number.isSafeInteger(start) || start < 0)) {
        throw new TypeError("The candle checkpoint must be a non-negative timestamp.");
      }

      const query = new URLSearchParams({ interval, limit: String(limit) });
      if (start !== null) {
        query.set("start", String(start));
      }
      const response = await requestJson(`/${encodeURIComponent(symbol)}/candles?${query}`);
      if (!Array.isArray(response) || response.length > limit) {
        throw new BitvavoProviderError(
          "INVALID_PROVIDER_RESPONSE",
          "Bitvavo returned an invalid candle response."
        );
      }
      return response;
    }
  });

  async function requestJson(path) {
    let response;
    try {
      response = await fetchImpl(`${BITVAVO_API_BASE}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const code = error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "PROVIDER_TIMEOUT"
        : "PROVIDER_UNAVAILABLE";
      throw new BitvavoProviderError(code, "Bitvavo public market data could not be loaded.");
    }

    if (response.status === 429) {
      throw new BitvavoProviderError("RATE_LIMITED", "Bitvavo rate limit was reached.");
    }
    if (response.status === 404) {
      throw new BitvavoProviderError("MARKET_NOT_FOUND", "Bitvavo does not recognize this market.");
    }
    if (!response.ok) {
      throw new BitvavoProviderError(
        response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
        "Bitvavo public market data could not be loaded."
      );
    }

    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      throw new BitvavoProviderError(
        "PROVIDER_RESPONSE_TOO_LARGE",
        "Bitvavo response exceeded the configured size limit."
      );
    }

    try {
      return await readBoundedJson(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof BitvavoProviderError) {
        throw error;
      }
      if (error instanceof SyntaxError || error instanceof TypeError) {
        throw new BitvavoProviderError(
          "INVALID_PROVIDER_RESPONSE",
          "Bitvavo returned invalid JSON."
        );
      }
      throw new BitvavoProviderError(
        "PROVIDER_UNAVAILABLE",
        "Bitvavo public market data could not be read."
      );
    }
  }
}

async function readBoundedJson(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const payload = await response.json();
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    if (encoded.byteLength > maxBytes) {
      throw new BitvavoProviderError(
        "PROVIDER_RESPONSE_TOO_LARGE",
        "Bitvavo response exceeded the configured size limit."
      );
    }
    return payload;
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new BitvavoProviderError(
        "PROVIDER_RESPONSE_TOO_LARGE",
        "Bitvavo response exceeded the configured size limit."
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
