import test from "node:test";
import assert from "node:assert/strict";
import { collectSystemMetrics } from "../src/monitoring/system-metrics.mjs";

function createSystemMetricsOptions({
  model = "Raspberry Pi 5 Model B Rev 1.0\0",
  uptimeSeconds = 3600,
  now = Date.now
} = {}) {
  return {
    cwd: "/app",
    osRef: {
      cpus: () => [{ times: { user: 10, idle: 90 } }],
      loadavg: () => [0.1, 0.2, 0.3],
      uptime: () => uptimeSeconds,
      totalmem: () => 1000,
      freemem: () => 400
    },
    now,
    fsRef: {
      async statfs() {
        return { blocks: 10, bsize: 100, bavail: 4 };
      },
      async readFile(path) {
        if (path === "/proc/device-tree/model") {
          if (model === null) {
            const error = new Error("File not found.");
            error.code = "ENOENT";
            throw error;
          }
          return model;
        }
        if (path === "/sys/class/thermal/thermal_zone0/temp") {
          return "42000";
        }
        throw new Error(`Unexpected file: ${path}`);
      }
    }
  };
}

test("system metrics read and normalize the Raspberry Pi model", async () => {
  const metrics = await collectSystemMetrics(createSystemMetricsOptions());

  assert.equal(metrics.model, "Raspberry Pi 5 Model B Rev 1.0");
  assert.equal(metrics.temperatureC, 42);
});

test("system metrics report a missing device model as unavailable", async () => {
  const metrics = await collectSystemMetrics(createSystemMetricsOptions({ model: null }));

  assert.equal(metrics.model, null);
});

test("system metrics derive host boot time from operating-system uptime", async () => {
  const now = Date.parse("2026-11-14T20:00:00.000Z");
  const metrics = await collectSystemMetrics(createSystemMetricsOptions({
    uptimeSeconds: 3600,
    now: () => now
  }));

  assert.equal(metrics.bootTime, "2026-11-14T19:00:00.000Z");
});
