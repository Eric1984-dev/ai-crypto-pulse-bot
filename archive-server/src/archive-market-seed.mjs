import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client, types } from "pg";

const TABLE = 'public."AI_Crypto_Bot_Watched_Markets"';
const TABLE_REGCLASS = `'${TABLE}'::regclass`;
const TABLE_NAME = "AI_Crypto_Bot_Watched_Markets";
const ARCHIVE_DATABASE = "ai_crypto_bot_archive";
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYMBOL_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00$/;
const COLUMN_CONTRACT = [
  ["id", "uuid"],
  ["symbol", "text"],
  ["enabled", "boolean"],
  ["priority", "integer"],
  ["created_at", "timestamp with time zone"],
  ["updated_at", "timestamp with time zone"]
];
const REQUIRED_CONSTRAINTS = new Set([
  "p:PRIMARY KEY (id)",
  "u:UNIQUE (symbol)"
]);
const TIMESTAMP_TYPES = {
  getTypeParser(oid, format) {
    if (oid === 1184 && format === "text") {
      return (value) => value;
    }
    return types.getTypeParser(oid, format);
  }
};

export class ArchiveSeedError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArchiveSeedError";
    this.safeCode = code;
  }
}

function requiredValue(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new ArchiveSeedError(`CONFIG_${name}`);
  }
  return value.trim();
}

function readPort(value, name) {
  const port = value === undefined || value === "" ? 5432 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ArchiveSeedError(`CONFIG_${name}`);
  }
  return port;
}

function readBatchSize(value) {
  const batchSize = value === undefined || value === "" ? DEFAULT_BATCH_SIZE : Number(value);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new ArchiveSeedError("CONFIG_ARCHIVE_SYNC_BATCH_SIZE");
  }
  return batchSize;
}

export function readSeedConfig(env = process.env) {
  const sourceConnectionString = requiredValue(env, "SUPABASE_ARCHIVE_READONLY_URL");
  const sourceProjectRef = requiredValue(env, "SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF");
  const sourceRole = requiredValue(env, "SUPABASE_ARCHIVE_READONLY_ROLE");
  if (!/^[a-z0-9]+$/.test(sourceProjectRef)) {
    throw new ArchiveSeedError("CONFIG_SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF");
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(sourceConnectionString);
  } catch {
    throw new ArchiveSeedError("CONFIG_SUPABASE_ARCHIVE_READONLY_URL");
  }
  const urlRole = decodeURIComponent(sourceUrl.username);
  if (sourceUrl.protocol !== "postgres:" && sourceUrl.protocol !== "postgresql:") {
    throw new ArchiveSeedError("CONFIG_SUPABASE_ARCHIVE_READONLY_URL");
  }
  if (sourceUrl.hostname !== `db.${sourceProjectRef}.supabase.co`
    || sourceUrl.pathname !== "/postgres"
    || sourceUrl.search
    || sourceUrl.hash
    || !urlRole
    || urlRole !== sourceRole
    || !sourceUrl.password) {
    throw new ArchiveSeedError("CONFIG_SUPABASE_ARCHIVE_READONLY_URL");
  }
  if (env.SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED !== "true") {
    throw new ArchiveSeedError("SOURCE_READ_SCOPE_NOT_CONFIRMED");
  }

  const archiveDatabase = requiredValue(env, "ARCHIVE_SYNC_DB_NAME");
  if (archiveDatabase !== ARCHIVE_DATABASE) {
    throw new ArchiveSeedError("ARCHIVE_DATABASE_IDENTITY_MISMATCH");
  }

  return {
    source: {
      connectionString: sourceConnectionString,
      projectRef: sourceProjectRef,
      role: sourceRole,
      caPath: env.SUPABASE_ARCHIVE_SSL_CA?.trim() || "",
      servername: env.SUPABASE_ARCHIVE_SSL_SERVERNAME?.trim() || ""
    },
    archive: {
      host: requiredValue(env, "ARCHIVE_SYNC_DB_HOST"),
      port: readPort(env.ARCHIVE_SYNC_DB_PORT, "ARCHIVE_SYNC_DB_PORT"),
      database: archiveDatabase,
      user: requiredValue(env, "ARCHIVE_SYNC_DB_USER"),
      password: requiredValue(env, "ARCHIVE_SYNC_DB_PASSWORD"),
      caPath: env.ARCHIVE_SYNC_DB_SSL_CA?.trim() || "",
      servername: env.ARCHIVE_SYNC_DB_SSL_SERVERNAME?.trim() || ""
    },
    batchSize: readBatchSize(env.ARCHIVE_SYNC_BATCH_SIZE)
  };
}

