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

  assert.deepEqual(config.api, { host: "127.0.0.1", port: 3002 });
  assert.equal(config.liveTradingEnabled, false);
  assert.equal(config.database.poolMax, 4);
  assert.equal(createPoolOptions(config).options, "-c default_transaction_read_only=on");
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
