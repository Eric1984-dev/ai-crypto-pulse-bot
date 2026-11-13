import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  DASHBOARD_READ_TABLES,
  PAPER_TRADING_READ_TABLES,
  REQUIRED_COLUMN_CONTRACTS,
  REQUIRED_FUNCTION_CONTRACTS,
  REQUIRED_PAPER_EXECUTION_AUDIT_SELECT_COLUMNS,
  REQUIRED_READ_TABLES,
  REQUIRED_TABLES
} from "../src/services/database-contracts.mjs";
import {
  validateIngestionRuntimeContracts,
  validateRuntimeContracts
} from "../src/services/contract-validation.mjs";
import { validateAIAnalysisRuntimeContracts } from "../src/services/ai-analysis-contract-validation.mjs";
import { inspectDatabaseContract } from "../src/repositories/contract-repository.mjs";
import { readRuntimeConfig } from "../src/config/runtime-config.mjs";

const config = readRuntimeConfig({
  DATABASE_HOST: "127.0.0.1",
  DATABASE_NAME: "cryptopulse",
  DATABASE_USER: "runtime_reader",
  DATABASE_PASSWORD: "test-password",
  DASHBOARD_USERNAME: "operator",
  DASHBOARD_PASSWORD_HASH: "$2a$10$mqVzXb8xEv/4khOjtskpme6LMSS9d/BQTwDX/LLAm7ig6xKOgptea",
  DATABASE_SSL: "false"
});

const marketRows = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    symbol: "BTC-EUR",
    enabled: true,
    priority: 1
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    symbol: "ETH-EUR",
    enabled: true,
    priority: 2
  }
];

function createContractPool({
  omitTable,
  omitLegacyConstraints = false,
  allowIngestionWrites = false,
  allowAiAnalysisWrites = false,
  extraWriterRole = false,
  ownerTable,
  unsafeTable,
  extraOwnedTable,
  canCreatePublic = false,
  roleName = "runtime_reader",
  noSelectTables = [],
  noPaperAuditSelectColumns = []
} = {}) {
  const queries = [];
  const columns = Object.entries(REQUIRED_COLUMN_CONTRACTS).flatMap(([table_name, values]) =>
    Object.entries(values).map(([column_name, data_type]) => ({
      table_name,
      column_name,
      data_type
    })));
  const functions = REQUIRED_FUNCTION_CONTRACTS.map((contract) => ({
    function_name: contract.name,
    argument_types: contract.argumentTypes,
    result_type: contract.resultType,
    function_kind: "f",
    security_definer: contract.securityDefiner
  }));
  const columnPrivileges = REQUIRED_PAPER_EXECUTION_AUDIT_SELECT_COLUMNS.map(
    (column_name) => ({
      table_name: "AI_Crypto_Bot_Paper_Execution_Audit",
      column_name,
      can_select: !noPaperAuditSelectColumns.includes(column_name)
    })
  );
  const constraints = omitLegacyConstraints ? [] : [
    { relation_name: "AI_Crypto_Bot_Watched_Markets", constraint_type: "p", columns: ["id"] },
    { relation_name: "AI_Crypto_Bot_Watched_Markets", constraint_type: "u", columns: ["symbol"] },
    {
      relation_name: "AI_Crypto_Bot_Candles",
      constraint_type: "u",
      columns: ["symbol", "interval", "timestamp"]
    },
    { relation_name: "AI_Crypto_Bot_AI_Decisions", constraint_type: "p", columns: ["id"] },
    {
      relation_name: "AI_Crypto_Bot_Paper_Execution_Audit",
      constraint_type: "p",
      columns: ["id"]
    },
    {
      relation_name: "AI_Crypto_Bot_Paper_Execution_Audit",
      constraint_type: "u",
      columns: ["evaluation_run_id", "portfolio_id", "decision_id"]
    }
  ];

  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "BEGIN READ ONLY" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("current_database() AS database_name")) {
        return {
          rows: [{
            database_name: "cryptopulse",
            role_name: roleName,
            default_transaction_read_only: "on",
            transaction_read_only: "on",
            is_superuser: false,
            bypasses_rls: false,
            can_create_database: false,
            can_create_role: false,
            can_create_objects_in_public: canCreatePublic
          }]
        };
      }
      if (sql.includes("constraint_row.contype AS constraint_type")) {
        const arrayTypeOid = sql.includes("attribute.attname::text") ? 1009 : 1003;
        const parseArray = pg.types.getTypeParser(arrayTypeOid, "text");
        return {
          rows: constraints.map((constraint) => ({
            ...constraint,
            columns: parseArray(`{${constraint.columns.join(",")}}`)
          }))
        };
      }
      if (sql.includes("has_table_privilege")) {
        const rows = REQUIRED_TABLES.map((relation_name) => {
          const isOwner = relation_name === ownerTable;
          return {
            relation_name,
            is_owner: isOwner,
            can_select: (DASHBOARD_READ_TABLES.includes(relation_name)
              || REQUIRED_READ_TABLES.includes(relation_name)
              || PAPER_TRADING_READ_TABLES.includes(relation_name))
              && !noSelectTables.includes(relation_name),
            can_insert: allowIngestionWrites
              && ["AI_Crypto_Bot_Market_Data", "AI_Crypto_Bot_Candles"].includes(relation_name)
              || allowAiAnalysisWrites && relation_name === "AI_Crypto_Bot_AI_Decisions"
              || extraWriterRole && relation_name === "AI_Crypto_Bot_Trades"
              || isOwner,
            can_update: allowIngestionWrites
              && ["AI_Crypto_Bot_Market_Data", "AI_Crypto_Bot_Candles"].includes(relation_name)
              || isOwner,
            can_delete: isOwner || relation_name === unsafeTable,
            can_truncate: isOwner || relation_name === unsafeTable
          };
        });
        if (extraOwnedTable) {
          rows.push({
            relation_name: extraOwnedTable,
            is_owner: true,
            can_select: false,
            can_insert: true,
            can_update: true,
            can_delete: true,
            can_truncate: true
          });
        }
        return {
          rows
        };
      }
      if (sql.includes("has_column_privilege")) {
        return { rows: columnPrivileges };
      }
      if (sql.includes("has_sequence_privilege")) {
        return { rows: [] };
      }
      if (sql.includes("oidvectortypes")) {
        return { rows: functions };
      }
      if (sql.includes("pg_catalog.pg_attribute AS attribute")) {
        return { rows: columns };
      }
      if (sql.includes("relation.relkind IN ('r', 'p')")) {
        return {
          rows: REQUIRED_TABLES
            .filter((name) => name !== omitTable)
            .map((relation_name) => ({ relation_name }))
        };
      }
      if (sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets"')) {
        return { rows: marketRows };
      }
      throw new Error("Unexpected query in read-only contract test.");
    },
    release() {}
  };
  return {
    queries,
    async connect() { return client; }
  };
}

