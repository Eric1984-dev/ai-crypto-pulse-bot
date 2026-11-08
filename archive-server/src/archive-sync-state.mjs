import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00$/;

export class ArchiveStateError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArchiveStateError";
    this.safeCode = code;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    if (error?.code === "EPERM") {
      return true;
    }
    throw new ArchiveStateError("LOCK_PROCESS_CHECK_FAILED");
  }
}

function verifyPrivateDirectory(path) {
  const info = lstatSync(path);
  const insecurePosixPermissions = process.platform !== "win32"
    && ((info.mode & 0o077) !== 0
      || (typeof process.getuid === "function" && info.uid !== process.getuid()));
  if (!info.isDirectory() || info.isSymbolicLink() || insecurePosixPermissions) {
    throw new ArchiveStateError("STATE_DIRECTORY_PERMISSIONS_INVALID");
  }
}

function validateCursor(cursor) {
  return cursor === null || (
    typeof cursor === "object"
    && typeof cursor.createdAt === "string"
    && UTC_TIMESTAMP_PATTERN.test(cursor.createdAt)
    && typeof cursor.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)
  );
}

function validateCounters(counters) {
  return counters && typeof counters === "object"
    && ["inserted", "updated", "skipped", "sourceRows", "batches"]
      .every((key) => Number.isSafeInteger(counters[key]) && counters[key] >= 0);
}

function validateRun(run) {
  return run === null || (
    typeof run === "object"
    && typeof run.id === "string"
    && typeof run.cutoff === "string"
    && UTC_TIMESTAMP_PATTERN.test(run.cutoff)
    && (run.lowerBound === null
      || (typeof run.lowerBound === "string" && UTC_TIMESTAMP_PATTERN.test(run.lowerBound)))
    && Number.isSafeInteger(run.expectedSourceRows)
    && run.expectedSourceRows >= 0
    && Number.isSafeInteger(run.archiveRowCountBefore)
    && run.archiveRowCountBefore >= 0
    && validateCursor(run.cursor)
    && validateCounters(run.counters)
    && run.counters.sourceRows
      === run.counters.inserted + run.counters.updated + run.counters.skipped
    && run.counters.sourceRows <= run.expectedSourceRows
    && typeof run.startedAt === "string"
  );
}

function validateState(state, identity) {
  if (!state || typeof state !== "object"
    || state.version !== 1
    || state.table !== "AI_Crypto_Bot_AI_Decisions"
    || state.sourceProjectRef !== identity.sourceProjectRef
    || state.targetDatabase !== identity.targetDatabase
    || !validateCursor(state.watermark)
    || !validateRun(state.run)
    || (state.lastSuccessAt !== null && typeof state.lastSuccessAt !== "string")) {
    throw new ArchiveStateError("CHECKPOINT_IDENTITY_OR_FORMAT_MISMATCH");
  }
}

export function loadSyncState(path, identity) {
  try {
    const info = lstatSync(path);
    const insecurePosixPermissions = process.platform !== "win32"
      && ((info.mode & 0o077) !== 0
        || (typeof process.getuid === "function" && info.uid !== process.getuid()));
    if (!info.isFile() || info.isSymbolicLink() || insecurePosixPermissions) {
      throw new ArchiveStateError("CHECKPOINT_PERMISSIONS_INVALID");
    }
    const state = JSON.parse(readFileSync(path, "utf8"));
    validateState(state, identity);
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        version: 1,
        table: "AI_Crypto_Bot_AI_Decisions",
        sourceProjectRef: identity.sourceProjectRef,
        targetDatabase: identity.targetDatabase,
        watermark: null,
        run: null,
        lastSuccessAt: null
      };
    }
    if (error instanceof ArchiveStateError) {
      throw error;
    }
    throw new ArchiveStateError("CHECKPOINT_INVALID");
  }
}

export function saveSyncState(path, state, identity) {
  validateState(state, identity);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  verifyPrivateDirectory(directory);

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(state)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
    if (process.platform !== "win32") {
      const directoryDescriptor = openSync(directory, "r");
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  } catch {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw new ArchiveStateError("CHECKPOINT_WRITE_FAILED");
  }
}

export function acquireProcessLock(path) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  verifyPrivateDirectory(directory);

  const lockPath = `${path}.lock`;
  const token = randomUUID();
  const lock = { token, pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    let createdLock = false;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      createdLock = true;
      writeFileSync(descriptor, `${JSON.stringify(lock)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      return () => {
        let current;
        try {
          current = JSON.parse(readFileSync(lockPath, "utf8"));
        } catch {
          throw new ArchiveStateError("LOCK_RELEASE_FAILED");
        }
        if (current.token !== token || current.pid !== process.pid || current.host !== hostname()) {
          throw new ArchiveStateError("LOCK_OWNER_MISMATCH");
        }
        unlinkSync(lockPath);
      };
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
      if (createdLock && existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
      if (error?.code !== "EEXIST") {
        if (error instanceof ArchiveStateError) {
          throw error;
        }
        throw new ArchiveStateError("LOCK_ACQUIRE_FAILED");
      }
    }

    let existing;
    try {
      const info = lstatSync(lockPath);
      if (!info.isFile() || info.isSymbolicLink()
        || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) {
        throw new ArchiveStateError("LOCK_FILE_INVALID");
      }
      existing = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      throw new ArchiveStateError("LOCK_FILE_INVALID");
    }
    if (existing.host !== hostname()
      || !Number.isSafeInteger(existing.pid)
      || isProcessRunning(existing.pid)) {
      throw new ArchiveStateError("SYNC_ALREADY_RUNNING");
    }
    try {
      unlinkSync(lockPath);
    } catch {
      throw new ArchiveStateError("STALE_LOCK_CLEANUP_FAILED");
    }
  }

  throw new ArchiveStateError("SYNC_ALREADY_RUNNING");
}
