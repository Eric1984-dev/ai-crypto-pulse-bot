import assert from "node:assert/strict";
import test from "node:test";
import {
  PAPER_TRADING_INSERT_TABLES,
  PAPER_TRADING_READ_TABLES,
  PAPER_TRADING_UPDATE_TABLES,
  REQUIRED_COLUMN_CONTRACTS,
  REQUIRED_PAPER_TRADING_COLUMNS,
  REQUIRED_TABLES,
  evaluatePaperTradingDatabaseContract
} from "../src/services/database-contracts.mjs";

function createSnapshot(overrides = {}) {
  const expectedColumns = {
    ...REQUIRED_COLUMN_CONTRACTS,
    ...REQUIRED_PAPER_TRADING_COLUMNS
  };
  const columns = Object.entries(expectedColumns).flatMap(([table_name, values]) =>
    Object.entries(values).map(([column_name, data_type]) => ({
      table_name,
      column_name,
      data_type
    })));
  const tablePrivileges = REQUIRED_TABLES.map((relation_name) => ({
    relation_name,
    is_owner: false,
    can_select: PAPER_TRADING_READ_TABLES.includes(relation_name),
    can_insert: PAPER_TRADING_INSERT_TABLES.includes(relation_name),
    can_update: PAPER_TRADING_UPDATE_TABLES.includes(relation_name),
    can_delete: false,
    can_truncate: false
  }));
  const constraints = [
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
  return {
    expectedRoleName: "paper_writer",
    connection: {
      database_name: "ai_crypto_bot_store",
      role_name: "paper_writer",
      default_transaction_read_only: "on",
      transaction_read_only: "on",
      is_superuser: false,
      bypasses_rls: false,
      can_create_database: false,
      can_create_role: false,
      can_create_objects_in_public: false
    },
    tables: REQUIRED_TABLES.map((relation_name) => ({ relation_name })),
    columns,
    constraints,
    tablePrivileges,
    sequencePrivileges: [],
    functions: [],
    ...overrides
  };
}

test("paper trading contract allows only scoped non-owner portfolio writes", () => {
  const result = evaluatePaperTradingDatabaseContract(
    createSnapshot(),
    "ai_crypto_bot_store"
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("paper trading contract requires schema columns and exact write grants", () => {
  const snapshot = createSnapshot({
    columns: createSnapshot().columns.filter(({ table_name, column_name }) =>
      !(table_name === "AI_Crypto_Bot_Trades" && column_name === "ai_decision_id"))
  });
  const privileges = snapshot.tablePrivileges.map((table) =>
    table.relation_name === "AI_Crypto_Bot_Portfolios"
      ? { ...table, can_insert: false }
      : table);
  snapshot.tablePrivileges = privileges;

  const result = evaluatePaperTradingDatabaseContract(snapshot, "ai_crypto_bot_store");

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes(
    "MISSING_PAPER_TRADING_COLUMN:AI_Crypto_Bot_Trades.ai_decision_id"
  ));
  assert.ok(result.errors.includes(
    "MISSING_PAPER_TRADING_INSERT_PRIVILEGE:AI_Crypto_Bot_Portfolios"
  ));
});

test("paper trading contract requires read-only candle access for exit ATR", () => {
  const snapshot = createSnapshot({
    tablePrivileges: createSnapshot().tablePrivileges.map((table) =>
      table.relation_name === "AI_Crypto_Bot_Candles"
        ? { ...table, can_select: false }
        : table)
  });

  const result = evaluatePaperTradingDatabaseContract(snapshot, "ai_crypto_bot_store");

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes(
    "MISSING_PAPER_TRADING_SELECT_PRIVILEGE:AI_Crypto_Bot_Candles"
  ));
});

test("paper trading contract rejects ownership, destructive grants, and unrelated writes", () => {
  const snapshot = createSnapshot();
  snapshot.tablePrivileges = snapshot.tablePrivileges.map((table) => {
    if (table.relation_name === "AI_Crypto_Bot_Portfolios") {
      return { ...table, is_owner: true };
    }
    if (table.relation_name === "AI_Crypto_Bot_Watched_Markets") {
      return { ...table, can_insert: true, can_delete: true };
    }
    return table;
  });

  const result = evaluatePaperTradingDatabaseContract(snapshot, "ai_crypto_bot_store");

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes(
    "PAPER_TRADING_DATABASE_ROLE_TABLE_OWNER_NOT_ALLOWED:AI_Crypto_Bot_Portfolios"
  ));
  assert.ok(result.errors.includes(
    "PAPER_TRADING_DATABASE_ROLE_UNSAFE_INSERT_PRIVILEGE:AI_Crypto_Bot_Watched_Markets"
  ));
  assert.ok(result.errors.includes(
    "PAPER_TRADING_DATABASE_ROLE_UNSAFE_TABLE_PRIVILEGE:AI_Crypto_Bot_Watched_Markets"
  ));
});

test("paper trading contract continues to reject emergency-state UPDATE privilege", () => {
  const snapshot = createSnapshot();
  snapshot.tablePrivileges = snapshot.tablePrivileges.map((table) =>
    table.relation_name === "AI_Crypto_Bot_Emergency_State"
      ? { ...table, can_update: true }
      : table);

  const result = evaluatePaperTradingDatabaseContract(snapshot, "ai_crypto_bot_store");

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes(
    "PAPER_TRADING_DATABASE_ROLE_UNSAFE_UPDATE_PRIVILEGE:AI_Crypto_Bot_Emergency_State"
  ));
});

test("paper trading contract preserves the database identity and elevated-role checks", () => {
  const snapshot = createSnapshot({
    connection: {
      ...createSnapshot().connection,
      database_name: "different_database",
      is_superuser: true
    }
  });

  const result = evaluatePaperTradingDatabaseContract(snapshot, "ai_crypto_bot_store");

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("DATABASE_IDENTITY_MISMATCH"));
  assert.ok(result.errors.includes("DATABASE_ROLE_TOO_PRIVILEGED"));
});
