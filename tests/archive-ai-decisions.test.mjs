import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArchiveDecisionSyncError,
  buildDecisionUpsert,
  classifyExistingRows,
  createDecisionClientOptions,
  readDecisionSyncConfig,
  validateDecisionRow,
  validateSourceRelationGrants,
  verifyDecisionSchema
} from "../archive-server/src/archive-ai-decisions.mjs";
import {
  ArchiveStateError,
  loadSyncState,
  saveSyncState
} from "../archive-server/src/archive-sync-state.mjs";

const sourceProjectRef = "abcdefghijklmnopqrst";
const decision = {
  id: "00000000-0000-4000-8000-000000000001",
  symbol: "BTC-EUR",
  decision: "BUY",
  confidence: "67.00",
  indicators: '{"large":"12345678901234567890.123456789","small":0.00000000000000000001}',
  reason: "Validated decision",
  strategy_name: "Momentum",
  strategy_version: "1.2.0",
  created_at: "2026-11-07 12:34:56.123456+00"
};

function makeEnv(overrides = {}) {
  return {
    SUPABASE_ARCHIVE_READONLY_URL:
      `postgresql://archive_reader:source-password@db.${sourceProjectRef}.supabase.co:5432/postgres`,
    SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF: sourceProjectRef,
    SUPABASE_ARCHIVE_READONLY_ROLE: "archive_reader",
    SUPABASE_ARCHIVE_DECISION_READ_SCOPE_CONFIRMED: "true",
    ARCHIVE_SYNC_DB_HOST: "192.168.0.121",
    ARCHIVE_SYNC_DB_PORT: "5432",
    ARCHIVE_SYNC_DB_NAME: "ai_crypto_bot_archive",
    ARCHIVE_SYNC_DB_USER: "archive_decision_writer",
    ARCHIVE_SYNC_DB_PASSWORD: "target-password",
    ARCHIVE_SYNC_STATE_PATH: "/var/lib/cryptopulse/archive-sync/ai-decisions.json",
    ...overrides
  };
}

function makeSourceGrant(relname, overrides = {}) {
  return {
    schema_name: "public",
    relname,
    can_select: true,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    owns: false,
    ...overrides
  };
}

