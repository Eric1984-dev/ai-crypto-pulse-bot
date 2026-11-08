import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  acquireProcessLock,
  ArchiveStateError,
  loadSyncState,
  saveSyncState
} from "./archive-sync-state.mjs";

const TABLE = 'public."AI_Crypto_Bot_AI_Decisions"';
const TABLE_NAME = "AI_Crypto_Bot_AI_Decisions";
const MARKET_TABLE = 'public."AI_Crypto_Bot_Watched_Markets"';
const ARCHIVE_DATABASE = "ai_crypto_bot_archive";
const SOURCE_RELATION_PREFIX = "AI_Crypto_Bot_";
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 500;
const DEFAULT_OVERLAP_SECONDS = 86400;
const MAX_OVERLAP_SECONDS = 2592000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYMBOL_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00$/;
const CONFIDENCE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const COLUMNS = [
  ["id", "uuid", "NO"],
  ["symbol", "text", "NO"],
  ["decision", "text", "NO"],
  ["confidence", "numeric", "NO", 5, 2],
  ["indicators", "jsonb", "NO"],
  ["reason", "text", "NO"],
  ["strategy_name", "text", "YES"],
  ["strategy_version", "text", "YES"],
  ["created_at", "timestamp with time zone", "NO", undefined, undefined, 6]
];
const VALUE_FIELDS = [
  "symbol",
  "decision",
  "confidence",
  "indicators",
  "reason",
  "strategy_name",
  "strategy_version",
  "created_at"
];

export class ArchiveDecisionSyncError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArchiveDecisionSyncError";
    this.safeCode = code;
  }
}

function requiredValue(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new ArchiveDecisionSyncError(`CONFIG_${name}`);
  }
  return value.trim();
}

function readPort(value, name) {
  const port = value === undefined || value === "" ? 5432 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ArchiveDecisionSyncError(`CONFIG_${name}`);
  }
  return port;
}

function readBoundedInteger(value, name, fallback, maximum) {
  const number = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    throw new ArchiveDecisionSyncError(`CONFIG_${name}`);
  }
  return number;
}

export function readDecisionSyncConfig(env = process.env) {
  const sourceConnectionString = requiredValue(env, "SUPABASE_ARCHIVE_READONLY_URL");
  const sourceProjectRef = requiredValue(env, "SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF");
  const sourceRole = requiredValue(env, "SUPABASE_ARCHIVE_READONLY_ROLE");
  if (!/^[a-z0-9]+$/.test(sourceProjectRef)) {
    throw new ArchiveDecisionSyncError("CONFIG_SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF");
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(sourceConnectionString);
  } catch {
    throw new ArchiveDecisionSyncError("CONFIG_SUPABASE_ARCHIVE_READONLY_URL");
  }
  let urlRole;
  try {
    urlRole = decodeURIComponent(sourceUrl.username);
  } catch {
    throw new ArchiveDecisionSyncError("CONFIG_SUPABASE_ARCHIVE_READONLY_URL");
  }
  if (!["postgres:", "postgresql:"].includes(sourceUrl.protocol)
    || sourceUrl.hostname !== `db.${sourceProjectRef}.supabase.co`
    || sourceUrl.pathname !== "/postgres"
    || sourceUrl.search
    || sourceUrl.hash
    || !urlRole
    || urlRole !== sourceRole
    || !sourceUrl.password
    || sourceRole === "service_role") {
    throw new ArchiveDecisionSyncError("CONFIG_SUPABASE_ARCHIVE_READONLY_URL");
  }
  if (env.SUPABASE_ARCHIVE_DECISION_READ_SCOPE_CONFIRMED !== "true") {
    throw new ArchiveDecisionSyncError("SOURCE_READ_SCOPE_NOT_CONFIRMED");
  }

  const statePath = requiredValue(env, "ARCHIVE_SYNC_STATE_PATH");
  if (!isAbsolute(statePath)) {
    throw new ArchiveDecisionSyncError("CONFIG_ARCHIVE_SYNC_STATE_PATH");
  }
  const database = requiredValue(env, "ARCHIVE_SYNC_DB_NAME");
  if (database !== ARCHIVE_DATABASE) {
    throw new ArchiveDecisionSyncError("ARCHIVE_DATABASE_IDENTITY_MISMATCH");
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
      database,
      user: requiredValue(env, "ARCHIVE_SYNC_DB_USER"),
      password: requiredValue(env, "ARCHIVE_SYNC_DB_PASSWORD"),
      caPath: env.ARCHIVE_SYNC_DB_SSL_CA?.trim() || "",
      servername: env.ARCHIVE_SYNC_DB_SSL_SERVERNAME?.trim() || ""
    },
    statePath,
    batchSize: readBatchSize(env.ARCHIVE_SYNC_BATCH_SIZE),
    overlapSeconds: readBoundedInteger(
      env.ARCHIVE_SYNC_OVERLAP_SECONDS,
      "ARCHIVE_SYNC_OVERLAP_SECONDS",
      DEFAULT_OVERLAP_SECONDS,
      MAX_OVERLAP_SECONDS
    )
  };
}

