"use strict";

const { getPublicConfig, readAccessToken } = require("./auth-session.js");

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH_REQUEST_TIMEOUT_MS = 8000;

async function authorizeAdminRequest({
  cookieHeader = "",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const accessToken = readAccessToken(cookieHeader);
  if (!accessToken) {
    return authorizationFailure(401, "ADMIN_AUTH_REQUIRED", "A valid authenticated session is required.");
  }

  const adminUserIds = parseAdminUserIds(env.ADMIN_USER_IDS);
  if (!adminUserIds) {
    return authorizationFailure(503, "ADMIN_ACCESS_NOT_CONFIGURED", "Admin access is not configured.");
  }

  const config = getPublicConfig(env);
  if (!config) {
    return authorizationFailure(503, "ADMIN_AUTH_UNAVAILABLE", "Admin authorization is unavailable.");
  }

  let response;
  try {
    response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS)
    });
  } catch {
    return authorizationFailure(503, "ADMIN_AUTH_UNAVAILABLE", "Admin authorization is unavailable.");
  }

  if (response.status === 401 || response.status === 403) {
    return authorizationFailure(401, "ADMIN_AUTH_REQUIRED", "A valid authenticated session is required.");
  }
  if (!response.ok) {
    return authorizationFailure(503, "ADMIN_AUTH_UNAVAILABLE", "Admin authorization is unavailable.");
  }

  let user;
  try {
    user = await response.json();
  } catch {
    return authorizationFailure(503, "ADMIN_AUTH_UNAVAILABLE", "Admin authorization is unavailable.");
  }
  if (!user || typeof user.id !== "string" || !USER_ID_PATTERN.test(user.id)) {
    return authorizationFailure(503, "ADMIN_AUTH_UNAVAILABLE", "Admin authorization is unavailable.");
  }

  if (!adminUserIds.has(user.id.toLowerCase())) {
    return authorizationFailure(403, "ADMIN_ACCESS_DENIED", "Administrator access is required.");
  }

  return { authorized: true };
}

function parseAdminUserIds(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const userIds = value.split(",").map((userId) => userId.trim().toLowerCase());
  if (userIds.some((userId) => !USER_ID_PATTERN.test(userId))) {
    return null;
  }
  return new Set(userIds);
}

function authorizationFailure(status, code, message) {
  return { authorized: false, status, code, message };
}

module.exports = { authorizeAdminRequest };
