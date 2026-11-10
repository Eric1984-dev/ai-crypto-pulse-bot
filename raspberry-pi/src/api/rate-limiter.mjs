import { ApiError } from "./api-error.mjs";

export class FixedWindowRateLimiter {
  constructor({
    limit = 60,
    windowMs = 60000,
    maxKeys = 10000,
    now = () => Date.now()
  } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1
      || !Number.isSafeInteger(windowMs) || windowMs < 1
      || !Number.isSafeInteger(maxKeys) || maxKeys < 1) {
      throw new TypeError("Valid rate-limit bounds are required.");
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    this.buckets = new Map();
  }

  consume(key) {
    if (typeof key !== "string" || key.length === 0) {
      key = "unknown";
    }
    const timestamp = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || timestamp - bucket.startedAt >= this.windowMs) {
      this.removeExpired(timestamp);
      if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) {
        this.evictOldest();
      }
      bucket = { startedAt: timestamp, count: 0 };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= this.limit) {
      return Object.freeze({
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(
          (bucket.startedAt + this.windowMs - timestamp) / 1000
        ))
      });
    }

    bucket.count += 1;
    return Object.freeze({ allowed: true, remaining: this.limit - bucket.count });
  }

  removeExpired(timestamp) {
    for (const [key, bucket] of this.buckets) {
      if (timestamp - bucket.startedAt >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  evictOldest() {
    let oldestKey;
    let oldestStart = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.startedAt < oldestStart) {
        oldestStart = bucket.startedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.buckets.delete(oldestKey);
    }
  }
}

export function rateLimitMiddleware(limiter, getKey = (context) =>
  context.request.socket?.remoteAddress || "unknown") {
  if (!limiter || typeof limiter.consume !== "function" || typeof getKey !== "function") {
    throw new TypeError("A rate limiter and key resolver are required.");
  }
  return async (context, next) => {
    const result = limiter.consume(getKey(context));
    if (!result.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests.", {
        headers: { "Retry-After": String(result.retryAfterSeconds) }
      });
    }
    await next();
  };
}