function readBatchSize(value) {
  const batchSize = value === undefined || value === ""
    ? DEFAULT_BATCH_SIZE
    : Number(value);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new ArchiveDecisionSyncError("CONFIG_ARCHIVE_SYNC_BATCH_SIZE");
  }
  return batchSize;
}

function readCa(path) {
  if (!path) {
    return undefined;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new ArchiveDecisionSyncError("TLS_CA_FILE_UNAVAILABLE");
  }
}

function tlsOptions(caPath, servername) {
  return {
    rejectUnauthorized: true,
    ...(caPath ? { ca: readCa(caPath) } : {}),
    ...(servername ? { servername } : {})
  };
}

export function createDecisionClientOptions(config) {
  const common = {
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
    statement_timeout: 55000,
    application_name: "cryptopulse_archive_ai_decisions"
  };
  return {
    source: {
      ...common,
      connectionString: config.source.connectionString,
      ssl: tlsOptions(config.source.caPath, config.source.servername)
    },
    archive: {
      ...common,
      host: config.archive.host,
      port: config.archive.port,
      database: config.archive.database,
      user: config.archive.user,
      password: config.archive.password,
      ssl: tlsOptions(config.archive.caPath, config.archive.servername)
    }
  };
}

export function validateDecisionRow(row) {
  if (!row || typeof row !== "object"
    || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    || typeof row.symbol !== "string" || !SYMBOL_PATTERN.test(row.symbol)
    || !["BUY", "SELL", "HOLD", "WAIT"].includes(row.decision)
    || typeof row.confidence !== "string" || !CONFIDENCE_PATTERN.test(row.confidence)
    || Number(row.confidence) < 0 || Number(row.confidence) > 100
    || typeof row.indicators !== "string" || !row.indicators.trim().startsWith("{")
    || typeof row.reason !== "string" || row.reason.trim() === ""
    || (row.strategy_name !== null && typeof row.strategy_name !== "string")
    || (row.strategy_version !== null && typeof row.strategy_version !== "string")
    || ((row.strategy_name === null) !== (row.strategy_version === null))
    || typeof row.created_at !== "string"
    || !UTC_TIMESTAMP_PATTERN.test(row.created_at)
    || !Number.isFinite(Date.parse(row.created_at))) {
    throw new ArchiveDecisionSyncError("SOURCE_ROW_INVALID");
  }

  let indicators;
  try {
    indicators = JSON.parse(row.indicators);
  } catch {
    throw new ArchiveDecisionSyncError("SOURCE_ROW_INVALID");
  }
  if (!indicators || typeof indicators !== "object" || Array.isArray(indicators)) {
    throw new ArchiveDecisionSyncError("SOURCE_ROW_INVALID");
  }
  return row;
}

function validateColumnContract(rows) {
  const actual = rows.map((row) => [
    row.column_name,
    row.data_type,
    row.is_nullable,
    row.numeric_precision === null ? null : Number(row.numeric_precision),
    row.numeric_scale === null ? null : Number(row.numeric_scale),
    row.datetime_precision === null ? null : Number(row.datetime_precision)
  ]);
  const expected = COLUMNS.map(([name, dataType, nullable, precision, scale, datePrecision]) => [
    name,
    dataType,
    nullable,
    precision ?? null,
    scale ?? null,
    datePrecision ?? null
  ]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ArchiveDecisionSyncError("TABLE_COLUMN_CONTRACT_MISMATCH");
  }
}