export function validateMarketRow(row) {
  if (!row || typeof row !== "object"
    || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    || typeof row.symbol !== "string" || !SYMBOL_PATTERN.test(row.symbol)
    || typeof row.enabled !== "boolean"
    || !Number.isInteger(row.priority) || row.priority < 1
    || typeof row.created_at !== "string" || !UTC_TIMESTAMP_PATTERN.test(row.created_at)
    || !Number.isFinite(Date.parse(row.created_at))
    || typeof row.updated_at !== "string" || !UTC_TIMESTAMP_PATTERN.test(row.updated_at)
    || !Number.isFinite(Date.parse(row.updated_at))) {
    throw new ArchiveSeedError("SOURCE_ROW_INVALID");
  }
  return row;
}

function createValues(rows, firstParameter = 1) {
  const parameters = [];
  const values = rows.map((row, rowIndex) => {
    const offset = firstParameter + rowIndex * COLUMN_CONTRACT.length;
    parameters.push(
      row.id,
      row.symbol,
      row.enabled,
      row.priority,
      row.created_at,
      row.updated_at
    );
    return `($${offset}::uuid, $${offset + 1}::text, $${offset + 2}::boolean, `
      + `$${offset + 3}::integer, $${offset + 4}::timestamptz, $${offset + 5}::timestamptz)`;
  });
  return {
    sql: `(${COLUMN_CONTRACT.map(([name]) => `"${name}"`).join(", ")}) AS incoming(${COLUMN_CONTRACT.map(([name]) => `"${name}"`).join(", ")})`,
    valuesSql: values.join(", "),
    parameters
  };
}

export function classifyPreflightRows(sourceRows, preflightRows) {
  const grouped = new Map();
  for (const result of preflightRows) {
    const group = grouped.get(result.source_id) || [];
    group.push(result);
    grouped.set(result.source_id, group);
  }

  const counts = { inserted: 0, updated: 0, skipped: 0 };
  for (const source of sourceRows) {
    const matches = (grouped.get(source.id) || [])
      .filter((result) => result.existing_id !== null);
    if (matches.length === 0) {
      counts.inserted += 1;
      continue;
    }
    if (matches.length !== 1 || !matches[0].identity_matches) {
      throw new ArchiveSeedError("ARCHIVE_MARKET_ID_OR_SYMBOL_CONFLICT");
    }
    if (matches[0].values_match) {
      counts.skipped += 1;
    } else {
      counts.updated += 1;
    }
    grouped.delete(source.id);
  }
  return counts;
}

export function buildUpsertStatement(rows) {
  const { valuesSql, parameters } = createValues(rows);
  const distinct = ["symbol", "enabled", "priority", "created_at", "updated_at"]
    .map((column) => `target."${column}" IS DISTINCT FROM EXCLUDED."${column}"`)
    .join(" OR ");
  return {
    text: `INSERT INTO ${TABLE} AS target ("id", "symbol", "enabled", "priority", "created_at", "updated_at") `
      + `VALUES ${valuesSql} ON CONFLICT ("id") DO UPDATE SET `
      + `"symbol" = EXCLUDED."symbol", "enabled" = EXCLUDED."enabled", `
      + `"priority" = EXCLUDED."priority", "created_at" = EXCLUDED."created_at", `
      + `"updated_at" = EXCLUDED."updated_at" WHERE ${distinct} RETURNING "id"::text AS "id"`,
    values: parameters
  };
}

function validateColumnContract(rows) {
  const actual = rows.map((row) => [row.column_name, row.data_type, row.is_nullable]);
  const expected = COLUMN_CONTRACT.map(([name, dataType]) => [name, dataType, "NO"]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ArchiveSeedError("TABLE_COLUMN_CONTRACT_MISMATCH");
  }
}