async function createDecisionSchema(onDeleteAction = "RESTRICT") {
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."AI_Crypto_Bot_Watched_Markets" (
      symbol text PRIMARY KEY
    );
    CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
      id uuid PRIMARY KEY,
      symbol text NOT NULL REFERENCES "AI_Crypto_Bot_Watched_Markets"(symbol)
        ON DELETE ${onDeleteAction},
      decision text NOT NULL,
      confidence numeric(5, 2) NOT NULL,
      indicators jsonb NOT NULL,
      reason text NOT NULL,
      strategy_name text,
      strategy_version text,
      created_at timestamp with time zone NOT NULL
    );
  `);
  return database;
}

test("decision validation retains confidence, JSONB, UUID, and timestamp strings", () => {
  assert.equal(validateDecisionRow(decision), decision);
  assert.equal(decision.confidence, "67.00");
  assert.match(decision.indicators, /12345678901234567890\.123456789/);
  assert.equal(decision.created_at, "2026-11-07 12:34:56.123456+00");
});

test("source scope allows read-only SELECT on multiple prefixed application tables", () => {
  assert.doesNotThrow(() => validateSourceRelationGrants([
    makeSourceGrant("AI_Crypto_Bot_AI_Decisions"),
    makeSourceGrant("AI_Crypto_Bot_Candles"),
    makeSourceGrant("AI_Crypto_Bot_Watched_Markets")
  ]));
});

test("source scope ignores all relations in the extensions schema", () => {
  assert.doesNotThrow(() => validateSourceRelationGrants([
    makeSourceGrant("AI_Crypto_Bot_AI_Decisions"),
    makeSourceGrant("pg_stat_statements", {
      schema_name: "extensions",
      can_insert: true,
      can_update: true,
      can_delete: true,
      can_truncate: true,
      owns: true
    }),
    makeSourceGrant("pg_statements_info", { schema_name: "extensions" })
  ]));
});

test("source scope rejects non-prefixed relations, other schemas, and missing decision access", () => {
  for (const grants of [
    [
      makeSourceGrant("AI_Crypto_Bot_AI_Decisions"),
      makeSourceGrant("users")
    ],
    [
      makeSourceGrant("AI_Crypto_Bot_AI_Decisions"),
      makeSourceGrant("AI_Crypto_Bot_Candles", { schema_name: "archive" })
    ],
    [makeSourceGrant("AI_Crypto_Bot_Candles")]
  ]) {
    assert.throws(
      () => validateSourceRelationGrants(grants),
      (error) => error instanceof ArchiveDecisionSyncError
        && error.safeCode === "SOURCE_READ_SCOPE_TOO_BROAD"
    );
  }
});

test("source scope rejects table and column-level write privileges and ownership", () => {
  for (const overrides of [
    { can_insert: true },
    { can_update: true },
    { can_delete: true },
    { can_truncate: true },
    { owns: true }
  ]) {
    assert.throws(
      () => validateSourceRelationGrants([
        makeSourceGrant("AI_Crypto_Bot_AI_Decisions"),
        makeSourceGrant("AI_Crypto_Bot_Candles", overrides)
      ]),
      (error) => error instanceof ArchiveDecisionSyncError
        && error.safeCode === "SOURCE_READ_SCOPE_TOO_BROAD"
    );
  }
});

test("source scope diagnostics log all grant fields before rejecting", () => {
  const logged = [];
  const originalError = console.error;
  console.error = (entry) => logged.push(entry);
  try {
    assert.throws(
      () => validateSourceRelationGrants([
        makeSourceGrant("AI_Crypto_Bot_AI_Decisions"),
        makeSourceGrant("AI_Crypto_Bot_Candles", { can_update: true })
      ]),
      (error) => error instanceof ArchiveDecisionSyncError
        && error.safeCode === "SOURCE_READ_SCOPE_TOO_BROAD"
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(logged.length, 1);
  assert.deepEqual(JSON.parse(logged[0]), {
    event: "archive_source_scope_rejected_diagnostic",
    decision_table_select_found: true,
    grants: [
      {
        schema_name: "public",
        relname: "AI_Crypto_Bot_AI_Decisions",
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        owns: false,
        offending: false
      },
      {
        schema_name: "public",
        relname: "AI_Crypto_Bot_Candles",
        can_select: true,
        can_insert: false,
        can_update: true,
        can_delete: false,
        can_truncate: false,
        owns: false,
        offending: true
      }
    ]
  });
});

test("decision validation rejects malformed values and mismatched strategy snapshots", () => {
  for (const invalid of [
    { ...decision, decision: "WAITING" },
    { ...decision, confidence: "100.01" },
    { ...decision, indicators: "[]" },
    { ...decision, indicators: '{"broken":' },
    { ...decision, strategy_version: null },
    { ...decision, created_at: "not-a-timestamp" }
  ]) {
    assert.throws(
      () => validateDecisionRow(invalid),
      (error) => error instanceof ArchiveDecisionSyncError
        && error.safeCode === "SOURCE_ROW_INVALID"
    );
  }
});

test("archive schema validation accepts an unqualified watched-market foreign key", async () => {
  const database = await createDecisionSchema();
  try {
    const result = await database.query(`
      SELECT pg_catalog.pg_get_constraintdef(oid) AS definition
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
        AND contype = 'f'
    `);
    assert.match(
      result.rows[0].definition,
      /REFERENCES "AI_Crypto_Bot_Watched_Markets"\(symbol\) ON DELETE RESTRICT/
    );
    await verifyDecisionSchema(database);
  } finally {
    await database.close();
  }
});

test("archive schema validation rejects a mismatched foreign-key delete action", async () => {
  const database = await createDecisionSchema("CASCADE");
  try {
    await assert.rejects(
      verifyDecisionSchema(database),
      (error) => error instanceof ArchiveDecisionSyncError
        && error.safeCode === "TABLE_KEY_CONSTRAINT_MISMATCH"
    );
  } finally {
    await database.close();
  }
});

test("configuration requires the direct project-matched read-only role and bounded options", () => {
  const config = readDecisionSyncConfig(makeEnv({
    ARCHIVE_SYNC_BATCH_SIZE: "75",
    ARCHIVE_SYNC_OVERLAP_SECONDS: "3600"
  }));
  assert.equal(config.source.projectRef, sourceProjectRef);
  assert.equal(config.source.role, "archive_reader");
  assert.equal(config.archive.database, "ai_crypto_bot_archive");
  assert.equal(config.batchSize, 75);
  assert.equal(config.overlapSeconds, 3600);

  assert.throws(
    () => readDecisionSyncConfig(makeEnv({ ARCHIVE_SYNC_DB_NAME: "postgres" })),
    (error) => error.safeCode === "ARCHIVE_DATABASE_IDENTITY_MISMATCH"
  );
  assert.throws(
    () => readDecisionSyncConfig(makeEnv({
      SUPABASE_ARCHIVE_READONLY_URL:
        `postgresql://service_role:secret@db.${sourceProjectRef}.supabase.co:5432/postgres`,
      SUPABASE_ARCHIVE_READONLY_ROLE: "service_role"
    })),
    (error) => error.safeCode === "CONFIG_SUPABASE_ARCHIVE_READONLY_URL"
  );
  assert.throws(
    () => readDecisionSyncConfig(makeEnv({
      SUPABASE_ARCHIVE_DECISION_READ_SCOPE_CONFIRMED: "false"
    })),
    (error) => error.safeCode === "SOURCE_READ_SCOPE_NOT_CONFIRMED"
  );
  assert.throws(
    () => readDecisionSyncConfig(makeEnv({ ARCHIVE_SYNC_BATCH_SIZE: "0" })),
    (error) => error.safeCode === "CONFIG_ARCHIVE_SYNC_BATCH_SIZE"
  );
  assert.throws(
    () => readDecisionSyncConfig(makeEnv({ ARCHIVE_SYNC_STATE_PATH: "relative/state.json" })),
    (error) => error.safeCode === "CONFIG_ARCHIVE_SYNC_STATE_PATH"
  );
});

