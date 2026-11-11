import { readFileSync } from "node:fs";
import { isIP } from "node:net";

const DEFAULTS = Object.freeze({
  databasePort: 5432,
  apiHost: "127.0.0.1",
  apiPort: 3002,
  poolMax: 4,
  connectionTimeoutMs: 2000,
  queryTimeoutMs: 5000,
  idleTimeoutMs: 10000,
  sessionTtlMs: 8 * 60 * 60 * 1000,
  sessionMax: 1000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 60
});

function requiredString(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required runtime setting: ${name}`);
  }
  return value.trim();
}

function readInteger(env, name, fallback, { min, max }) {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid runtime setting: ${name}`);
  }
  return value;
}

function isLoopbackHost(host) {
  const normalized = host.toLowerCase();
  return normalized === "localhost"
    || normalized === "::1"
    || (isIP(normalized) === 4 && normalized.startsWith("127."));
}

function readBoolean(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`Invalid runtime setting: ${name}`);
}

function readCorsOrigins(env) {
  const raw = env.API_CORS_ORIGINS?.trim() || "";
  if (!raw) {
    return Object.freeze([]);
  }

  const origins = raw.split(",").map((origin) => origin.trim());
  if (origins.some((origin) => !origin) || new Set(origins).size !== origins.length) {
    throw new Error("Invalid runtime setting: API_CORS_ORIGINS");
  }

  for (const origin of origins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("Invalid runtime setting: API_CORS_ORIGINS");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const isLocalHttpOrigin = url.protocol === "http:" && isLoopbackHost(hostname);
    if (origin === "*"
      || url.origin !== origin
      || url.username
      || url.password
      || (url.protocol !== "https:" && !isLocalHttpOrigin)) {
      throw new Error("Invalid runtime setting: API_CORS_ORIGINS");
    }
  }
  return Object.freeze(origins);
}

