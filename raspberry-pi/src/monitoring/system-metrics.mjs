import os from "node:os";
import fs from "node:fs/promises";

let previousCpuSample = null;

export async function collectSystemMetrics({
  osRef = os,
  processRef = process,
  fsRef = fs,
  cwd = process.cwd(),
  temperaturePath = "/sys/class/thermal/thermal_zone0/temp",
  modelPath = "/proc/device-tree/model"
} = {}) {
  const [disk, temperatureC, model] = await Promise.all([
    readDiskMetrics(fsRef, cwd),
    readTemperature(fsRef, temperaturePath),
    readHardwareModel(fsRef, modelPath)
  ]);
  const memoryTotalBytes = finiteNonNegative(osRef.totalmem());
  const memoryAvailableBytes = finiteNonNegative(osRef.freemem());

  return Object.freeze({
    model,
    cpuUsagePercent: readCpuUsage(osRef.cpus()),
    loadAverage: Object.freeze(osRef.loadavg().map((value) => finiteNonNegative(value))),
    memory: Object.freeze({
      totalBytes: memoryTotalBytes,
      availableBytes: memoryAvailableBytes,
      usedPercent: percentage(memoryTotalBytes, memoryAvailableBytes)
    }),
    temperatureC,
    disk
  });
}

async function readHardwareModel(fsRef, modelPath) {
  try {
    const raw = await fsRef.readFile(modelPath, "utf8");
    const model = raw.replace(/\0/g, "").trim();
    if (!model || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) {
      throw new Error("System model reading is invalid.");
    }
    return model;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

async function readDiskMetrics(fsRef, cwd) {
  if (typeof fsRef.statfs !== "function") {
    return Object.freeze({ totalBytes: null, availableBytes: null, usedPercent: null });
  }
  const stats = await fsRef.statfs(cwd);
  const totalBytes = finiteNonNegative(stats.blocks * stats.bsize);
  const availableBytes = finiteNonNegative(stats.bavail * stats.bsize);
  return Object.freeze({
    totalBytes,
    availableBytes,
    usedPercent: percentage(totalBytes, availableBytes)
  });
}

async function readTemperature(fsRef, temperaturePath) {
  try {
    const raw = await fsRef.readFile(temperaturePath, "utf8");
    const milliCelsius = Number(raw.trim());
    if (!Number.isFinite(milliCelsius) || milliCelsius < 0 || milliCelsius > 200000) {
      throw new Error("System temperature reading is invalid.");
    }
    return milliCelsius / 1000;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

function readCpuUsage(cpus) {
  const sample = cpus.reduce((result, cpu) => {
    for (const [mode, milliseconds] of Object.entries(cpu.times)) {
      result.total += milliseconds;
      if (mode === "idle") {
        result.idle += milliseconds;
      }
    }
    return result;
  }, { idle: 0, total: 0 });
  const previous = previousCpuSample;
  previousCpuSample = sample;
  if (!previous || sample.total <= previous.total) {
    return null;
  }
  const totalDelta = sample.total - previous.total;
  const idleDelta = sample.idle - previous.idle;
  return Math.round((1 - idleDelta / totalDelta) * 10000) / 100;
}

function percentage(total, available) {
  if (total === null || available === null || total === 0 || available > total) {
    return null;
  }
  return Math.round(((total - available) / total) * 10000) / 100;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
