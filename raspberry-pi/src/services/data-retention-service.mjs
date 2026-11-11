export const DATA_RETENTION_POLICIES = Object.freeze([
  Object.freeze({ table: "AI_Crypto_Bot_Candles", column: "timestamp", interval: "1m", days: 30 }),
  Object.freeze({ table: "AI_Crypto_Bot_Candles", column: "timestamp", interval: "5m", days: 90 }),
  Object.freeze({ table: "AI_Crypto_Bot_Candles", column: "timestamp", interval: "15m", days: 180 }),
  Object.freeze({ table: "AI_Crypto_Bot_Candles", column: "timestamp", interval: "1h", days: 365 }),
  Object.freeze({ table: "AI_Crypto_Bot_Candles", column: "timestamp", interval: "4h", days: null }),
  Object.freeze({ table: "AI_Crypto_Bot_Candles", column: "timestamp", interval: "1d", days: null }),
  Object.freeze({
    table: "AI_Crypto_Bot_AI_Decisions",
    column: "created_at",
    interval: null,
    days: 180
  })
]);

export function createDataRetentionService({ now = () => new Date() } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("A retention planning clock is required.");
  }
  return Object.freeze({
    plan() {
      const plannedAt = readTime(now());
      const policies = DATA_RETENTION_POLICIES.map((policy) => Object.freeze({
        ...policy,
        cutoffAt: policy.days === null
          ? null
          : new Date(plannedAt.getTime() - policy.days * 24 * 60 * 60 * 1000).toISOString()
      }));
      return Object.freeze({
        status: "PLANNED",
        plannedAt: plannedAt.toISOString(),
        deletionEnabled: false,
        deletedRows: 0,
        policies: Object.freeze(policies)
      });
    }
  });
}

function readTime(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("The retention planning clock returned an invalid timestamp.");
  }
  return date;
}