async function verifyTableSchema(client) {
  const columns = await client.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [TABLE_NAME]
  );
  validateColumnContract(columns.rows);

  const constraints = await client.query(
    `SELECT contype, pg_catalog.pg_get_constraintdef(oid) AS definition
     FROM pg_catalog.pg_constraint
     WHERE conrelid = ${TABLE_REGCLASS} AND contype IN ('p', 'u')`
  );
  const actualConstraints = new Set(
    constraints.rows.map((row) => `${row.contype}:${row.definition}`)
  );
  if (actualConstraints.size !== REQUIRED_CONSTRAINTS.size
    || [...REQUIRED_CONSTRAINTS].some((constraint) => !actualConstraints.has(constraint))) {
    throw new ArchiveSeedError("TABLE_KEY_CONSTRAINT_MISMATCH");
  }
}

async function verifySourceAccess(client, config) {
  const result = await client.query(
    `SELECT current_database() AS database_name, current_user AS role_name,
       current_setting('transaction_read_only') AS read_only,
       role.rolsuper AS is_superuser, role.rolbypassrls AS bypasses_rls,
       role.rolcreatedb AS can_create_database, role.rolcreaterole AS can_create_role,
       pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'TRUNCATE') AS can_truncate
     FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user`
  );
  const identity = result.rows[0];
  if (!identity || identity.database_name !== "postgres" || identity.role_name !== config.source.role
    || identity.read_only !== "on" || identity.is_superuser || identity.bypasses_rls
    || identity.can_create_database || identity.can_create_role || !identity.schema_usage
    || identity.schema_create || !identity.can_select || identity.can_insert || identity.can_update
    || identity.can_delete || identity.can_truncate) {
    throw new ArchiveSeedError("SOURCE_IDENTITY_OR_PRIVILEGE_CHECK_FAILED");
  }
}

async function verifyArchiveAccess(client, config) {
  const result = await client.query(
    `SELECT current_database() AS database_name, current_user AS role_name,
       role.rolsuper AS is_superuser, role.rolbypassrls AS bypasses_rls,
       role.rolcreatedb AS can_create_database, role.rolcreaterole AS can_create_role,
       pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'TRUNCATE') AS can_truncate,
       pg_catalog.has_table_privilege(current_user, ${TABLE_REGCLASS}, 'TRIGGER') AS can_trigger,
       relation.relowner = role.oid AS owns_table
     FROM pg_catalog.pg_roles AS role
     JOIN pg_catalog.pg_class AS relation ON relation.oid = ${TABLE_REGCLASS}
     WHERE role.rolname = current_user`
  );
  const identity = result.rows[0];
  if (!identity || identity.database_name !== config.archive.database
    || identity.role_name !== config.archive.user || identity.is_superuser || identity.bypasses_rls
    || identity.can_create_database || identity.can_create_role || !identity.schema_usage
    || identity.schema_create || !identity.can_select || !identity.can_insert || !identity.can_update
    || identity.can_delete || identity.can_truncate || identity.can_trigger || identity.owns_table) {
    throw new ArchiveSeedError("ARCHIVE_IDENTITY_OR_PRIVILEGE_CHECK_FAILED");
  }
}

async function verifyNoTargetTriggers(client) {
  const result = await client.query(
    `SELECT count(*)::text AS trigger_count
     FROM pg_catalog.pg_trigger
     WHERE tgrelid = ${TABLE_REGCLASS} AND NOT tgisinternal`
  );
  if (result.rows[0]?.trigger_count !== "0") {
    throw new ArchiveSeedError("ARCHIVE_TARGET_TRIGGER_PRESENT");
  }
}

async function countRows(client) {
  const result = await client.query(`SELECT count(*)::text AS row_count FROM ${TABLE}`);
  const count = Number(result.rows[0]?.row_count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ArchiveSeedError("ROW_COUNT_INVALID");
  }
  return count;
}

async function readSourceBatch(client, cursor, batchSize) {
  const query = cursor === null
    ? `SELECT id::text AS id, symbol, enabled, priority,
         created_at::text AS created_at, updated_at::text AS updated_at
       FROM ${TABLE} ORDER BY id LIMIT $1`
    : `SELECT id::text AS id, symbol, enabled, priority,
         created_at::text AS created_at, updated_at::text AS updated_at
       FROM ${TABLE} WHERE id > $1::uuid ORDER BY id LIMIT $2`;
  const result = cursor === null
    ? await client.query(query, [batchSize])
    : await client.query(query, [cursor, batchSize]);
  return result.rows;
}