function readCloudflareAccessConfig(env) {
  const enabled = readBoolean(env, "CLOUDFLARE_ACCESS_ENABLED", false);
  const issuer = env.CLOUDFLARE_ACCESS_ISSUER?.trim() || "";
  const audience = env.CLOUDFLARE_ACCESS_AUDIENCE?.trim() || "";
  const allowedOperatorEmails = (env.ALLOWED_OPERATOR_EMAILS?.trim() || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!enabled) {
    return Object.freeze({
      enabled,
      issuer: "",
      audience: "",
      allowedOperatorEmails: Object.freeze([])
    });
  }
  if (!issuer || !audience || allowedOperatorEmails.length === 0
    || new Set(allowedOperatorEmails).size !== allowedOperatorEmails.length
    || allowedOperatorEmails.some((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw new Error(
      "CLOUDFLARE_ACCESS_ENABLED requires a valid issuer, audience, and operator email allowlist."
    );
  }

  let issuerUrl;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error("Invalid runtime setting: CLOUDFLARE_ACCESS_ISSUER");
  }
  if (issuerUrl.protocol !== "https:" || issuerUrl.origin !== issuer
    || issuerUrl.username || issuerUrl.password || issuerUrl.pathname !== "/"
    || issuerUrl.search || issuerUrl.hash) {
    throw new Error("Invalid runtime setting: CLOUDFLARE_ACCESS_ISSUER");
  }

  return Object.freeze({
    enabled,
    issuer,
    audience,
    allowedOperatorEmails: Object.freeze(allowedOperatorEmails)
  });
}

export function readRuntimeConfig(env = process.env, {
  readFile = readFileSync
} = {}) {
  const databaseHost = requiredString(env, "DATABASE_HOST");
  const databaseName = requiredString(env, "DATABASE_NAME");
  const databaseUser = requiredString(env, "DATABASE_USER");
  const databasePassword = requiredString(env, "DATABASE_PASSWORD");
  const aiDatabaseUser = env.AI_DATABASE_USER?.trim() || "";
  const aiDatabasePassword = env.AI_DATABASE_PASSWORD || "";
  if (Boolean(aiDatabaseUser) !== Boolean(aiDatabasePassword)) {
    throw new Error("AI_DATABASE_USER and AI_DATABASE_PASSWORD must be set together.");
  }
  const paperDatabaseUser = env.PAPER_DATABASE_USER?.trim() || "";
  const paperDatabasePassword = env.PAPER_DATABASE_PASSWORD || "";
  if (Boolean(paperDatabaseUser) !== Boolean(paperDatabasePassword)) {
    throw new Error("PAPER_DATABASE_USER and PAPER_DATABASE_PASSWORD must be set together.");
  }
  const databaseSslEnabled = readBoolean(env, "DATABASE_SSL", true);
  const databaseSslCaPath = env.DATABASE_SSL_CA_PATH?.trim() || "";
  const databaseSslServername = env.DATABASE_SSL_SERVERNAME?.trim() || "";
  const dashboardUsername = requiredString(env, "DASHBOARD_USERNAME");
  const dashboardPasswordHash = requiredString(env, "DASHBOARD_PASSWORD_HASH");
  const liveTradingEnabled = readBoolean(env, "ENABLE_LIVE_TRADING", false);

  if (dashboardUsername.length > 128 || /[\u0000-\u001f\u007f]/.test(dashboardUsername)) {
    throw new Error("Invalid runtime setting: DASHBOARD_USERNAME");
  }
  if (!/^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$/.test(dashboardPasswordHash)) {
    throw new Error("DASHBOARD_PASSWORD_HASH must be a valid bcrypt hash with cost 10 through 14.");
  }
  if (liveTradingEnabled) {
    throw new Error("Runtime startup requires ENABLE_LIVE_TRADING=false.");
  }
  if (!databaseSslEnabled && !isLoopbackHost(databaseHost)) {
    throw new Error("DATABASE_SSL=false is permitted only for a loopback database host.");
  }
  if (databaseSslCaPath && !databaseSslEnabled) {
    throw new Error("DATABASE_SSL_CA_PATH requires DATABASE_SSL=true.");
  }
  if (!isLoopbackHost(env.API_HOST?.trim() || DEFAULTS.apiHost)) {
    throw new Error("The Phase 2 API may bind only to a loopback address.");
  }

  let databaseSsl = false;
  if (databaseSslEnabled) {
    databaseSsl = { rejectUnauthorized: true };
    if (databaseSslCaPath) {
      try {
        databaseSsl.ca = readFile(databaseSslCaPath, "utf8");
      } catch {
        throw new Error("DATABASE_SSL_CA_PATH could not be read.");
      }
    }
    if (databaseSslServername) {
      databaseSsl.servername = databaseSslServername;
    }
  }

  return Object.freeze({
    database: Object.freeze({
      host: databaseHost,
      port: readInteger(env, "DATABASE_PORT", DEFAULTS.databasePort, { min: 1, max: 65535 }),
      name: databaseName,
      user: databaseUser,
      password: databasePassword,
      ssl: databaseSsl,
      poolMax: readInteger(env, "PG_POOL_MAX", DEFAULTS.poolMax, { min: 1, max: 4 }),
      connectionTimeoutMillis: readInteger(
        env,
        "PG_CONNECTION_TIMEOUT_MS",
        DEFAULTS.connectionTimeoutMs,
        { min: 100, max: 30000 }
      ),
      queryTimeoutMillis: readInteger(
        env,
        "PG_QUERY_TIMEOUT_MS",
        DEFAULTS.queryTimeoutMs,
        { min: 100, max: 30000 }
      ),
      idleTimeoutMillis: readInteger(
        env,
        "PG_IDLE_TIMEOUT_MS",
        DEFAULTS.idleTimeoutMs,
        { min: 100, max: 60000 }
      )
    }),
    api: Object.freeze({
      host: env.API_HOST?.trim() || DEFAULTS.apiHost,
      port: readInteger(env, "API_PORT", DEFAULTS.apiPort, { min: 1024, max: 65535 }),
      dashboardAuth: Object.freeze({
        username: dashboardUsername,
        passwordHash: dashboardPasswordHash
      }),
      corsOrigins: readCorsOrigins(env),
      cloudflareAccess: readCloudflareAccessConfig(env),
      sessionTtlMs: readInteger(
        env,
        "API_SESSION_TTL_MS",
        DEFAULTS.sessionTtlMs,
        { min: 60000, max: 86400000 }
      ),
      sessionMax: readInteger(
        env,
        "API_SESSION_MAX",
        DEFAULTS.sessionMax,
        { min: 1, max: 10000 }
      ),
      rateLimitWindowMs: readInteger(
        env,
        "API_RATE_LIMIT_WINDOW_MS",
        DEFAULTS.rateLimitWindowMs,
        { min: 1000, max: 3600000 }
      ),
      rateLimitMaxRequests: readInteger(
        env,
        "API_RATE_LIMIT_MAX_REQUESTS",
        DEFAULTS.rateLimitMaxRequests,
        { min: 1, max: 1000 }
      )
    }),
    ingestion: Object.freeze({
      allowTableOwner: readBoolean(env, "INGESTION_ALLOW_TABLE_OWNER", false)
    }),
    aiAnalysis: Object.freeze({
      databaseUser: aiDatabaseUser,
      databasePassword: aiDatabasePassword
    }),
    paperTrading: Object.freeze({
      databaseUser: paperDatabaseUser,
      databasePassword: paperDatabasePassword
    }),
    liveTradingEnabled
  });
}

export function createPoolOptions(config) {
  return {
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl,
    max: config.database.poolMax,
    connectionTimeoutMillis: config.database.connectionTimeoutMillis,
    query_timeout: config.database.queryTimeoutMillis,
    idleTimeoutMillis: config.database.idleTimeoutMillis,
    options: "-c default_transaction_read_only=on"
  };
}