test("contract inspection reads catalog columns without requiring table SELECT", async () => {
  const pool = createContractPool({
    noSelectTables: ["AI_Crypto_Bot_Candles"]
  });

  const snapshot = await inspectDatabaseContract(pool, "paper_writer");
  const candleColumns = snapshot.columns
    .filter(({ table_name }) => table_name === "AI_Crypto_Bot_Candles")
    .map(({ column_name }) => column_name);

  assert.equal(
    snapshot.tablePrivileges.find(({ relation_name }) =>
      relation_name === "AI_Crypto_Bot_Candles").can_select,
    false
  );
  assert.deepEqual(
    snapshot.columnPrivileges.map(({ column_name, can_select }) => ({
      column_name,
      can_select
    })),
    REQUIRED_PAPER_EXECUTION_AUDIT_SELECT_COLUMNS.map((column_name) => ({
      column_name,
      can_select: true
    }))
  );
  assert.deepEqual(candleColumns, Object.keys(REQUIRED_COLUMN_CONTRACTS.AI_Crypto_Bot_Candles));
  assert.ok(pool.queries.some((query) =>
    query.includes("pg_catalog.format_type(attribute.atttypid, NULL)")));
  assert.ok(pool.queries.some((query) =>
    query.includes("attribute.attname::text AS column_name")));
  assert.ok(pool.queries.some((query) =>
    query.includes("pg_catalog.has_column_privilege")));
  assert.ok(pool.queries.every((query) => !query.includes("information_schema.columns")));
});

test("runtime preflight validates contracts and uses only read-only SQL", async () => {
  const pool = createContractPool();

  const result = await validateRuntimeContracts(pool, config);

  assert.equal(result.contracts, "valid");
  assert.equal(result.enabledMarkets, 2);
  assert.equal(result.requiredTables, REQUIRED_TABLES.length);
  assert.equal(result.requiredFunctions, 0);
  assert.ok(pool.queries.every((query) =>
    query === "BEGIN READ ONLY" || query === "COMMIT" || /^\s*SELECT\b/i.test(query)));
  assert.ok(pool.queries.includes("BEGIN READ ONLY"));
  assert.ok(pool.queries.some((query) =>
    query.includes('FROM public."AI_Crypto_Bot_Watched_Markets"')));
});

