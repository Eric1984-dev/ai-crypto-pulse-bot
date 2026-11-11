import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  acquireRuntimeOwnershipLock,
  createRuntimeScheduler,
  dueCandleIntervals,
  RUNTIME_CYCLE_INTERVAL_MS,
  RUNTIME_OWNERSHIP_LOCK_ID
} from "../src/services/runtime-scheduler.mjs";

test("candle cadence follows the fixed five-minute UTC cycle", () => {
  assert.deepEqual(
    dueCandleIntervals(new Date("2026-01-01T12:05:00.000Z")),
    ["1m"]
  );
  assert.deepEqual(
    dueCandleIntervals(new Date("2026-01-01T12:15:00.000Z")),
    ["1m", "5m"]
  );
  assert.deepEqual(
    dueCandleIntervals(new Date("2026-01-01T12:30:00.000Z")),
    ["1m", "5m", "15m"]
  );
  assert.deepEqual(
    dueCandleIntervals(new Date("2026-01-01T00:00:00.000Z")),
    ["1m", "5m", "15m", "1h", "4h", "1d"]
  );
});

test("scheduler aligns to UTC slots and does not overlap or catch up missed cycles", async () => {
  let currentTime = Date.parse("2026-01-01T12:01:00.000Z");
  const timers = new Map();
  let nextTimerId = 0;
  const calls = [];
  let finishCycle;
  const scheduler = createRuntimeScheduler({
    now: () => currentTime,
    setTimer(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, dueAt: currentTime + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    runCycle: (cycle) => {
      calls.push(cycle);
      return new Promise((resolve) => {
        finishCycle = resolve;
      });
    }
  });

  scheduler.start();
  assert.equal(scheduler.nextCycleAt.toISOString(), "2026-01-01T12:05:00.000Z");
  const [firstId, firstTimer] = [...timers.entries()][0];
  timers.delete(firstId);
  currentTime = firstTimer.dueAt;
  firstTimer.callback();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(scheduler.running, true);

  currentTime = Date.parse("2026-01-01T12:07:00.000Z");
  finishCycle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.nextCycleAt.toISOString(), "2026-01-01T12:10:00.000Z");
  assert.equal(timers.size, 1);
  assert.equal(await scheduler.stop(), true);
  assert.equal(timers.size, 0);
  assert.equal(RUNTIME_CYCLE_INTERVAL_MS, 300000);
});

test("runtime owner lock is held for the client session and released explicitly", async () => {
  const queries = [];
  let released = false;
  const lock = await acquireRuntimeOwnershipLock({
    async connect() {
      return {
        async query(sql, values) {
          queries.push({ sql, values });
          return {
            rows: [sql.includes("pg_try_advisory_lock")
              ? { locked: true }
              : { unlocked: true }]
          };
        },
        release() {
          released = true;
        }
      };
    }
  });
  assert.equal(queries[0].values[0], RUNTIME_OWNERSHIP_LOCK_ID);
  await lock.assertHeld();
  await lock.release();
  assert.equal(queries[2].values[0], RUNTIME_OWNERSHIP_LOCK_ID);
  assert.equal(released, true);
});

test("runtime owner lock rejects a second process and releases its connection", async () => {
  let released = false;
  await assert.rejects(acquireRuntimeOwnershipLock({
    async connect() {
      return {
        async query() {
          return { rows: [{ locked: false }] };
        },
        release() {
          released = true;
        }
      };
    }
  }), { code: "RUNTIME_ALREADY_RUNNING" });
  assert.equal(released, true);
});

test("scheduler stops after runtime ownership is lost", async () => {
  let currentTime = Date.parse("2026-01-01T12:01:00.000Z");
  let timer;
  let fatal = false;
  const scheduler = createRuntimeScheduler({
    now: () => currentTime,
    setTimer(callback, delay) {
      timer = { callback, dueAt: currentTime + delay };
      return timer;
    },
    clearTimer() {
      timer = null;
    },
    runCycle: async () => {
      throw Object.assign(new Error("lock lost"), {
        code: "RUNTIME_OWNERSHIP_LOCK_LOST"
      });
    },
    onFatal: () => {
      fatal = true;
    },
    logger: { error() {} }
  });
  scheduler.start();
  currentTime = timer.dueAt;
  const scheduled = timer;
  timer = null;
  scheduled.callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fatal, true);
  assert.equal(timer, null);
  assert.equal(await scheduler.stop(), true);
});
test("lost runtime lock connection prevents further cycles", async () => {
  const client = new EventEmitter();
  client.query = async (sql) => ({
    rows: [sql.includes("pg_try_advisory_lock")
      ? { locked: true }
      : { unlocked: true }]
  });
  client.release = () => {};
  const lock = await acquireRuntimeOwnershipLock({
    async connect() {
      return client;
    }
  });
  client.emit("error", new Error("database connection lost"));
  await assert.rejects(lock.assertHeld(), { code: "RUNTIME_OWNERSHIP_LOCK_LOST" });
  await lock.release();
});

test("shutdown timeout discards the lock session instead of returning it to the pool", async () => {
  let releaseError;
  const lock = await acquireRuntimeOwnershipLock({
    async connect() {
      return {
        async query(sql) {
          return {
            rows: [sql.includes("pg_try_advisory_lock")
              ? { locked: true }
              : { unlocked: true }]
          };
        },
        release(error) {
          releaseError = error;
        }
      };
    }
  });

  lock.abandon();

  assert.equal(releaseError.code, "RUNTIME_OWNERSHIP_LOCK_FAILED");
  await assert.rejects(lock.assertHeld(), { code: "RUNTIME_OWNERSHIP_LOCK_LOST" });
});
