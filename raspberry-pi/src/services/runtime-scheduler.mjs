export const RUNTIME_CYCLE_INTERVAL_MS = 5 * 60 * 1000;
export const RUNTIME_OWNERSHIP_LOCK_ID = 882018082;
export const RUNTIME_SHUTDOWN_TIMEOUT_MS = 120 * 1000;

const ORDERED_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);

export class RuntimeOwnershipError extends Error {
  constructor(message, code = "RUNTIME_OWNERSHIP_LOCK_FAILED", cause) {
    super(message, { cause });
    this.name = "RuntimeOwnershipError";
    this.code = code;
    this.component = "runtime-ownership-lock";
  }
}

export async function acquireRuntimeOwnershipLock(pool) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("A PostgreSQL pool is required for runtime ownership.");
  }
  const client = await pool.connect();
  let retained = false;
  let lockAttempted = false;
  let connectionError = null;
  const onConnectionError = (error) => {
    connectionError = error;
  };
  try {
    lockAttempted = true;
    const result = await client.query(
      "SELECT pg_catalog.pg_try_advisory_lock($1::bigint) AS locked",
      [RUNTIME_OWNERSHIP_LOCK_ID]
    );
    if (result.rows[0]?.locked !== true) {
      throw new RuntimeOwnershipError(
        "Another runtime process already owns the scheduler lock.",
        "RUNTIME_ALREADY_RUNNING"
      );
    }
    retained = true;
    client.on?.("error", onConnectionError);
    let released = false;
    return Object.freeze({
      async assertHeld() {
        if (released || connectionError) {
          throw new RuntimeOwnershipError(
            "The runtime ownership lock connection is no longer available.",
            "RUNTIME_OWNERSHIP_LOCK_LOST",
            connectionError
          );
        }
        try {
          await client.query("SELECT 1");
        } catch (error) {
          connectionError = error;
          throw new RuntimeOwnershipError(
            "The runtime ownership lock connection is no longer available.",
            "RUNTIME_OWNERSHIP_LOCK_LOST",
            error
          );
        }
      },
      abandon() {
        if (released) {
          return;
        }
        released = true;
        client.removeListener?.("error", onConnectionError);
        client.release(new RuntimeOwnershipError(
          "The runtime cycle exceeded the graceful-shutdown limit."
        ));
      },
      async release() {
        if (released) {
          return;
        }
        released = true;
        let releaseError;
        try {
          const unlock = await client.query(
            "SELECT pg_catalog.pg_advisory_unlock($1::bigint) AS unlocked",
            [RUNTIME_OWNERSHIP_LOCK_ID]
          );
          if (unlock.rows[0]?.unlocked !== true) {
            throw new RuntimeOwnershipError(
              "The runtime ownership lock was not held during shutdown."
            );
          }
        } catch (error) {
          releaseError = error;
          throw error;
        } finally {
          client.removeListener?.("error", onConnectionError);
          client.release(releaseError);
        }
      }
    });
  } catch (error) {
    if (!retained) {
      if (lockAttempted && !(error instanceof RuntimeOwnershipError
        && error.code === "RUNTIME_ALREADY_RUNNING")) {
        try {
          await client.query(
            "SELECT pg_catalog.pg_advisory_unlock($1::bigint) AS unlocked",
            [RUNTIME_OWNERSHIP_LOCK_ID]
          );
        } catch {
          client.release(error);
          if (error instanceof RuntimeOwnershipError) {
            throw error;
          }
          throw new RuntimeOwnershipError(
            "The runtime lock attempt failed and its connection could not be cleaned up.",
            "RUNTIME_OWNERSHIP_LOCK_FAILED",
            error
          );
        }
      }
      client.release();
    }
    if (error instanceof RuntimeOwnershipError) {
      throw error;
    }
    throw new RuntimeOwnershipError(
      "The runtime could not acquire its PostgreSQL ownership lock.",
      "RUNTIME_OWNERSHIP_LOCK_FAILED",
      error
    );
  }
}

