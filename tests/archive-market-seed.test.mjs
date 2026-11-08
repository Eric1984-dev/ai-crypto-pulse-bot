import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ArchiveSeedError,
  buildUpsertStatement,
  classifyPreflightRows,
  createClientOptions,
  readSeedConfig,
  validateMarketRow
} from "../archive-server/src/archive-market-seed.mjs";

const sourceProjectRef = "abcdefghijklmnopqrst";
const market = {
  id: "00000000-0000-4000-8000-000000000001",
  symbol: "BTC-EUR",
  enabled: true,
  priority: 1,
  created_at: "2026-11-07 12:34:56.123456+00",
  updated_at: "2026-11-07 12:34:56.654321+00"
};

function makeEnv(overrides = {}) {
  return {
    SUPABASE_ARCHIVE_READONLY_URL:
      `postgresql://archive_reader:source-password@db.${sourceProjectRef}.supabase.co:5432/postgres`,
    SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF: sourceProjectRef,
    SUPABASE_ARCHIVE_READONLY_ROLE: "archive_reader",
    SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED: "true",
    ARCHIVE_SYNC_DB_HOST: "192.168.0.121",
    ARCHIVE_SYNC_DB_PORT: "5432",
    ARCHIVE_SYNC_DB_NAME: "ai_crypto_bot_archive",
    ARCHIVE_SYNC_DB_USER: "archive_market_writer",
    ARCHIVE_SYNC_DB_PASSWORD: "target-password",
    ...overrides
  };
}

test("market row validation preserves full-precision UTC timestamp strings", () => {
  assert.equal(validateMarketRow(market), market);
  assert.throws(
    () => validateMarketRow({ ...market, symbol: "btc-eur" }),
    (error) => error instanceof ArchiveSeedError && error.safeCode === "SOURCE_ROW_INVALID"
  );
  assert.throws(
    () => validateMarketRow({ ...market, priority: 0 }),
    (error) => error instanceof ArchiveSeedError && error.safeCode === "SOURCE_ROW_INVALID"
  );
  assert.throws(
    () => validateMarketRow({ ...market, created_at: "infinity" }),
    (error) => error instanceof ArchiveSeedError && error.safeCode === "SOURCE_ROW_INVALID"
  );
});

test("configuration requires an attested, project-matched read-only source and archive target", () => {
  const config = readSeedConfig(makeEnv({ ARCHIVE_SYNC_BATCH_SIZE: "75" }));
  assert.equal(config.source.projectRef, sourceProjectRef);
  assert.equal(config.source.role, "archive_reader");
  assert.equal(config.archive.database, "ai_crypto_bot_archive");
  assert.equal(config.batchSize, 75);

  assert.throws(
    () => readSeedConfig(makeEnv({ ARCHIVE_SYNC_DB_NAME: "postgres" })),
    (error) => error.safeCode === "ARCHIVE_DATABASE_IDENTITY_MISMATCH"
  );
  assert.throws(
    () => readSeedConfig(makeEnv({
      SUPABASE_ARCHIVE_READONLY_URL:
        "postgresql://archive_reader:secret@db.wrongproject.supabase.co:5432/postgres"
    })),
    (error) => error.safeCode === "CONFIG_SUPABASE_ARCHIVE_READONLY_URL"
  );
  assert.throws(
    () => readSeedConfig(makeEnv({ SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED: "false" })),
    (error) => error.safeCode === "SOURCE_READ_SCOPE_NOT_CONFIRMED"
  );
  assert.throws(
    () => readSeedConfig(makeEnv({ ARCHIVE_SYNC_BATCH_SIZE: "501" })),
    (error) => error.safeCode === "CONFIG_ARCHIVE_SYNC_BATCH_SIZE"
  );
});

test("preflight classifies insert, update, and unchanged rows and rejects identity conflicts", () => {
  const updateSource = { ...market, id: "00000000-0000-4000-8000-000000000002" };
  const unchangedSource = { ...market, id: "00000000-0000-4000-8000-000000000003" };
  const counts = classifyPreflightRows(
    [market, updateSource, unchangedSource],
    [
      {
        source_id: market.id,
        existing_id: null,
        existing_symbol: null,
        identity_matches: null,
        values_match: null
      },
      {
        source_id: updateSource.id,
        existing_id: updateSource.id,
        existing_symbol: updateSource.symbol,
        identity_matches: true,
        values_match: false
      },
      {
        source_id: unchangedSource.id,
        existing_id: unchangedSource.id,
        existing_symbol: unchangedSource.symbol,
        identity_matches: true,
        values_match: true
      }
    ]
  );
  assert.deepEqual(counts, { inserted: 1, updated: 1, skipped: 1 });
  assert.throws(
    () => classifyPreflightRows(
      [market],
      [{
        source_id: market.id,
        existing_id: "00000000-0000-4000-8000-000000000099",
        existing_symbol: market.symbol,
        identity_matches: false,
        values_match: false
      }]
    ),
    (error) => error.safeCode === "ARCHIVE_MARKET_ID_OR_SYMBOL_CONFLICT"
  );
});

test("upsert uses explicit columns and ID conflict handling without deleting rows", () => {
  const statement = buildUpsertStatement([market]);
  assert.match(statement.text, /ON CONFLICT \("id"\) DO UPDATE/);
  assert.match(statement.text, /"created_at" = EXCLUDED\."created_at"/);
  assert.match(statement.text, /"updated_at" = EXCLUDED\."updated_at"/);
  assert.match(statement.text, /IS DISTINCT FROM/);
  assert.doesNotMatch(statement.text, /\bDELETE\b|\bTRUNCATE\b/i);
  assert.equal(statement.values.length, 6);
  assert.equal(statement.values[4], market.created_at);
  assert.equal(statement.values[5], market.updated_at);
});

test("database client options require certificate-verified TLS", () => {
  const config = readSeedConfig(makeEnv({
    ARCHIVE_SYNC_DB_SSL_SERVERNAME: "archive.internal",
    SUPABASE_ARCHIVE_SSL_SERVERNAME: `db.${sourceProjectRef}.supabase.co`
  }));
  const options = createClientOptions(config);
  assert.equal(options.source.ssl.rejectUnauthorized, true);
  assert.equal(options.source.ssl.servername, `db.${sourceProjectRef}.supabase.co`);
  assert.equal(options.archive.ssl.rejectUnauthorized, true);
  assert.equal(options.archive.ssl.servername, "archive.internal");
});