export async function verifyDecisionSchema(client) {
  const columns = await client.query(
    `SELECT column_name, data_type, is_nullable, numeric_precision,
       numeric_scale, datetime_precision
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [TABLE_NAME]
  );
  validateColumnContract(columns.rows);

  const constraints = await client.query(
    `SELECT constraint_row.contype, constraint_row.convalidated,
       ARRAY(
         SELECT attribute.attname::text
         FROM unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, ordinal)
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = constraint_row.conrelid
          AND attribute.attnum = source_key.attnum
         ORDER BY source_key.ordinal
       ) AS columns,
       ARRAY(
         SELECT attribute.attname::text
         FROM unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, ordinal)
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = constraint_row.confrelid
          AND attribute.attnum = target_key.attnum
         ORDER BY target_key.ordinal
       ) AS referenced_columns,
       constraint_row.confrelid = '${MARKET_TABLE}'::regclass AS references_market_table,
       constraint_row.confdeltype
     FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = '${TABLE}'::regclass
       AND constraint_row.contype IN ('p', 'f')`
  );
  const primaryKey = constraints.rows.filter((row) => row.contype === "p");
  const foreignKeys = constraints.rows.filter((row) => row.contype === "f");
  if (primaryKey.length !== 1
    || primaryKey[0].convalidated !== true
    || JSON.stringify(primaryKey[0].columns) !== JSON.stringify(["id"])
    || foreignKeys.length !== 1
    || foreignKeys[0].convalidated !== true
    || JSON.stringify(foreignKeys[0].columns) !== JSON.stringify(["symbol"])
    || !foreignKeys[0].references_market_table
    || JSON.stringify(foreignKeys[0].referenced_columns) !== JSON.stringify(["symbol"])
    || foreignKeys[0].confdeltype !== "r") {
    throw new ArchiveDecisionSyncError("TABLE_KEY_CONSTRAINT_MISMATCH");
  }
}

function normalizePolicyExpression(expression) {
  return typeof expression === "string"
    ? expression.replace(/[()]/g, "").trim().toLowerCase()
    : "";
}

function isAllowedSourceRelationGrant(grant) {
  return Boolean(grant)
    && grant.schema_name === "public"
    && typeof grant.relname === "string"
    && grant.relname.startsWith(SOURCE_RELATION_PREFIX)
    && grant.can_select === true
    && grant.can_insert === false
    && grant.can_update === false
    && grant.can_delete === false
    && grant.can_truncate === false
    && grant.owns === false;
}

export function validateSourceRelationGrants(grants) {
  const applicationGrants = Array.isArray(grants)
    ? grants.filter((grant) => grant?.schema_name !== "extensions")
    : [];
  const canReadDecisionTable = Array.isArray(grants)
    && applicationGrants.some((grant) => grant
      && grant.schema_name === "public"
      && grant.relname === TABLE_NAME
      && grant.can_select === true);
  const hasUnsafeGrant = !Array.isArray(grants)
    || applicationGrants.some((grant) => !isAllowedSourceRelationGrant(grant));

  if (!canReadDecisionTable || hasUnsafeGrant) {
    const diagnosticGrants = applicationGrants
      .map((grant) => ({
        schema_name: grant?.schema_name ?? null,
        relname: grant?.relname ?? null,
        can_select: grant?.can_select ?? null,
        can_insert: grant?.can_insert ?? null,
        can_update: grant?.can_update ?? null,
        can_delete: grant?.can_delete ?? null,
        can_truncate: grant?.can_truncate ?? null,
        owns: grant?.owns ?? null,
        offending: !isAllowedSourceRelationGrant(grant)
      }));
    console.error(JSON.stringify({
      event: "archive_source_scope_rejected_diagnostic",
      decision_table_select_found: canReadDecisionTable,
      grants: diagnosticGrants
    }));
    throw new ArchiveDecisionSyncError("SOURCE_READ_SCOPE_TOO_BROAD");
  }
}

async function verifySourceAccess(client, config) {
  const identityResult = await client.query(
    `SELECT current_database() AS database_name, current_user AS role_name,
       current_setting('transaction_read_only') AS read_only,
       role.rolsuper AS is_superuser, role.rolbypassrls AS bypasses_rls,
       role.rolcreatedb AS can_create_database, role.rolcreaterole AS can_create_role,
       role.rolreplication AS can_replicate,
       pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
       (SELECT count(*)::text
        FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND left(namespace.nspname, 3) <> 'pg_'
          AND pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE')
       ) AS writable_schemas,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'DELETE') AS can_delete,
       relation.relrowsecurity AS rls_enabled,
       relation.relowner = role.oid AS owns_decision_table
     FROM pg_catalog.pg_roles AS role
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid = '${TABLE}'::regclass
     WHERE role.rolname = current_user`
  );
  const identity = identityResult.rows[0];
  if (!identity || identity.database_name !== "postgres"
    || identity.role_name !== config.source.role
    || identity.read_only !== "on"
    || identity.is_superuser || identity.bypasses_rls
    || identity.can_create_database || identity.can_create_role || identity.can_replicate
    || !identity.schema_usage || identity.schema_create
    || identity.writable_schemas !== "0"
    || !identity.can_select || identity.can_insert || identity.can_update || identity.can_delete
    || !identity.rls_enabled || identity.owns_decision_table) {
    throw new ArchiveDecisionSyncError("SOURCE_IDENTITY_OR_PRIVILEGE_CHECK_FAILED");
  }

  const grants = await client.query(
    `SELECT namespace.nspname AS schema_name, relation.relname,
       (pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT')
         OR pg_catalog.has_any_column_privilege(current_user, relation.oid, 'SELECT')) AS can_select,
       (pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT')
         OR pg_catalog.has_any_column_privilege(current_user, relation.oid, 'INSERT')) AS can_insert,
       (pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE')
         OR pg_catalog.has_any_column_privilege(current_user, relation.oid, 'UPDATE')) AS can_update,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE') AS can_truncate,
       relation.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owns
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND left(namespace.nspname, 3) <> 'pg_'
       AND namespace.nspname <> 'extensions'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (
         pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT')
         OR pg_catalog.has_any_column_privilege(current_user, relation.oid, 'SELECT')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT')
         OR pg_catalog.has_any_column_privilege(current_user, relation.oid, 'INSERT')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE')
         OR pg_catalog.has_any_column_privilege(current_user, relation.oid, 'UPDATE')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE')
         OR relation.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
       )`
  );
  validateSourceRelationGrants(grants.rows);

  const policies = await client.query(
    `SELECT roles::text[] AS roles, cmd, qual
     FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename = $1`,
    [TABLE_NAME]
  );
  const policyAllowsReader = policies.rows.some((policy) =>
    policy.roles.includes(config.source.role)
    && policy.cmd === "SELECT"
    && normalizePolicyExpression(policy.qual) === "true");
  if (!policyAllowsReader) {
    throw new ArchiveDecisionSyncError("SOURCE_RLS_POLICY_NOT_CONFIRMED");
  }
}

async function verifyArchiveAccess(client, config) {
  const identityResult = await client.query(
    `SELECT current_database() AS database_name, current_user AS role_name,
       role.rolsuper AS is_superuser, role.rolbypassrls AS bypasses_rls,
       role.rolcreatedb AS can_create_database, role.rolcreaterole AS can_create_role,
       role.rolreplication AS can_replicate,
       pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
       (SELECT count(*)::text
        FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND left(namespace.nspname, 3) <> 'pg_'
          AND pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE')
       ) AS writable_schemas,
       pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'TRUNCATE') AS can_truncate,
       pg_catalog.has_table_privilege(current_user, '${TABLE}'::regclass, 'TRIGGER') AS can_trigger,
       decision.relowner = role.oid AS owns_decision_table,
       market.relowner = role.oid AS owns_market_table
     FROM pg_catalog.pg_roles AS role
     JOIN pg_catalog.pg_class AS decision ON decision.oid = '${TABLE}'::regclass
     JOIN pg_catalog.pg_class AS market ON market.oid = '${MARKET_TABLE}'::regclass
     WHERE role.rolname = current_user`
  );
  const identity = identityResult.rows[0];
  if (!identity || identity.database_name !== config.archive.database
    || identity.role_name !== config.archive.user
    || identity.is_superuser || identity.bypasses_rls
    || identity.can_create_database || identity.can_create_role || identity.can_replicate
    || !identity.schema_usage || identity.schema_create || identity.database_create
    || identity.writable_schemas !== "0"
    || !identity.can_select || !identity.can_insert || !identity.can_update
    || identity.can_delete || identity.can_truncate || identity.can_trigger
    || identity.owns_decision_table || identity.owns_market_table) {
    throw new ArchiveDecisionSyncError("ARCHIVE_IDENTITY_OR_PRIVILEGE_CHECK_FAILED");
  }

  const grants = await client.query(
    `SELECT namespace.nspname AS schema_name, relation.relname,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE') AS can_truncate
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
       AND left(namespace.nspname, 3) <> 'pg_'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (
         pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE')
         OR pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE')
       )`
  );
  const allowedGrants = new Map([
    [TABLE_NAME, { select: true, insert: true, update: true }],
    ["AI_Crypto_Bot_Watched_Markets", { select: true, insert: false, update: false }]
  ]);
  if (grants.rows.length !== allowedGrants.size
    || grants.rows.some((row) => {
      const allowed = allowedGrants.get(row.relname);
      return row.schema_name !== "public" || !allowed
        || row.can_select !== allowed.select
        || row.can_insert !== allowed.insert
        || row.can_update !== allowed.update
        || row.can_delete || row.can_truncate;
    })) {
    throw new ArchiveDecisionSyncError("ARCHIVE_WRITE_SCOPE_TOO_BROAD");
  }
}

async function verifyNoTargetTriggers(client) {
  const result = await client.query(
    `SELECT count(*)::text AS trigger_count
     FROM pg_catalog.pg_trigger
     WHERE tgrelid = '${TABLE}'::regclass AND NOT tgisinternal`
  );
  if (result.rows[0]?.trigger_count !== "0") {
    throw new ArchiveDecisionSyncError("ARCHIVE_TARGET_TRIGGER_PRESENT");
  }
}

function valuesForRow(row) {
  return [
    row.id,
    row.symbol,
    row.decision,
    row.confidence,
    row.indicators,
    row.reason,
    row.strategy_name,
    row.strategy_version,
    row.created_at
  ];
}

function buildBatchValues(rows) {
  const parameters = [];
  const values = rows.map((row, rowIndex) => {
    const offset = rowIndex * COLUMNS.length;
    parameters.push(...valuesForRow(row));
    return `($${offset + 1}::uuid, $${offset + 2}::text, $${offset + 3}::text, `
      + `$${offset + 4}::numeric(5,2), $${offset + 5}::jsonb, $${offset + 6}::text, `
      + `$${offset + 7}::text, $${offset + 8}::text, $${offset + 9}::timestamptz)`;
  });
  return { parameters, valuesSql: values.join(", ") };
}

export function buildDecisionUpsert(rows) {
  const { parameters, valuesSql } = buildBatchValues(rows);
  const columns = COLUMNS.map(([name]) => `"${name}"`).join(", ");
  const updates = COLUMNS.slice(1)
    .map(([name]) => `"${name}" = EXCLUDED."${name}"`)
    .join(", ");
  const changed = COLUMNS.slice(1)
    .map(([name]) => `target."${name}" IS DISTINCT FROM EXCLUDED."${name}"`)
    .join(" OR ");
  return {
    text: `INSERT INTO ${TABLE} AS target (${columns}) VALUES ${valuesSql} `
      + `ON CONFLICT ("id") DO UPDATE SET ${updates} WHERE ${changed} RETURNING "id"::text AS "id"`,
    values: parameters
  };
}

function rowsHaveSameValues(left, right) {
  return VALUE_FIELDS.every((field) => left[field] === right[field]);
}

export function classifyExistingRows(sourceRows, existingRows) {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  if (existingById.size !== existingRows.length) {
    throw new ArchiveDecisionSyncError("ARCHIVE_DUPLICATE_ID");
  }
  const counts = { inserted: 0, updated: 0, skipped: 0 };
  for (const source of sourceRows) {
    const existing = existingById.get(source.id);
    if (!existing) {
      counts.inserted += 1;
    } else if (rowsHaveSameValues(source, existing)) {
      counts.skipped += 1;
    } else {
      counts.updated += 1;
    }
  }
  return counts;
}

function validateCursor(cursor) {
  return cursor === null || (
    typeof cursor.createdAt === "string"
    && UTC_TIMESTAMP_PATTERN.test(cursor.createdAt)
    && typeof cursor.id === "string"
    && UUID_PATTERN.test(cursor.id)
  );
}

function sourceBounds(run) {
  return [run.cutoff, run.lowerBound];
}

async function getNewRun(client, archiveClient, state, config) {
  const clock = await client.query(
    "SELECT pg_catalog.transaction_timestamp()::text AS cutoff"
  );
  const cutoff = clock.rows[0]?.cutoff;
  if (typeof cutoff !== "string" || !UTC_TIMESTAMP_PATTERN.test(cutoff)) {
    throw new ArchiveDecisionSyncError("SOURCE_CUTOFF_INVALID");
  }
  let lowerBound = null;
  if (state.watermark && config.overlapSeconds > 0) {
    const overlap = await client.query(
      "SELECT ($1::timestamptz - ($2::integer * INTERVAL '1 second'))::text AS lower_bound",
      [state.watermark.createdAt, config.overlapSeconds]
    );
    lowerBound = overlap.rows[0]?.lower_bound;
    if (typeof lowerBound !== "string" || !UTC_TIMESTAMP_PATTERN.test(lowerBound)) {
      throw new ArchiveDecisionSyncError("SOURCE_OVERLAP_BOUND_INVALID");
    }
  } else if (state.watermark) {
    lowerBound = state.watermark.createdAt;
  }

  const count = await client.query(
    `SELECT count(*)::text AS row_count
     FROM ${TABLE}
     WHERE created_at <= $1::timestamptz
       AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)`,
    [cutoff, lowerBound]
  );
  const expectedSourceRows = Number(count.rows[0]?.row_count);
  if (!Number.isSafeInteger(expectedSourceRows) || expectedSourceRows < 1) {
    throw new ArchiveDecisionSyncError("SOURCE_COUNT_INVALID");
  }
  const archiveRowCountBefore = await countArchiveRows(archiveClient);
  return {
    id: randomUUID(),
    cutoff,
    lowerBound,
    expectedSourceRows,
    archiveRowCountBefore,
    cursor: null,
    counters: { inserted: 0, updated: 0, skipped: 0, sourceRows: 0, batches: 0 },
    startedAt: new Date().toISOString()
  };
}

async function reconcileRunCount(client, archiveClient, run) {
  const count = await client.query(
    `SELECT count(*)::text AS row_count
     FROM ${TABLE}
     WHERE created_at <= $1::timestamptz
       AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)`,
    sourceBounds(run)
  );
  const currentCount = Number(count.rows[0]?.row_count);
  if (!Number.isSafeInteger(currentCount) || currentCount < 1) {
    throw new ArchiveDecisionSyncError("SOURCE_COUNT_INVALID");
  }
  if (currentCount !== run.expectedSourceRows) {
    run.expectedSourceRows = currentCount;
    run.cursor = null;
    run.counters = { inserted: 0, updated: 0, skipped: 0, sourceRows: 0, batches: 0 };
    run.archiveRowCountBefore = await countArchiveRows(archiveClient);
  }
}

async function verifyMarketAnchors(sourceClient, archiveClient, run) {
  const sourceSymbols = await sourceClient.query(
    `SELECT DISTINCT symbol
     FROM ${TABLE}
     WHERE created_at <= $1::timestamptz
       AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
     ORDER BY symbol`,
    sourceBounds(run)
  );
  const symbols = sourceSymbols.rows.map((row) => row.symbol);
  if (symbols.some((symbol) => typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol))) {
    throw new ArchiveDecisionSyncError("SOURCE_SYMBOL_INVALID");
  }
  if (symbols.length === 0) {
    return;
  }
  const targetSymbols = await archiveClient.query(
    `SELECT symbol
     FROM ${MARKET_TABLE}
     WHERE symbol = ANY($1::text[])`,
    [symbols]
  );
  const available = new Set(targetSymbols.rows.map((row) => row.symbol));
  if (symbols.some((symbol) => !available.has(symbol))) {
    throw new ArchiveDecisionSyncError("ARCHIVE_MARKET_ANCHOR_MISSING");
  }
}

async function readSourceBatch(client, run, batchSize) {
  const result = await client.query(
    `SELECT id::text AS id, symbol, decision, confidence::text AS confidence,
       indicators::text AS indicators, reason, strategy_name, strategy_version,
       created_at::text AS created_at
     FROM ${TABLE}
     WHERE created_at <= $1::timestamptz
       AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
     ORDER BY created_at ASC, id ASC
     LIMIT $5`,
    [run.cutoff, run.lowerBound, run.cursor?.createdAt ?? null, run.cursor?.id ?? null, batchSize]
  );
  return result.rows;
}

async function readExistingTargetRows(client, rows) {
  const result = await client.query(
    `SELECT id::text AS id, symbol, decision, confidence::text AS confidence,
       indicators::text AS indicators, reason, strategy_name, strategy_version,
       created_at::text AS created_at
     FROM ${TABLE}
     WHERE id = ANY($1::uuid[])
     FOR UPDATE`,
    [rows.map((row) => row.id)]
  );
  return result.rows;
}

async function validateTargetBatch(client, rows) {
  const persisted = await readExistingTargetRows(client, rows);
  const persistedById = new Map(persisted.map((row) => [row.id, row]));
  if (persistedById.size !== rows.length
    || rows.some((row) => !persistedById.has(row.id)
      || !rowsHaveSameValues(row, persistedById.get(row.id)))) {
    throw new ArchiveDecisionSyncError("POST_COPY_ROW_VALIDATION_FAILED");
  }
}

async function upsertBatch(client, rows) {
  await client.query("BEGIN");
  try {
    await client.query(`LOCK TABLE ${TABLE} IN SHARE ROW EXCLUSIVE MODE`);
    const before = await readExistingTargetRows(client, rows);
    const counts = classifyExistingRows(rows, before);
    const statement = buildDecisionUpsert(rows);
    const result = await client.query(statement.text, statement.values);
    if (result.rowCount !== counts.inserted + counts.updated) {
      throw new ArchiveDecisionSyncError("UPSERT_COUNT_MISMATCH");
    }
    await validateTargetBatch(client, rows);
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      throw new ArchiveDecisionSyncError("ARCHIVE_ROLLBACK_FAILED");
    }
    throw error;
  }
}

async function countArchiveRows(client) {
  const result = await client.query(`SELECT count(*)::text AS row_count FROM ${TABLE}`);
  const count = Number(result.rows[0]?.row_count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ArchiveDecisionSyncError("ARCHIVE_COUNT_INVALID");
  }
  return count;
}

function addCounts(counters, batchCounts, rowCount) {
  counters.inserted += batchCounts.inserted;
  counters.updated += batchCounts.updated;
  counters.skipped += batchCounts.skipped;
  counters.sourceRows += rowCount;
  counters.batches += 1;
}

async function persistBatch(state, run, rows, batchCounts, config, identity) {
  run.cursor = {
    createdAt: rows.at(-1).created_at,
    id: rows.at(-1).id
  };
  addCounts(run.counters, batchCounts, rows.length);
  state.run = run;
  saveSyncState(config.statePath, state, identity);
}

export async function syncAiDecisions({
  sourceClient,
  archiveClient,
  config,
  shouldStop = () => false
}) {
  const identity = {
    sourceProjectRef: config.source.projectRef,
    targetDatabase: config.archive.database
  };
  const state = loadSyncState(config.statePath, identity);
  let sourceTransaction = false;
  try {
    await sourceClient.query("SET TIME ZONE 'UTC'");
    await archiveClient.query("SET TIME ZONE 'UTC'");
    await sourceClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    sourceTransaction = true;

    await verifySourceAccess(sourceClient, config);
    await verifyDecisionSchema(sourceClient);
    await verifyArchiveAccess(archiveClient, config);
    await verifyDecisionSchema(archiveClient);
    await verifyNoTargetTriggers(archiveClient);

    let run = state.run;
    if (!run) {
      run = await getNewRun(sourceClient, archiveClient, state, config);
      state.run = run;
      saveSyncState(config.statePath, state, identity);
    } else {
      await reconcileRunCount(sourceClient, archiveClient, run);
      state.run = run;
      saveSyncState(config.statePath, state, identity);
    }
    if (!validateCursor(run.cursor)) {
      throw new ArchiveDecisionSyncError("CHECKPOINT_CURSOR_INVALID");
    }

    await verifyMarketAnchors(sourceClient, archiveClient, run);
    while (true) {
      if (shouldStop()) {
        throw new ArchiveDecisionSyncError("SYNC_INTERRUPTED");
      }
      const rows = await readSourceBatch(sourceClient, run, config.batchSize);
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        validateDecisionRow(row);
        if (run.cursor
          && (row.created_at < run.cursor.createdAt
            || (row.created_at === run.cursor.createdAt && row.id <= run.cursor.id))) {
          throw new ArchiveDecisionSyncError("SOURCE_CURSOR_ORDER_INVALID");
        }
      }

      const batchCounts = await upsertBatch(archiveClient, rows);
      await persistBatch(state, run, rows, batchCounts, config, identity);
      console.info(JSON.stringify({
        event: "archive_ai_decisions_batch_committed",
        runId: run.id,
        batch: run.counters.batches,
        sourceRows: rows.length,
        insertedRows: batchCounts.inserted,
        updatedRows: batchCounts.updated,
        skippedRows: batchCounts.skipped,
        checkpointCreatedAt: run.cursor.createdAt
      }));
      if (shouldStop()) {
        throw new ArchiveDecisionSyncError("SYNC_INTERRUPTED");
      }
    }

    if (run.counters.sourceRows !== run.expectedSourceRows
      || run.counters.inserted + run.counters.updated + run.counters.skipped
        !== run.counters.sourceRows) {
      throw new ArchiveDecisionSyncError("SOURCE_COUNT_RECONCILIATION_FAILED");
    }
    const archiveRowCountAfter = await countArchiveRows(archiveClient);
    if (archiveRowCountAfter !== run.archiveRowCountBefore + run.counters.inserted) {
      throw new ArchiveDecisionSyncError("ARCHIVE_COUNT_RECONCILIATION_FAILED");
    }

    state.watermark = run.cursor ?? state.watermark;
    state.lastSuccessAt = new Date().toISOString();
    state.run = null;
    saveSyncState(config.statePath, state, identity);
    await sourceClient.query("COMMIT");
    sourceTransaction = false;
    return {
      runId: run.id,
      sourceProjectRef: config.source.projectRef,
      sourceDatabase: "postgres",
      targetDatabase: ARCHIVE_DATABASE,
      table: TABLE_NAME,
      cutoff: run.cutoff,
      lowerBound: run.lowerBound,
      sourceRows: run.counters.sourceRows,
      archiveRowCountBefore: run.archiveRowCountBefore,
      archiveRowCountAfter,
      insertedRows: run.counters.inserted,
      updatedRows: run.counters.updated,
      skippedRows: run.counters.skipped,
      batchCount: run.counters.batches,
      sourceReadOnly: true,
      sourceDeletes: 0,
      sourceUpdates: 0
    };
  } catch (error) {
    if (sourceTransaction) {
      try {
        await sourceClient.query("ROLLBACK");
      } catch {
        throw new ArchiveDecisionSyncError("SOURCE_ROLLBACK_FAILED");
      }
    }
    if (error instanceof ArchiveStateError || error instanceof ArchiveDecisionSyncError) {
      throw error;
    }
    const sqlState = typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
      ? error.code
      : null;
    throw new ArchiveDecisionSyncError(sqlState ? `DATABASE_${sqlState}` : "DATABASE_OPERATION_FAILED");
  }
}

function safeErrorCode(error) {
  return error instanceof ArchiveStateError || error instanceof ArchiveDecisionSyncError
    ? error.safeCode
    : "SYNC_FAILED";
}

async function run() {
  const config = readDecisionSyncConfig();
  const options = createDecisionClientOptions(config);
  const sourceClient = new Client(options.source);
  const archiveClient = new Client(options.archive);
  const releaseLock = acquireProcessLock(config.statePath);
  let result;
  let failure;
  let stopRequested = false;
  const requestStop = () => { stopRequested = true; };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  try {
    await sourceClient.connect();
    await archiveClient.connect();
    result = await syncAiDecisions({
      sourceClient,
      archiveClient,
      config,
      shouldStop: () => stopRequested
    });
  } catch (error) {
    failure = error;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    const closeResults = await Promise.allSettled([
      sourceClient.end(),
      archiveClient.end()
    ]);
    if (closeResults.some((closeResult) => closeResult.status === "rejected")) {
      failure = new ArchiveDecisionSyncError("DATABASE_CONNECTION_CLOSE_FAILED");
    }
    try {
      releaseLock();
    } catch {
      failure = new ArchiveDecisionSyncError("LOCK_RELEASE_FAILED");
    }
  }

  if (failure) {
    throw failure;
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run()
    .then((result) => {
      console.info(JSON.stringify({ event: "archive_ai_decisions_completed", ...result }));
    })
    .catch((error) => {
      console.error(`Archive AI decision sync failed: ${safeErrorCode(error)}`);
      process.exitCode = error?.safeCode === "SYNC_INTERRUPTED" ? 130 : 1;
    });
}
