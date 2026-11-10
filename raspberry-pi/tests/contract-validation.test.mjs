import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_COLUMN_CONTRACTS,
  REQUIRED_FUNCTION_CONTRACTS,
  REQUIRED_READ_TABLES,
  REQUIRED_TABLES
} from "../src/services/database-contracts.mjs";
import { validateRuntimeContracts } from "../src/services/contract-validation.mjs";
import { readRuntimeConfig } from "../src/config/runtime-config.mjs";

const config = readRuntimeConfig({
  DATABASE_HOST: "127.0.0.1",
  DATABASE_NAME: "cryptopulse",
  DATABASE_USER: "runtime_reader",
  DATABASE_PASSWORD: "test-password",
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

function createContractPool({ omitTable } = {}) {
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
  const constraints = [
    { relation_name: "AI_Crypto_Bot_Watched_Markets", constraint_type: "p", columns: ["id"] },
    { relation_name: "AI_Crypto_Bot_Watched_Markets", constraint_type: "u", columns: ["symbol"] },
    {
      relation_name: "AI_Crypto_Bot_Candles",
      constraint_type: "u",
      columns: ["symbol", "interval", "timestamp"]
    },
    { relation_name: "AI_Crypto_Bot_AI_Decisions", constraint_type: "p", columns: ["id"] }
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
            role_name: "runtime_reader",
            default_transaction_read_only: "on",
            transaction_read_only: "on",
            is_superuser: false,
            bypasses_rls: false,
            can_create_database: false,
            can_create_role: false,
            can_create_objects_in_public: false
          }]
        };
      }
      if (sql.includes("constraint_row.contype AS constraint_type")) {
        return { rows: constraints };
      }
      if (sql.includes("has_table_privilege")) {
        return {
          rows: REQUIRED_TABLES.map((relation_name) => ({
            relation_name,
            is_owner: false,
            can_select: REQUIRED_READ_TABLES.includes(relation_name),
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_truncate: false
          }))
        };
      }
      if (sql.includes("has_sequence_privilege")) {
        return { rows: [] };
      }
      if (sql.includes("oidvectortypes")) {
        return { rows: functions };
      }
      if (sql.includes("information_schema.columns")) {
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