test("decision upsert uses explicit fields, original ID, and no delete path", () => {
  const statement = buildDecisionUpsert([decision]);
  assert.match(statement.text, /ON CONFLICT \("id"\) DO UPDATE/);
  assert.match(statement.text, /"confidence" = EXCLUDED\."confidence"/);
  assert.match(statement.text, /"indicators" = EXCLUDED\."indicators"/);
  assert.match(statement.text, /"created_at" = EXCLUDED\."created_at"/);
  assert.match(statement.text, /IS DISTINCT FROM/);
  assert.doesNotMatch(statement.text, /\bDELETE\b|\bTRUNCATE\b/i);
  assert.equal(statement.values.length, 9);
  assert.equal(statement.values[0], decision.id);
  assert.equal(statement.values[3], "67.00");
  assert.equal(statement.values[4], decision.indicators);
  assert.equal(statement.values[8], decision.created_at);
});

test("target preflight counts inserts, updates, and exact skips", () => {
  const updated = { ...decision, id: "00000000-0000-4000-8000-000000000002" };
  const unchanged = { ...decision, id: "00000000-0000-4000-8000-000000000003" };
  const counts = classifyExistingRows(
    [decision, updated, unchanged],
    [
      { ...updated, reason: "Old reason" },
      unchanged
    ]
  );
  assert.deepEqual(counts, { inserted: 1, updated: 1, skipped: 1 });
});

test("PostgreSQL connections always verify TLS and keep source credentials separate", () => {
  const options = createDecisionClientOptions(readDecisionSyncConfig(makeEnv()));
  assert.equal(options.source.ssl.rejectUnauthorized, true);
  assert.equal(options.archive.ssl.rejectUnauthorized, true);
  assert.equal(options.source.application_name, "cryptopulse_archive_ai_decisions");
  assert.equal(options.archive.password, "target-password");
});

test("checkpoint writes are atomic, private, and bound to source and target identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "cryptopulse-archive-state-"));
  const stateDirectory = join(directory, "state");
  const path = join(stateDirectory, "ai-decisions.json");
  const identity = {
    sourceProjectRef,
    targetDatabase: "ai_crypto_bot_archive"
  };
  try {
    const state = {
      version: 1,
      table: "AI_Crypto_Bot_AI_Decisions",
      sourceProjectRef,
      targetDatabase: "ai_crypto_bot_archive",
      watermark: null,
      run: {
        id: "run-1",
        cutoff: "2026-11-07 12:34:56.123456+00",
        lowerBound: null,
        expectedSourceRows: 1,
        archiveRowCountBefore: 0,
        cursor: null,
        counters: { inserted: 0, updated: 0, skipped: 0, sourceRows: 0, batches: 0 },
        startedAt: "2026-11-07T12:34:56.000Z"
      },
      lastSuccessAt: null
    };
    saveSyncState(path, state, identity);
    assert.deepEqual(loadSyncState(path, identity), state);
    assert.throws(
      () => loadSyncState(path, { ...identity, sourceProjectRef: "anotherproject" }),
      (error) => error instanceof ArchiveStateError
        && error.safeCode === "CHECKPOINT_IDENTITY_OR_FORMAT_MISMATCH"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
