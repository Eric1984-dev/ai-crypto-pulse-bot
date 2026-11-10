import { createHash, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ROLE_PATTERN = /^[a-z][a-z0-9:_-]{0,63}$/;

export class SessionCapacityError extends Error {
  constructor() {
    super("The in-memory session capacity has been reached.");
    this.name = "SessionCapacityError";
    this.code = "SESSION_CAPACITY_EXCEEDED";
  }
}

export function createSessionStore({
  ttlMs = 8 * 60 * 60 * 1000,
  maxSessions = 1000,
  now = () => Date.now(),
  randomToken = () => randomBytes(32).toString("base64url")
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000
    || !Number.isSafeInteger(maxSessions) || maxSessions < 1) {
    throw new TypeError("Valid session expiry and capacity limits are required.");
  }

  const sessions = new Map();

  function removeExpired(timestamp) {
    for (const [hash, entry] of sessions) {
      if (entry.expiresAt <= timestamp) {
        sessions.delete(hash);
      }
    }
  }

  return Object.freeze({
    create(principal) {
      const normalizedPrincipal = validatePrincipal(principal);
      const timestamp = now();
      removeExpired(timestamp);
      if (sessions.size >= maxSessions) {
        throw new SessionCapacityError();
      }

      const token = randomToken();
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
        throw new TypeError("The session token generator returned an invalid token.");
      }
      const csrfToken = randomBytes(32).toString("base64url");
      const entry = Object.freeze({
        principal: normalizedPrincipal,
        csrfToken,
        createdAt: new Date(timestamp).toISOString(),
        expiresAt: timestamp + ttlMs
      });
      sessions.set(hashToken(token), entry);
      return Object.freeze({ token, session: entry });
    },
    get(token) {
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
        return null;
      }
      const hash = hashToken(token);
      const entry = sessions.get(hash);
      if (!entry) {
        return null;
      }
      if (entry.expiresAt <= now()) {
        sessions.delete(hash);
        return null;
      }
      return entry;
    },
    delete(token) {
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
        return false;
      }
      return sessions.delete(hashToken(token));
    },
    get size() {
      removeExpired(now());
      return sessions.size;
    }
  });
}

function validatePrincipal(principal) {
  if (!principal || typeof principal.subject !== "string"
    || principal.subject.trim() === "" || principal.subject.length > 256
    || !Array.isArray(principal.roles)
    || principal.roles.some((role) => typeof role !== "string" || !ROLE_PATTERN.test(role))) {
    throw new TypeError("A trusted principal with a subject and roles is required.");
  }
  return Object.freeze({
    subject: principal.subject,
    roles: Object.freeze([...new Set(principal.roles)])
  });
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