async function preflightBatch(client, rows) {
  const { valuesSql, parameters } = createValues(rows);
  const result = await client.query(
    `WITH incoming ("id", "symbol", "enabled", "priority", "created_at", "updated_at") AS (
       VALUES ${valuesSql}
     )
     SELECT incoming."id"::text AS source_id, target."id"::text AS existing_id,
       target."symbol" AS existing_symbol,
       (target."id" = incoming."id" AND target."symbol" = incoming."symbol") AS identity_matches,
       (target."enabled" IS NOT DISTINCT FROM incoming."enabled"
         AND target."priority" IS NOT DISTINCT FROM incoming."priority"
         AND target."created_at" IS NOT DISTINCT FROM incoming."created_at"
         AND target."updated_at" IS NOT DISTINCT FROM incoming."updated_at") AS values_match
     FROM incoming
     LEFT JOIN ${TABLE} AS target
       ON target."id" = incoming."id" OR target."symbol" = incoming."symbol"
     ORDER BY incoming."id", target."id"`,
    parameters
  );
  return result.rows;
}

async function validateBatch(client, rows) {
  const { valuesSql, parameters } = createValues(rows);
  const result = await client.query(
    `WITH incoming ("id", "symbol", "enabled", "priority", "created_at", "updated_at") AS (
       VALUES ${valuesSql}
     )
     SELECT count(*)::text AS mismatch_count
     FROM incoming
     LEFT JOIN ${TABLE} AS target ON target."id" = incoming."id"
     WHERE target."id" IS NULL
       OR target."symbol" IS DISTINCT FROM incoming."symbol"
       OR target."enabled" IS DISTINCT FROM incoming."enabled"
       OR target."priority" IS DISTINCT FROM incoming."priority"
       OR target."created_at" IS DISTINCT FROM incoming."created_at"
       OR target."updated_at" IS DISTINCT FROM incoming."updated_at"`,
    parameters
  );
  if (result.rows[0]?.mismatch_count !== "0") {
    throw new ArchiveSeedError("POST_COPY_ROW_VALIDATION_FAILED");
  }
}

function requireSafeSqlState(error) {
  if (error instanceof ArchiveSeedError) {
    return error.safeCode;
  }
  return typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
    ? `POSTGRES_${error.code}`
    : "DATABASE_OPERATION_FAILED";
}

export async function copyWatchedMarkets({ sourceClient, archiveClient, config }) {
  let sourceTransaction = false;
  let archiveTransaction = false;
  try {
    await sourceClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    sourceTransaction = true;
    await sourceClient.query("SET LOCAL TIME ZONE 'UTC'");
    await verifySourceAccess(sourceClient, config);
    await verifyTableSchema(sourceClient);

    await archiveClient.query("BEGIN");
    archiveTransaction = true;
    await archiveClient.query(`LOCK TABLE ${TABLE} IN SHARE ROW EXCLUSIVE MODE`);
    await archiveClient.query("SET LOCAL TIME ZONE 'UTC'");
    await verifyArchiveAccess(archiveClient, config);
    await verifyTableSchema(archiveClient);
    await verifyNoTargetTriggers(archiveClient);

    const sourceCountResult = await sourceClient.query(
      `SELECT count(*)::text AS row_count FROM ${TABLE}`
    );
    const expectedSourceRows = Number(sourceCountResult.rows[0]?.row_count);
    if (!Number.isSafeInteger(expectedSourceRows) || expectedSourceRows < 1) {
      throw new ArchiveSeedError("SOURCE_TABLE_EMPTY_OR_COUNT_INVALID");
    }

    const archiveRowCountBefore = await countRows(archiveClient);
    const counts = { inserted: 0, updated: 0, skipped: 0 };
    const sourceIds = new Set();
    const sourceSymbols = new Set();
    let sourceRowCount = 0;
    let batchCount = 0;
    let cursor = null;

    while (true) {
      const rows = await readSourceBatch(sourceClient, cursor, config.batchSize);
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        validateMarketRow(row);
        if (sourceIds.has(row.id) || sourceSymbols.has(row.symbol)) {
          throw new ArchiveSeedError("SOURCE_DUPLICATE_ID_OR_SYMBOL");
        }
        sourceIds.add(row.id);
        sourceSymbols.add(row.symbol);
      }

      const batchCounts = classifyPreflightRows(rows, await preflightBatch(archiveClient, rows));
      const upsert = buildUpsertStatement(rows);
      const upsertResult = await archiveClient.query(upsert.text, upsert.values);
      if (upsertResult.rowCount !== batchCounts.inserted + batchCounts.updated) {
        throw new ArchiveSeedError("UPSERT_COUNT_MISMATCH");
      }
      await validateBatch(archiveClient, rows);

      counts.inserted += batchCounts.inserted;
      counts.updated += batchCounts.updated;
      counts.skipped += batchCounts.skipped;
      sourceRowCount += rows.length;
      batchCount += 1;
      cursor = rows.at(-1).id;
    }

    if (sourceRowCount !== expectedSourceRows
      || counts.inserted + counts.updated + counts.skipped !== sourceRowCount) {
      throw new ArchiveSeedError("SOURCE_COUNT_RECONCILIATION_FAILED");
    }

    const archiveRowCountAfter = await countRows(archiveClient);
    if (archiveRowCountAfter !== archiveRowCountBefore + counts.inserted) {
      throw new ArchiveSeedError("ARCHIVE_COUNT_RECONCILIATION_FAILED");
    }

    await archiveClient.query("COMMIT");
    archiveTransaction = false;
    await sourceClient.query("COMMIT");
    sourceTransaction = false;
    return {
      sourceProjectRef: config.source.projectRef,
      sourceDatabase: "postgres",
      targetDatabase: ARCHIVE_DATABASE,
      table: TABLE_NAME,
      sourceRowCount,
      archiveRowCountBefore,
      archiveRowCountAfter,
      insertedRows: counts.inserted,
      updatedRows: counts.updated,
      skippedRows: counts.skipped,
      batchCount,
      sourceReadOnly: true
    };
  } catch (error) {
    let rollbackFailed = false;
    if (archiveTransaction) {
      try {
        await archiveClient.query("ROLLBACK");
      } catch {
        rollbackFailed = true;
      }
    }
    if (sourceTransaction) {
      try {
        await sourceClient.query("ROLLBACK");
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      throw new ArchiveSeedError("ROLLBACK_FAILED");
    }
    throw error;
  }
}