test("runtime preflight fails closed before market access when a required table is missing", async () => {
  const pool = createContractPool({ omitTable: "AI_Crypto_Bot_Trades" });

  await assert.rejects(
    validateRuntimeContracts(pool, config),
    (error) => error.code === "RUNTIME_CONTRACT_INVALID"
      && error.errors.includes("MISSING_TABLE:AI_Crypto_Bot_Trades")
  );
  assert.ok(!pool.queries.some((query) =>
    query.includes('FROM public."AI_Crypto_Bot_Watched_Markets"')));
});

test("runtime preflight requires dashboard table SELECT privileges", async () => {
  const pool = createContractPool({
    noSelectTables: ["AI_Crypto_Bot_Profiles"]
  });

  await assert.rejects(
    validateRuntimeContracts(pool, config),
    (error) => error.code === "RUNTIME_CONTRACT_INVALID"
      && error.errors.includes("MISSING_SELECT_PRIVILEGE:AI_Crypto_Bot_Profiles")
  );
  assert.equal(DASHBOARD_READ_TABLES.includes("AI_Crypto_Bot_Profiles"), true);
});

test("ingestion preflight warns on legacy constraints and write-capable roles without requiring runtime functions", async () => {
  const pool = createContractPool({
    omitLegacyConstraints: true,
    allowIngestionWrites: true,
    extraWriterRole: true
  });

  const result = await validateIngestionRuntimeContracts(pool, config);

  assert.equal(result.contracts, "valid");
  assert.equal(result.enabledMarkets, 2);
  assert.ok(result.warnings.some((warning) => warning.startsWith("MISSING_CANDLE_CONSTRAINT:")));
  assert.ok(result.warnings.some((warning) =>
    warning === "DATABASE_ROLE_CAN_WRITE_TABLE:AI_Crypto_Bot_Trades"));
  assert.ok(pool.queries.every((query) =>
    query === "BEGIN READ ONLY" || query === "COMMIT" || query === "ROLLBACK"
    || /^\s*SELECT\b/i.test(query)));
});

test("ingestion preflight fails when snapshot or candle persistence privileges are missing", async () => {
  const pool = createContractPool();

  await assert.rejects(
    validateIngestionRuntimeContracts(pool, config),
    (error) => error.code === "INGESTION_CONTRACT_INVALID"
      && error.errors.includes("MISSING_INGESTION_WRITE_PRIVILEGE:AI_Crypto_Bot_Market_Data")
      && error.errors.includes("MISSING_INGESTION_WRITE_PRIVILEGE:AI_Crypto_Bot_Candles")
  );
});

test("ingestion preflight rejects a table owner unless the explicit owner opt-in is enabled", async () => {
  const pool = createContractPool({
    allowIngestionWrites: true,
    ownerTable: "AI_Crypto_Bot_Candles"
  });

  await assert.rejects(
    validateIngestionRuntimeContracts(pool, config),
    (error) => error.code === "INGESTION_CONTRACT_INVALID"
      && error.errors.includes("INGESTION_ROLE_UNSAFE_TABLE_PRIVILEGE:AI_Crypto_Bot_Candles")
  );
});

test("ingestion owner opt-in permits ownership only for known project tables and logs a warning", async () => {
  const ownerConfig = {
    ...config,
    ingestion: Object.freeze({ allowTableOwner: true })
  };
  const pool = createContractPool({
    allowIngestionWrites: true,
    ownerTable: "AI_Crypto_Bot_Candles"
  });

  const result = await validateIngestionRuntimeContracts(pool, ownerConfig);

  assert.equal(result.contracts, "valid");
  assert.ok(result.warnings.includes(
    "INGESTION_ROLE_TABLE_OWNER_ALLOWED:AI_Crypto_Bot_Candles"
  ));
});

