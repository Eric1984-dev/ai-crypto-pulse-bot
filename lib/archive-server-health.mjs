const requestTimeoutMs = 3000;
const maxResponseLength = 2048;
const maxDatabaseSizeLength = 64;

const offlineHealth = Object.freeze({
  server: "offline",
  postgresql: "offline",
  database: "offline",
  diskUsage: null,
  databaseSize: null,
  lastHealthCheck: null
});

function getHealthUrl(baseUrl, environment) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return null;
  }

  try {
    const url = new URL(baseUrl.trim());
    const secure = url.protocol === "https:";
    const localDevelopment = environment === "development" && url.protocol === "http:";
    if ((!secure && !localDevelopment)
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== "" && url.pathname !== "/")) {
      return null;
    }
    return new URL("/api/health", url).toString();
  } catch {
    return null;
  }
}

function normalizeStatus(value) {
  if (typeof value !== "string") {
    return null;
  }
  const status = value.trim().toLowerCase();
  return status === "online" || status === "offline" ? status : null;
}

export function normalizeArchiveHealth(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const server = normalizeStatus(payload.server);
  const postgresql = normalizeStatus(payload.postgresql);
  const database = normalizeStatus(payload.database);
  const lastHealthCheck = typeof payload.lastHealthCheck === "string"
    && Number.isFinite(Date.parse(payload.lastHealthCheck))
    ? payload.lastHealthCheck
    : null;
  if (!Object.prototype.hasOwnProperty.call(payload, "diskUsage")
    || !Object.prototype.hasOwnProperty.call(payload, "databaseSize")
    || !lastHealthCheck) {
    return null;
  }
  const diskUsage = payload.diskUsage === null || payload.diskUsage === undefined
    ? null
    : payload.diskUsage;
  const databaseSize = payload.databaseSize === null || payload.databaseSize === undefined
    ? null
    : typeof payload.databaseSize === "string"
      ? payload.databaseSize.trim()
      : null;

  if (!server || !postgresql || !database
    || (diskUsage !== null
      && (typeof diskUsage !== "number" || !Number.isFinite(diskUsage)
        || diskUsage < 0 || diskUsage > 100))
    || (payload.databaseSize !== null && payload.databaseSize !== undefined
      && typeof payload.databaseSize !== "string")
    || (databaseSize !== null
      && (!databaseSize || databaseSize.length > maxDatabaseSizeLength))) {
    return null;
  }

  return { server, postgresql, database, diskUsage, databaseSize, lastHealthCheck };
}

export async function fetchArchiveServerHealth({
  baseUrl,
  token,
  environment,
  fetchImpl = globalThis.fetch
} = {}) {
  const url = getHealthUrl(baseUrl, environment);
  if (!url || typeof token !== "string" || Buffer.byteLength(token, "utf8") < 32
    || typeof fetchImpl !== "function") {
    return { ...offlineHealth };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof TypeError
      || error?.name === "AbortError"
      || error?.name === "TimeoutError") {
      return { ...offlineHealth };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response || !response.ok || typeof response.text !== "function") {
    return { ...offlineHealth };
  }

  let payload;
  try {
    const body = await response.text();
    if (body.length > maxResponseLength) {
      return { ...offlineHealth };
    }
    payload = JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return { ...offlineHealth };
    }
    throw error;
  }

  return normalizeArchiveHealth(payload) || { ...offlineHealth };
}
