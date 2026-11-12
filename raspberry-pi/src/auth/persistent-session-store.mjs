import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink
} from "node:fs/promises";
import path from "node:path";
import {
  hashSessionToken,
  isSessionToken,
  normalizeSessionPrincipal,
  SessionCapacityError
} from "./session-store.mjs";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const STORE_VERSION = 1;

export async function createPersistentSessionStore({
  filePath,
  ttlMs = 8 * 60 * 60 * 1000,
  maxSessions = 1000,
  dashboardAuth,
  now = () => Date.now(),
  randomToken = () => randomBytes(32).toString("base64url")
} = {}) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)
    || !Number.isSafeInteger(ttlMs) || ttlMs < 60_000
    || !Number.isSafeInteger(maxSessions) || maxSessions < 1
    || !dashboardAuth || typeof dashboardAuth.username !== "string"
    || dashboardAuth.username.length === 0 || typeof dashboardAuth.passwordHash !== "string"
    || typeof now !== "function" || typeof randomToken !== "function") {
    throw new TypeError("A persistent session path, valid limits, and dashboard credentials are required.");
  }

  const directoryPath = path.dirname(filePath);
  const authVersion = createHash("sha256")
    .update(dashboardAuth.username)
    .update("\0")
    .update(dashboardAuth.passwordHash)
    .digest("hex");
  await ensureStorageDirectory(directoryPath);
  const storedSessions = await loadSessions(filePath);
  let sessions = removeExpiredSessions(storedSessions, authVersion, now());
  if (sessions.size > maxSessions) {
    sessions = limitSessions(sessions, maxSessions);
  }
  if (sessions.size !== storedSessions.size) {
    await persistSessions(filePath, directoryPath, sessions);
  }

  let operationQueue = Promise.resolve();

  function serialize(operation) {
    const result = operationQueue.then(operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function pruneExpired(timestamp) {
    const activeSessions = removeExpiredSessions(sessions, authVersion, timestamp);
    if (activeSessions.size !== sessions.size) {
      await persistSessions(filePath, directoryPath, activeSessions);
      sessions = activeSessions;
    }
  }

  return Object.freeze({
    ttlMs,
    async create(principal) {
      const normalizedPrincipal = normalizeSessionPrincipal(principal);
      return serialize(async () => {
        const timestamp = now();
        await pruneExpired(timestamp);
        if (sessions.size >= maxSessions) {
          throw new SessionCapacityError();
        }

        const token = randomToken();
        if (!isSessionToken(token)) {
          throw new TypeError("The session token generator returned an invalid token.");
        }
        const tokenHash = hashSessionToken(token);
        if (sessions.has(tokenHash)) {
          throw new Error("The generated dashboard session token collided with an active session.");
        }
        const entry = Object.freeze({
          principal: normalizedPrincipal,
          authVersion,
          createdAt: new Date(timestamp).toISOString(),
          expiresAt: timestamp + ttlMs
        });
        const nextSessions = new Map(sessions);
        nextSessions.set(tokenHash, entry);
        await persistSessions(filePath, directoryPath, nextSessions);
        sessions = nextSessions;
        return Object.freeze({
          token,
          session: Object.freeze({
            principal: normalizedPrincipal,
            csrfToken: deriveCsrfToken(token),
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt
          })
        });
      });
    },
    async get(token) {
      if (!isSessionToken(token)) {
        return null;
      }
      return serialize(async () => {
        const timestamp = now();
        await pruneExpired(timestamp);
        const entry = sessions.get(hashSessionToken(token));
        if (!entry || entry.authVersion !== authVersion || entry.expiresAt <= timestamp) {
          return null;
        }
        return Object.freeze({
          principal: entry.principal,
          csrfToken: deriveCsrfToken(token),
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt
        });
      });
    },
    async delete(token) {
      if (!isSessionToken(token)) {
        return false;
      }
      return serialize(async () => {
        const tokenHash = hashSessionToken(token);
        if (!sessions.has(tokenHash)) {
          return false;
        }
        const nextSessions = new Map(sessions);
        nextSessions.delete(tokenHash);
        await persistSessions(filePath, directoryPath, nextSessions);
        sessions = nextSessions;
        return true;
      });
    },
    get size() {
      return sessions.size;
    }
  });
}

async function ensureStorageDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const details = await lstat(directoryPath);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("The dashboard session storage path must be a real directory.");
  }
  if (process.platform !== "win32") {
    await chmod(directoryPath, 0o700);
  }
}

async function loadSessions(filePath) {
  let details;
  try {
    details = await lstat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error("The dashboard session store must be a regular, non-symlink file.");
  }
  if (process.platform !== "win32") {
    await chmod(filePath, 0o600);
  }

  let document;
  try {
    document = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error("The persistent dashboard session store is unreadable or malformed.", {
      cause: error
    });
  }
  if (!document || document.version !== STORE_VERSION || !Array.isArray(document.sessions)) {
    throw new Error("The persistent dashboard session store has an unsupported format.");
  }

  const loaded = new Map();
  for (const candidate of document.sessions) {
    const entry = validateStoredSession(candidate);
    if (loaded.has(candidate.tokenHash)) {
      throw new Error("The persistent dashboard session store contains duplicate entries.");
    }
    loaded.set(candidate.tokenHash, entry);
  }
  return loaded;
}

function validateStoredSession(candidate) {
  if (!candidate || typeof candidate !== "object"
    || Object.keys(candidate).some((key) =>
      !["tokenHash", "authVersion", "principal", "createdAt", "expiresAt"].includes(key))
    || typeof candidate.tokenHash !== "string" || !HASH_PATTERN.test(candidate.tokenHash)
    || typeof candidate.authVersion !== "string" || !HASH_PATTERN.test(candidate.authVersion)
    || typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt))
    || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.expiresAt <= Date.parse(candidate.createdAt)) {
    throw new Error("The persistent dashboard session store contains an invalid entry.");
  }
  return Object.freeze({
    authVersion: candidate.authVersion,
    principal: normalizeSessionPrincipal(candidate.principal),
    createdAt: new Date(candidate.createdAt).toISOString(),
    expiresAt: candidate.expiresAt
  });
}

function removeExpiredSessions(sessions, authVersion, timestamp) {
  return new Map([...sessions.entries()].filter(([, entry]) =>
    entry.authVersion === authVersion && entry.expiresAt > timestamp));
}

function limitSessions(sessions, maxSessions) {
  return new Map([...sessions.entries()]
    .sort((left, right) => Date.parse(right[1].createdAt) - Date.parse(left[1].createdAt))
    .slice(0, maxSessions));
}

async function persistSessions(filePath, directoryPath, sessions) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const document = JSON.stringify({
    version: STORE_VERSION,
    sessions: [...sessions.entries()].map(([tokenHash, entry]) => ({
      tokenHash,
      authVersion: entry.authVersion,
      principal: entry.principal,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt
    }))
  });
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(document, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
    if (process.platform !== "win32") {
      await chmod(filePath, 0o600);
      const directoryHandle = await open(directoryPath, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
  } catch (error) {
    const cleanupErrors = [];
    if (handle) {
      try {
        await handle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Dashboard session storage failed and temporary-file cleanup was incomplete."
      );
    }
    throw error;
  }
}

function deriveCsrfToken(token) {
  return createHash("sha256").update("cryptopulse-csrf:").update(token).digest("base64url");
}