function readCa(caPath) {
  if (!caPath) {
    return undefined;
  }
  try {
    return readFileSync(caPath, "utf8");
  } catch {
    throw new ArchiveSeedError("TLS_CA_FILE_UNAVAILABLE");
  }
}

function createTlsOptions(caPath, servername) {
  return {
    rejectUnauthorized: true,
    ...(caPath ? { ca: readCa(caPath) } : {}),
    ...(servername ? { servername } : {})
  };
}

export function createClientOptions(config) {
  return {
    source: {
      connectionString: config.source.connectionString,
      ssl: createTlsOptions(config.source.caPath, config.source.servername),
      application_name: "cryptopulse_archive_market_seed",
      connectionTimeoutMillis: 5000,
      query_timeout: 30000,
      statement_timeout: 25000,
      types: TIMESTAMP_TYPES
    },
    archive: {
      host: config.archive.host,
      port: config.archive.port,
      database: config.archive.database,
      user: config.archive.user,
      password: config.archive.password,
      ssl: createTlsOptions(config.archive.caPath, config.archive.servername),
      application_name: "cryptopulse_archive_market_seed",
      connectionTimeoutMillis: 5000,
      query_timeout: 30000,
      statement_timeout: 25000,
      types: TIMESTAMP_TYPES
    }
  };
}

async function run() {
  const config = readSeedConfig();
  const options = createClientOptions(config);
  const sourceClient = new Client(options.source);
  const archiveClient = new Client(options.archive);
  let result;
  let failure;
  try {
    await sourceClient.connect();
    await archiveClient.connect();
    result = await copyWatchedMarkets({ sourceClient, archiveClient, config });
  } catch (error) {
    failure = error;
  }

  const closeResults = await Promise.allSettled([
    sourceClient.end(),
    archiveClient.end()
  ]);
  if (closeResults.some((closeResult) => closeResult.status === "rejected")) {
    failure = new ArchiveSeedError("DATABASE_CONNECTION_CLOSE_FAILED");
  }
  if (failure) {
    throw failure;
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run()
    .then((result) => {
      console.info(JSON.stringify({ event: "archive_market_seed_completed", ...result }));
    })
    .catch((error) => {
      console.error(`Archive market seed failed: ${requireSafeSqlState(error)}`);
      process.exitCode = 1;
    });
}
