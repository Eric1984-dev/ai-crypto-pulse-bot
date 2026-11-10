import test from "node:test";
import assert from "node:assert/strict";
import { createPoolOptions, readRuntimeConfig } from "../src/config/runtime-config.mjs";

function validEnvironment(overrides = {}) {
  return {
    DATABASE_HOST: "127.0.0.1",
    DATABASE_NAME: "cryptopulse",
    DATABASE_USER: "runtime_reader",
    DATABASE_PASSWORD: "test-password",
    DATABASE_SSL: "false",
    ...overrides
  };
}

test("runtime config defaults to loopback API and disables live trading", () => {
  const config = readRuntimeConfig(validEnvironment());

  assert.deepEqual(config.api, {
    host: "127.0.0.1",
    port: 3002,
    corsOrigins: [],
    sessionTtlMs: 28800000,
    sessionMax: 1000,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 60
  });
  assert.equal(config.liveTradingEnabled, false);
  assert.equal(config.ingestion.allowTableOwner, false);
  assert.equal(config.database.poolMax, 4);
  assert.equal(createPoolOptions(config).options, "-c default_transaction_read_only=on");
});

test("runtime config requires explicit boolean opt-in for ingestion table ownership", () => {
  assert.equal(readRuntimeConfig(validEnvironment({
    INGESTION_ALLOW_TABLE_OWNER: "true"
  })).ingestion.allowTableOwner, true);
  assert.equal(readRuntimeConfig(validEnvironment({
    INGESTION_ALLOW_TABLE_OWNER: "false"
  })).ingestion.allowTableOwner, false);
  assert.throws(() => readRuntimeConfig(validEnvironment({
    INGESTION_ALLOW_TABLE_OWNER: "yes"
  })), /INGESTION_ALLOW_TABLE_OWNER/);
});

test("runtime config rejects remote plaintext DB, public API binding, and live trading", () => {
  assert.throws(() => readRuntimeConfig(validEnvironment({
    DATABASE_HOST: "db.example.net"
  })), /DATABASE_SSL=false/);
  assert.throws(() => readRuntimeConfig(validEnvironment({
    API_HOST: "0.0.0.0"
  })), /loopback/);
  assert.throws(() => readRuntimeConfig(validEnvironment({
    ENABLE_LIVE_TRADING: "true"
  })), /ENABLE_LIVE_TRADING=false/);
});

test("runtime config rejects out-of-range pool and port settings", () => {
  assert.throws(() => readRuntimeConfig(validEnvironment({ PG_POOL_MAX: "5" })), /PG_POOL_MAX/);
  assert.throws(() => readRuntimeConfig(validEnvironment({ DATABASE_PORT: "0" })), /DATABASE_PORT/);
});

test("runtime config validates origins and bounded API controls", () => {
  const config = readRuntimeConfig(validEnvironment({
    API_CORS_ORIGINS: "https://dashboard.example.com,http://localhost:5173",
    API_RATE_LIMIT_MAX_REQUESTS: "120"
  }));
  assert.deepEqual(config.api.corsOrigins, [
    "https://dashboard.example.com",
    "http://localhost:5173"
  ]);
  assert.equal(config.api.rateLimitMaxRequests, 120);

  for (const origin of ["*", "https://dashboard.example.com/path", "http://example.com"]) {
    assert.throws(() => readRuntimeConfig(validEnvironment({
      API_CORS_ORIGINS: origin
    })), /API_CORS_ORIGINS/);
  }
  assert.throws(() => readRuntimeConfig(validEnvironment({
    API_SESSION_MAX: "0"
  })), /API_SESSION_MAX/);
});