export function dueCandleIntervals(slot) {
  const date = slot instanceof Date ? slot : new Date(slot);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("A valid UTC cycle slot is required.");
  }
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const intervals = ["1m"];
  if (minute % 15 === 0) intervals.push("5m");
  if (minute % 30 === 0) intervals.push("15m");
  if (minute === 0) intervals.push("1h");
  if (minute === 0 && hour % 4 === 0) intervals.push("4h");
  if (minute === 0 && hour === 0) intervals.push("1d");
  return Object.freeze(ORDERED_INTERVALS.filter((interval) => intervals.includes(interval)));
}

export function createRuntimeScheduler({
  runCycle,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
  onFatal,
  cycleIntervalMs = RUNTIME_CYCLE_INTERVAL_MS
} = {}) {
  if (typeof runCycle !== "function"
    || typeof now !== "function"
    || typeof setTimer !== "function"
    || typeof clearTimer !== "function"
    || onFatal !== undefined && typeof onFatal !== "function"
    || cycleIntervalMs !== RUNTIME_CYCLE_INTERVAL_MS) {
    throw new TypeError("A runtime cycle and the fixed five-minute scheduler are required.");
  }
  let timer = null;
  let activeCycle = null;
  let started = false;
  let stopping = false;
  let nextSlot = null;

  return Object.freeze({
    start() {
      if (started || stopping) {
        throw new Error("The runtime scheduler cannot be started more than once.");
      }
      started = true;
      scheduleNext();
    },
    async stop({ timeoutMs = RUNTIME_SHUTDOWN_TIMEOUT_MS } = {}) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0
        || timeoutMs > RUNTIME_SHUTDOWN_TIMEOUT_MS) {
        throw new RangeError("The runtime shutdown wait must be within 120 seconds.");
      }
      stopping = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (!activeCycle) {
        return true;
      }
      let timeout;
      const stopped = await Promise.race([
        activeCycle.then(() => true),
        new Promise((resolve) => {
          timeout = setTimer(() => resolve(false), timeoutMs);
        })
      ]);
      if (timeout !== undefined) {
        clearTimer(timeout);
      }
      if (!stopped) {
        logger.error(JSON.stringify({
          event: "runtime_shutdown_cycle_timeout",
          timeoutMs
        }));
      }
      return stopped;
    },
    get running() {
      return activeCycle !== null;
    },
    get nextCycleAt() {
      return nextSlot === null ? null : new Date(nextSlot);
    }
  });

  function scheduleNext() {
    if (stopping) {
      return;
    }
    const currentTime = readClock(now);
    nextSlot = (Math.floor(currentTime / cycleIntervalMs) + 1) * cycleIntervalMs;
    timer = setTimer(() => {
      timer = null;
      if (stopping || activeCycle) {
        scheduleNext();
        return;
      }
      const scheduledSlot = new Date(nextSlot);
      activeCycle = Promise.resolve()
        .then(() => runCycle({
          slot: scheduledSlot,
          intervals: dueCandleIntervals(scheduledSlot)
        }))
        .catch((error) => {
          logger.error(JSON.stringify({
            event: "runtime_cycle_unhandled_failure",
            code: safeCode(error?.code),
            component: safeComponent(error?.component)
          }));
          if (error?.code === "RUNTIME_OWNERSHIP_LOCK_LOST") {
            stopping = true;
            onFatal?.(error);
          }
        })
        .finally(() => {
          activeCycle = null;
          scheduleNext();
        });
    }, Math.max(0, nextSlot - currentTime));
    timer?.unref?.();
  }
}

function readClock(now) {
  const value = now();
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new TypeError("The runtime scheduler clock returned an invalid timestamp.");
  }
  return timestamp;
}

function safeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : "RUNTIME_CYCLE_FAILED";
}

function safeComponent(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)
    ? value
    : "runtime-scheduler";
}
