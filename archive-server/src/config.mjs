function requiredValue(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required archive server setting: ${name}`);
  }
  return value.trim();
}

function readPort(value, name, fallback) {
  const port = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid archive server setting: ${name}`);
  }
  return port;
}

export function readArchiveConfig(env = process.env) {
  const token = requiredValue(env, "ARCHIVE_HEALTH_TOKEN");
  if (Buffer.byteLength(token, "utf8") < 32) {
    throw new Error("ARCHIVE_HEALTH_TOKEN must contain at least 32 bytes.");
  }

  return {
    host: requiredValue(env, "ARCHIVE_DB_HOST"),
    port: readPort(env.ARCHIVE_DB_PORT, "ARCHIVE_DB_PORT", 5432),
    database: requiredValue(env, "ARCHIVE_DB_NAME"),
    user: requiredValue(env, "ARCHIVE_DB_USER"),
    password: requiredValue(env, "ARCHIVE_DB_PASSWORD"),
    healthToken: token,
    healthHost: env.ARCHIVE_HEALTH_HOST?.trim() || "127.0.0.1",
    healthPort: readPort(env.ARCHIVE_HEALTH_PORT, "ARCHIVE_HEALTH_PORT", 3001),
    diskPath: env.ARCHIVE_DISK_PATH?.trim() || "/",
    ssl: {
      rejectUnauthorized: true,
      ...(env.ARCHIVE_DB_SSL_CA?.trim() ? { ca: env.ARCHIVE_DB_SSL_CA } : {}),
      ...(env.ARCHIVE_DB_SSL_SERVERNAME?.trim()
        ? { servername: env.ARCHIVE_DB_SSL_SERVERNAME.trim() }
        : {})
    }
  };
}

export function createPoolOptions(config) {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    connectionTimeoutMillis: 1800,
    query_timeout: 1800,
    idleTimeoutMillis: 10000,
    max: 1
  };
}
