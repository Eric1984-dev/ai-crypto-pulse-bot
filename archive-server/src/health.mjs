import { timingSafeEqual } from "node:crypto";
import { statfsSync } from "node:fs";

function isAuthorized(header, expectedToken) {
  if (typeof header !== "string" || !expectedToken) {
    return false;
  }
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) {
    return false;
  }
  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

export function formatDatabaseSize(value) {
  let bytes;
  try {
    bytes = BigInt(value);
  } catch {
    return null;
  }
  if (bytes < 0n) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(bytes);
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? String(Math.round(amount)) : amount.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export function getDiskUsagePercent(diskPath, statfs = statfsSync) {
  const stats = statfs(diskPath);
  const totalBytes = stats.blocks * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  if (!Number.isFinite(totalBytes) || totalBytes <= 0
    || !Number.isFinite(availableBytes) || availableBytes < 0
    || availableBytes > totalBytes) {
    return null;
  }
  return Math.round(((totalBytes - availableBytes) / totalBytes) * 1000) / 10;
}

export function createArchiveHealthHandler({
  expectedToken,
  expectedDatabase,
  probePostgresql,
  checkDatabase,
  getDiskUsage,
  now = () => new Date()
}) {
  if (typeof probePostgresql !== "function"
    || typeof checkDatabase !== "function"
    || typeof getDiskUsage !== "function") {
    throw new TypeError("Archive health checks must be configured.");
  }

  return async function archiveHealthHandler(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }
    if (req.url !== "/api/health") {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    if (!isAuthorized(req.headers?.authorization, expectedToken)) {
      sendJson(res, 401, { error: "Unauthorized." });
      return;
    }

    const [postgresqlReachable, databaseResult, diskUsage] = await Promise.all([
      Promise.resolve().then(probePostgresql).then(Boolean, () => false),
      Promise.resolve().then(checkDatabase).catch(() => null),
      Promise.resolve().then(getDiskUsage).catch(() => null)
    ]);

    const databaseOnline = Boolean(
      databaseResult
      && databaseResult.databaseName === expectedDatabase
      && typeof formatDatabaseSize(databaseResult.sizeBytes) === "string"
    );
    const databaseSize = databaseOnline
      ? formatDatabaseSize(databaseResult.sizeBytes)
      : null;
    const validDiskUsage = typeof diskUsage === "number"
      && Number.isFinite(diskUsage)
      && diskUsage >= 0
      && diskUsage <= 100
      ? diskUsage
      : null;

    sendJson(res, 200, {
      server: "online",
      postgresql: postgresqlReachable || databaseOnline ? "online" : "offline",
      database: databaseOnline ? "online" : "offline",
      diskUsage: validDiskUsage,
      databaseSize,
      lastHealthCheck: now().toISOString()
    });
  };
}
