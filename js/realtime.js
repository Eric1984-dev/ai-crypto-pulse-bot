(function attachCryptoPulsePolling(root) {
  function startAlignedPolling({
    callback,
    intervalMs = 30000,
    windowRef = globalThis,
    setTimeoutImpl = windowRef.setTimeout
      ? windowRef.setTimeout.bind(windowRef)
      : globalThis.setTimeout,
    clearTimeoutImpl = windowRef.clearTimeout
      ? windowRef.clearTimeout.bind(windowRef)
      : globalThis.clearTimeout,
    setIntervalImpl = windowRef.setInterval
      ? windowRef.setInterval.bind(windowRef)
      : globalThis.setInterval,
    clearIntervalImpl = windowRef.clearInterval
      ? windowRef.clearInterval.bind(windowRef)
      : globalThis.clearInterval,
    nowImpl = Date.now
  } = {}) {
    if (typeof callback !== "function" || !Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new TypeError("Aligned polling requires a callback and positive interval.");
    }

    let timeoutId = null;
    let intervalId = null;
    let stopped = false;
    const run = () => {
      if (!stopped) {
        callback();
      }
    };

    if (typeof setTimeoutImpl === "function" && typeof setIntervalImpl === "function") {
      const now = nowImpl();
      if (!Number.isFinite(now)) {
        throw new TypeError("Aligned polling requires a finite clock value.");
      }
      const remainder = ((now % intervalMs) + intervalMs) % intervalMs;
      timeoutId = setTimeoutImpl(() => {
        timeoutId = null;
        if (stopped) {
          return;
        }
        intervalId = setIntervalImpl(run, intervalMs);
        run();
      }, intervalMs - remainder);
    } else if (typeof setIntervalImpl === "function") {
      intervalId = setIntervalImpl(run, intervalMs);
    }

    return () => {
      stopped = true;
      if (timeoutId !== null && typeof clearTimeoutImpl === "function") {
        clearTimeoutImpl(timeoutId);
        timeoutId = null;
      }
      if (intervalId !== null && typeof clearIntervalImpl === "function") {
        clearIntervalImpl(intervalId);
        intervalId = null;
      }
    };
  }

  function startPageRealtime() {
    return () => {};
  }

  const api = Object.freeze({ startAlignedPolling, startPageRealtime });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CryptoPulseRealtime = api;
})(globalThis);
