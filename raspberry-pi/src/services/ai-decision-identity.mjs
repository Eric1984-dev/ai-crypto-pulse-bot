import { createHash } from "node:crypto";

export function createDeterministicDecisionId(input) {
  const canonicalInput = canonicalize(input);
  const hash = createHash("sha256").update(JSON.stringify(canonicalInput)).digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("Invalid dates cannot be fingerprinted.");
    }
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Non-finite numbers cannot be fingerprinted.");
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol"
    || value === undefined) {
    throw new TypeError("Unsupported values cannot be fingerprinted.");
  }
  return value;
}
