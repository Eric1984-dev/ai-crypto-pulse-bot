import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPostgresPool } from "../src/database/pool.mjs";
import { withReadOnlyTransaction } from "../src/database/read-only-transaction.mjs";
import { readRuntimeConfig } from "../src/config/runtime-config.mjs";

function config() {
  return readRuntimeConfig({
    DATABASE_HOST: "127.0.0.1",
    DATABASE_NAME: "cryptopulse",
    DATABASE_USER: "runtime_reader",
    DATABASE_PASSWORD: "test-password",
    DATABASE_SSL: "false"
  });
}

test("read-only transaction commits success and rolls back operation failures", async () => {
  const queries = [];
  const released = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "SELECT failure") {
        throw new Error("expected");
      }
    },
    release(error) {
      released.push(error);
    }
  };
  const pool = { async connect() { return client; } };

  await withReadOnlyTransaction(pool, async (connection) => {
    await connection.query("SELECT success");
  });
  await assert.rejects(withReadOnlyTransaction(pool, async (connection) => {
    await connection.query("SELECT failure");
  }), /expected/);

  assert.deepEqual(queries, [
    "BEGIN READ ONLY", "SELECT success", "COMMIT",
    "BEGIN READ ONLY", "SELECT failure", "ROLLBACK"
  ]);
  assert.deepEqual(released, [undefined, undefined]);
});

test("read-only transaction discards a connection when rollback itself fails", async () => {
  const rollbackFailure = new Error("rollback failed");
  let releaseArgument;
  const client = {
    async query(sql) {
      if (sql === "SELECT failure") {
        throw new Error("operation failed");
      }
      if (sql === "ROLLBACK") {
        throw rollbackFailure;
      }
    },
    release(error) {
      releaseArgument = error;
    }
  };
  const pool = { async connect() { return client; } };

  await assert.rejects(withReadOnlyTransaction(pool, (connection) =>
    connection.query("SELECT failure")), /operation failed/);
  assert.equal(releaseArgument, rollbackFailure);
});

test("PostgreSQL pool applies bounded read-only settings and emits safe errors", () => {
  let poolOptions;
  let poolErrorHandler;
  const log = [];
  class MockPool extends EventEmitter {
    constructor(options) {
      super();
      poolOptions = options;
      poolErrorHandler = null;
    }

    on(event, handler) {
      if (event === "error") {
        poolErrorHandler = handler;
      }
      return this;
    }
  }

  createPostgresPool(config(), {
    Pool: MockPool,
    logger: { error: (message) => log.push(message) }
  });
  poolErrorHandler(Object.assign(new Error("secret-bearing detail"), { code: "08006" }));

  assert.equal(poolOptions.max, 4);
  assert.equal(poolOptions.options, "-c default_transaction_read_only=on");
  assert.equal(log.length, 1);
  assert.match(log[0], /08006/);
  assert.doesNotMatch(log[0], /secret-bearing detail/);
});