test("owner opt-in does not permit unsafe privileges on non-owned or unknown tables", async () => {
  const ownerConfig = {
    ...config,
    ingestion: Object.freeze({ allowTableOwner: true })
  };

  await assert.rejects(
    validateIngestionRuntimeContracts(
      createContractPool({
        allowIngestionWrites: true,
        ownerTable: "AI_Crypto_Bot_Candles",
        unsafeTable: "AI_Crypto_Bot_Trades"
      }),
      ownerConfig
    ),
    (error) => error.code === "INGESTION_CONTRACT_INVALID"
      && error.errors.includes("INGESTION_ROLE_UNSAFE_TABLE_PRIVILEGE:AI_Crypto_Bot_Trades")
  );
  await assert.rejects(
    validateIngestionRuntimeContracts(
      createContractPool({
        allowIngestionWrites: true,
        extraOwnedTable: "AI_Crypto_Bot_Unexpected"
      }),
      ownerConfig
    ),
    (error) => error.code === "INGESTION_CONTRACT_INVALID"
      && error.errors.includes("INGESTION_ROLE_UNSAFE_TABLE_PRIVILEGE:AI_Crypto_Bot_Unexpected")
  );
  await assert.rejects(
    validateIngestionRuntimeContracts(
      createContractPool({
        allowIngestionWrites: true,
        ownerTable: "AI_Crypto_Bot_Candles",
        canCreatePublic: true
      }),
      ownerConfig
    ),
    (error) => error.code === "INGESTION_CONTRACT_INVALID"
      && error.errors.includes("DATABASE_ROLE_TOO_PRIVILEGED")
  );
});

test("ingestion owner opt-in does not relax the API read-only contract", async () => {
  const ownerConfig = {
    ...config,
    ingestion: Object.freeze({ allowTableOwner: true })
  };

  await assert.rejects(
    validateRuntimeContracts(
      createContractPool({
        allowIngestionWrites: true,
        ownerTable: "AI_Crypto_Bot_Candles"
      }),
      ownerConfig
    ),
    (error) => error.code === "RUNTIME_CONTRACT_INVALID"
      && error.errors.includes("DATABASE_ROLE_CAN_WRITE_TABLE:AI_Crypto_Bot_Candles")
  );
});

test("AI writer preflight recognizes catalog constraints and permits only decision inserts", async () => {
  const pool = createContractPool({
    allowAiAnalysisWrites: true,
    roleName: "ai_writer"
  });
  const aiConfig = {
    ...config,
    database: Object.freeze({ ...config.database, user: "ai_writer" })
  };
  const result = await validateAIAnalysisRuntimeContracts(pool, aiConfig);

  assert.equal(result.contracts, "valid");
  assert.equal(result.requiredFunctions, 0);
  assert.ok(pool.queries.some((query) =>
    query.includes("ARRAY_AGG(attribute.attname::text ORDER BY key_column.ordinality)")));
  assert.ok(pool.queries.every((query) =>
    query === "BEGIN READ ONLY" || query === "COMMIT" || /^\s*SELECT\b/i.test(query)));
});

test("AI writer preflight rejects missing decision inserts, table ownership, and unrelated writes", async () => {
  const aiConfig = {
    ...config,
    database: Object.freeze({ ...config.database, user: "ai_writer" })
  };
  await assert.rejects(
    validateAIAnalysisRuntimeContracts(
      createContractPool({ roleName: "ai_writer" }),
      aiConfig
    ),
    (error) => error.code === "AI_ANALYSIS_CONTRACT_INVALID"
      && error.errors.includes("MISSING_AI_DECISION_INSERT_PRIVILEGE:AI_Crypto_Bot_AI_Decisions")
  );
  await assert.rejects(
    validateAIAnalysisRuntimeContracts(
      createContractPool({
        allowAiAnalysisWrites: true,
        ownerTable: "AI_Crypto_Bot_AI_Decisions",
        roleName: "ai_writer"
      }),
      aiConfig
    ),
    (error) => error.code === "AI_ANALYSIS_CONTRACT_INVALID"
      && error.errors.includes("AI_DATABASE_ROLE_TABLE_OWNER_NOT_ALLOWED:AI_Crypto_Bot_AI_Decisions")
  );
  await assert.rejects(
    validateAIAnalysisRuntimeContracts(
      createContractPool({
        allowAiAnalysisWrites: true,
        extraWriterRole: true,
        roleName: "ai_writer"
      }),
      aiConfig
    ),
    (error) => error.code === "AI_ANALYSIS_CONTRACT_INVALID"
      && error.errors.includes("AI_DATABASE_ROLE_UNSAFE_INSERT_PRIVILEGE:AI_Crypto_Bot_Trades")
  );
});
