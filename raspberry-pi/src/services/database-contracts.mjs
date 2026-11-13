export const REQUIRED_TABLES = Object.freeze([
  "AI_Crypto_Bot_Profiles",
  "AI_Crypto_Bot_Portfolios",
  "AI_Crypto_Bot_Positions",
  "AI_Crypto_Bot_Trades",
  "AI_Crypto_Bot_AI_Decisions",
  "AI_Crypto_Bot_Status",
  "AI_Crypto_Bot_Watched_Markets",
  "AI_Crypto_Bot_Market_Data",
  "AI_Crypto_Bot_Candles",
  "AI_Crypto_Bot_Strategies",
  "AI_Crypto_Bot_Strategy_Changes",
  "AI_Crypto_Bot_Strategy_Performance",
  "AI_Crypto_Bot_Backtests",
  "AI_Crypto_Bot_Portfolio_Snapshots",
  "AI_Crypto_Bot_Scanner_Events",
  "AI_Crypto_Bot_Emergency_State",
  "AI_Crypto_Bot_Shadow_Exit_Scenarios",
  "AI_Crypto_Bot_Shadow_Exit_Events",
  "AI_Crypto_Bot_Analytics_Runs"
]);

export const REQUIRED_READ_TABLES = Object.freeze([
  "AI_Crypto_Bot_Watched_Markets",
  "AI_Crypto_Bot_Market_Data",
  "AI_Crypto_Bot_Candles",
  "AI_Crypto_Bot_AI_Decisions",
  "AI_Crypto_Bot_Status"
]);

export const DASHBOARD_READ_TABLES = Object.freeze([
  "AI_Crypto_Bot_Profiles",
  "AI_Crypto_Bot_Portfolios",
  "AI_Crypto_Bot_Positions",
  "AI_Crypto_Bot_Trades",
  "AI_Crypto_Bot_AI_Decisions",
  "AI_Crypto_Bot_Status",
  "AI_Crypto_Bot_Watched_Markets",
  "AI_Crypto_Bot_Market_Data",
  "AI_Crypto_Bot_Candles",
  "AI_Crypto_Bot_Portfolio_Snapshots",
  "AI_Crypto_Bot_Emergency_State",
  "AI_Crypto_Bot_Shadow_Exit_Scenarios",
  "AI_Crypto_Bot_Shadow_Exit_Events",
  "AI_Crypto_Bot_Analytics_Runs"
]);

export const REQUIRED_COLUMN_CONTRACTS = Object.freeze({
  AI_Crypto_Bot_Watched_Markets: Object.freeze({
    id: "uuid",
    symbol: "text",
    enabled: "boolean",
    priority: "integer",
    created_at: "timestamp with time zone",
    updated_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Market_Data: Object.freeze({
    symbol: "text",
    price: "numeric",
    volume: "numeric",
    daily_change: "numeric",
    high_24h: "numeric",
    low_24h: "numeric",
    captured_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Candles: Object.freeze({
    symbol: "text",
    interval: "text",
    open: "numeric",
    high: "numeric",
    low: "numeric",
    close: "numeric",
    volume: "numeric",
    timestamp: "timestamp with time zone"
  }),
  AI_Crypto_Bot_AI_Decisions: Object.freeze({
    id: "uuid",
    symbol: "text",
    decision: "text",
    confidence: "numeric",
    indicators: "jsonb",
    reason: "text",
    strategy_name: "text",
    strategy_version: "text",
    created_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Status: Object.freeze({
    singleton: "boolean",
    is_active: "boolean",
    is_analyzing: "boolean",
    status: "text",
    last_run: "timestamp with time zone",
    updated_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Portfolio_Snapshots: Object.freeze({
    id: "uuid",
    portfolio_id: "uuid",
    portfolio_value: "numeric",
    available_balance: "numeric",
    open_positions: "integer",
    captured_at: "timestamp with time zone",
    snapshot_order: "bigint"
  }),
  AI_Crypto_Bot_Analytics_Runs: Object.freeze({
    id: "uuid",
    calculation_version: "text",
    period: "text",
    period_start: "timestamp with time zone",
    period_end: "timestamp with time zone",
    generated_at: "timestamp with time zone",
    source_counts: "jsonb",
    analytics_summary: "jsonb",
    insights: "jsonb"
  })
});

export const REQUIRED_FUNCTION_CONTRACTS = Object.freeze([]);

export const OPTIONAL_FUNCTION_CONTRACTS = Object.freeze([
  Object.freeze({
    name: "AI_Crypto_Bot_Run_Database_AI_Analysis",
    argumentTypes: "timestamp with time zone",
    resultType: "TABLE(analyzed_markets integer, decisions_stored integer, buy_count integer, sell_count integer, hold_count integer, wait_count integer)",
    securityDefiner: false
  })
]);

export const REQUIRED_WATCHED_MARKET_CONSTRAINTS = Object.freeze([
  Object.freeze({ type: "p", columns: Object.freeze(["id"]) }),
  Object.freeze({ type: "u", columns: Object.freeze(["symbol"]) })
]);

export const REQUIRED_CANDLE_CONSTRAINTS = Object.freeze([
  Object.freeze({ type: "u", columns: Object.freeze(["symbol", "interval", "timestamp"]) })
]);

export const REQUIRED_DECISION_CONSTRAINTS = Object.freeze([
  Object.freeze({ type: "p", columns: Object.freeze(["id"]) })
]);

export const REQUIRED_PAPER_TRADING_COLUMNS = Object.freeze({
  AI_Crypto_Bot_Profiles: Object.freeze({
    id: "uuid",
    created_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Portfolios: Object.freeze({
    id: "uuid",
    user_id: "uuid",
    starting_balance: "numeric",
    available_balance: "numeric",
    portfolio_value: "numeric",
    created_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Positions: Object.freeze({
    id: "uuid",
    portfolio_id: "uuid",
    symbol: "text",
    amount: "numeric",
    entry_price: "numeric",
    current_price: "numeric",
    unrealized_pnl: "numeric",
    high_water_price: "numeric",
    trailing_stop_price: "numeric",
    status: "text",
    created_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Trades: Object.freeze({
    id: "uuid",
    portfolio_id: "uuid",
    ai_decision_id: "uuid",
    idempotency_key: "uuid",
    symbol: "text",
    side: "text",
    price: "numeric",
    quantity: "numeric",
    fees: "numeric",
    slippage: "numeric",
    realized_pnl: "numeric",
    execution_reason: "text",
    created_at: "timestamp with time zone"
  }),
  AI_Crypto_Bot_Portfolio_Snapshots: Object.freeze({
    id: "uuid",
    portfolio_id: "uuid",
    portfolio_value: "numeric",
    available_balance: "numeric",
    open_positions: "integer",
    captured_at: "timestamp with time zone",
    snapshot_order: "bigint"
  }),
  AI_Crypto_Bot_Emergency_State: Object.freeze({
    id: "uuid",
    status: "text",
    reason: "text",
    created_at: "timestamp with time zone"
  })
});

export const PAPER_TRADING_READ_TABLES = Object.freeze([
  "AI_Crypto_Bot_Profiles",
  "AI_Crypto_Bot_Portfolios",
  "AI_Crypto_Bot_Positions",
  "AI_Crypto_Bot_Trades",
  "AI_Crypto_Bot_AI_Decisions",
  "AI_Crypto_Bot_Status",
  "AI_Crypto_Bot_Watched_Markets",
  "AI_Crypto_Bot_Market_Data",
  "AI_Crypto_Bot_Candles",
  "AI_Crypto_Bot_Portfolio_Snapshots",
  "AI_Crypto_Bot_Emergency_State"
]);

export const PAPER_TRADING_INSERT_TABLES = Object.freeze([
  "AI_Crypto_Bot_Portfolios",
  "AI_Crypto_Bot_Positions",
  "AI_Crypto_Bot_Trades",
  "AI_Crypto_Bot_Portfolio_Snapshots",
  "AI_Crypto_Bot_Emergency_State"
]);

export const PAPER_TRADING_UPDATE_TABLES = Object.freeze([
  "AI_Crypto_Bot_Portfolios",
  "AI_Crypto_Bot_Positions",
  "AI_Crypto_Bot_Status"
]);

const OPTIONAL_FUNCTION_NAMES = new Set(
  OPTIONAL_FUNCTION_CONTRACTS.map((contract) => contract.name)
);

function normalizedSql(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().toLowerCase()
    : "";
}

function sameColumns(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((column, index) => column === right[index]);
}

function hasConstraint(constraints, relationName, expected) {
  return constraints.some((constraint) => constraint.relation_name === relationName
    && constraint.constraint_type === expected.type
    && sameColumns(constraint.columns, expected.columns));
}

function validateFunction(contract, functions, errors, required) {
  const candidates = functions.filter((row) => row.function_name === contract.name);
  if (candidates.length === 0) {
    if (required) {
      errors.push(`MISSING_FUNCTION:${contract.name}`);
    }
    return;
  }

  const matches = candidates.filter((row) =>
    row.argument_types === contract.argumentTypes
    && normalizedSql(row.result_type) === normalizedSql(contract.resultType)
    && row.function_kind === "f"
    && row.security_definer === contract.securityDefiner
  );
  if (matches.length !== 1) {
    errors.push(`FUNCTION_CONTRACT_MISMATCH:${contract.name}`);
  }
}

export function evaluateDatabaseContract(snapshot, expectedDatabaseName, {
  requiredReadTables = REQUIRED_READ_TABLES
} = {}) {
  const errors = [];
  const tables = new Set(snapshot.tables.map((row) => row.relation_name));

  if (snapshot.connection.database_name !== expectedDatabaseName
    || snapshot.connection.role_name !== snapshot.expectedRoleName) {
    errors.push("DATABASE_IDENTITY_MISMATCH");
  }
  if (snapshot.connection.default_transaction_read_only !== "on"
    || snapshot.connection.transaction_read_only !== "on") {
    errors.push("READ_ONLY_MODE_REQUIRED");
  }
  if (snapshot.connection.is_superuser
    || snapshot.connection.bypasses_rls
    || snapshot.connection.can_create_database
    || snapshot.connection.can_create_role
    || snapshot.connection.can_create_objects_in_public) {
    errors.push("DATABASE_ROLE_TOO_PRIVILEGED");
  }

  for (const tableName of REQUIRED_TABLES) {
    if (!tables.has(tableName)) {
      errors.push(`MISSING_TABLE:${tableName}`);
    }
  }

  const columnsByTable = new Map();
  for (const column of snapshot.columns) {
    if (!columnsByTable.has(column.table_name)) {
      columnsByTable.set(column.table_name, new Map());
    }
    columnsByTable.get(column.table_name).set(column.column_name, column.data_type);
  }
  for (const [tableName, expectedColumns] of Object.entries(REQUIRED_COLUMN_CONTRACTS)) {
    const actualColumns = columnsByTable.get(tableName);
    for (const [columnName, dataType] of Object.entries(expectedColumns)) {
      if (!actualColumns?.has(columnName)) {
        errors.push(`MISSING_COLUMN:${tableName}.${columnName}`);
      } else if (actualColumns.get(columnName) !== dataType) {
        errors.push(`COLUMN_TYPE_MISMATCH:${tableName}.${columnName}`);
      }
    }
  }

  for (const expected of REQUIRED_WATCHED_MARKET_CONSTRAINTS) {
    if (!hasConstraint(snapshot.constraints, "AI_Crypto_Bot_Watched_Markets", expected)) {
      errors.push(`MISSING_MARKET_CONSTRAINT:${expected.type}:${expected.columns.join(",")}`);
    }
  }
  for (const expected of REQUIRED_CANDLE_CONSTRAINTS) {
    if (!hasConstraint(snapshot.constraints, "AI_Crypto_Bot_Candles", expected)) {
      errors.push(`MISSING_CANDLE_CONSTRAINT:${expected.columns.join(",")}`);
    }
  }
  for (const expected of REQUIRED_DECISION_CONSTRAINTS) {
    if (!hasConstraint(snapshot.constraints, "AI_Crypto_Bot_AI_Decisions", expected)) {
      errors.push(`MISSING_DECISION_CONSTRAINT:${expected.columns.join(",")}`);
    }
  }

  for (const table of snapshot.tablePrivileges) {
    if (!table.can_select && requiredReadTables.includes(table.relation_name)) {
      errors.push(`MISSING_SELECT_PRIVILEGE:${table.relation_name}`);
    }
    if (table.is_owner || table.can_insert || table.can_update
      || table.can_delete || table.can_truncate) {
      errors.push(`DATABASE_ROLE_CAN_WRITE_TABLE:${table.relation_name}`);
    }
  }
  for (const sequence of snapshot.sequencePrivileges) {
    if (sequence.can_use || sequence.can_update || sequence.is_owner) {
      errors.push(`DATABASE_ROLE_CAN_WRITE_SEQUENCE:${sequence.relation_name}`);
    }
  }

  for (const contract of REQUIRED_FUNCTION_CONTRACTS) {
    validateFunction(contract, snapshot.functions, errors, true);
  }
  for (const contract of OPTIONAL_FUNCTION_CONTRACTS) {
    validateFunction(contract, snapshot.functions, errors, false);
  }

  const optionalFunctions = Object.fromEntries(
    OPTIONAL_FUNCTION_CONTRACTS.map(({ name }) => [
      name,
      snapshot.functions.some((row) => row.function_name === name) ? "present" : "not-installed"
    ])
  );

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    requiredTables: REQUIRED_TABLES.length,
    requiredFunctions: REQUIRED_FUNCTION_CONTRACTS.length,
    optionalFunctions: Object.freeze(optionalFunctions)
  });
}

export function evaluateAIAnalysisDatabaseContract(snapshot, expectedDatabaseName) {
  const base = evaluateDatabaseContract(snapshot, expectedDatabaseName);
  const errors = base.errors.filter((error) =>
    !error.startsWith("DATABASE_ROLE_CAN_WRITE_TABLE:")
  );
  const decisionTable = "AI_Crypto_Bot_AI_Decisions";
  const decisionPrivileges = snapshot.tablePrivileges.find(({ relation_name }) =>
    relation_name === decisionTable
  );

  if (!decisionPrivileges?.can_insert) {
    errors.push(`MISSING_AI_DECISION_INSERT_PRIVILEGE:${decisionTable}`);
  }
  for (const table of snapshot.tablePrivileges) {
    if (table.is_owner) {
      errors.push(`AI_DATABASE_ROLE_TABLE_OWNER_NOT_ALLOWED:${table.relation_name}`);
    }
    if (table.can_insert && table.relation_name !== decisionTable) {
      errors.push(`AI_DATABASE_ROLE_UNSAFE_INSERT_PRIVILEGE:${table.relation_name}`);
    }
    if (table.can_update || table.can_delete || table.can_truncate) {
      errors.push(`AI_DATABASE_ROLE_UNSAFE_TABLE_PRIVILEGE:${table.relation_name}`);
    }
  }

  return Object.freeze({
    ...base,
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

export function evaluatePaperTradingDatabaseContract(snapshot, expectedDatabaseName) {
  const base = evaluateDatabaseContract(snapshot, expectedDatabaseName);
  const errors = base.errors.filter((error) =>
    !error.startsWith("DATABASE_ROLE_CAN_WRITE_TABLE:")
      && !error.startsWith("MISSING_SELECT_PRIVILEGE:")
  );
  const columnsByTable = new Map();
  for (const column of snapshot.columns) {
    if (!columnsByTable.has(column.table_name)) {
      columnsByTable.set(column.table_name, new Map());
    }
    columnsByTable.get(column.table_name).set(column.column_name, column.data_type);
  }
  for (const [tableName, expectedColumns] of Object.entries(REQUIRED_PAPER_TRADING_COLUMNS)) {
    const actualColumns = columnsByTable.get(tableName);
    for (const [columnName, dataType] of Object.entries(expectedColumns)) {
      if (!actualColumns?.has(columnName)) {
        errors.push(`MISSING_PAPER_TRADING_COLUMN:${tableName}.${columnName}`);
      } else if (actualColumns.get(columnName) !== dataType) {
        errors.push(`PAPER_TRADING_COLUMN_TYPE_MISMATCH:${tableName}.${columnName}`);
      }
    }
  }

  const privilegesByTable = new Map(
    snapshot.tablePrivileges.map((table) => [table.relation_name, table])
  );
  for (const tableName of PAPER_TRADING_READ_TABLES) {
    if (!privilegesByTable.get(tableName)?.can_select) {
      errors.push(`MISSING_PAPER_TRADING_SELECT_PRIVILEGE:${tableName}`);
    }
  }
  for (const tableName of PAPER_TRADING_INSERT_TABLES) {
    if (!privilegesByTable.get(tableName)?.can_insert) {
      errors.push(`MISSING_PAPER_TRADING_INSERT_PRIVILEGE:${tableName}`);
    }
  }
  for (const tableName of PAPER_TRADING_UPDATE_TABLES) {
    if (!privilegesByTable.get(tableName)?.can_update) {
      errors.push(`MISSING_PAPER_TRADING_UPDATE_PRIVILEGE:${tableName}`);
    }
  }
  for (const table of snapshot.tablePrivileges) {
    if (table.is_owner) {
      errors.push(`PAPER_TRADING_DATABASE_ROLE_TABLE_OWNER_NOT_ALLOWED:${table.relation_name}`);
    }
    if (table.can_insert && !PAPER_TRADING_INSERT_TABLES.includes(table.relation_name)) {
      errors.push(`PAPER_TRADING_DATABASE_ROLE_UNSAFE_INSERT_PRIVILEGE:${table.relation_name}`);
    }
    if (table.can_update && !PAPER_TRADING_UPDATE_TABLES.includes(table.relation_name)) {
      errors.push(`PAPER_TRADING_DATABASE_ROLE_UNSAFE_UPDATE_PRIVILEGE:${table.relation_name}`);
    }
    if (table.can_delete || table.can_truncate) {
      errors.push(`PAPER_TRADING_DATABASE_ROLE_UNSAFE_TABLE_PRIVILEGE:${table.relation_name}`);
    }
  }

  return Object.freeze({
    ...base,
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

const INGESTION_WARNING_PATTERNS = Object.freeze([
  /^MISSING_.*_CONSTRAINT:/,
  /^DATABASE_ROLE_CAN_WRITE_(TABLE|SEQUENCE):/,
  /^MISSING_FUNCTION:/,
  /^FUNCTION_CONTRACT_MISMATCH:/
]);

export function evaluateIngestionDatabaseContract(snapshot, expectedDatabaseName, {
  allowTableOwner = false
} = {}) {
  const base = evaluateDatabaseContract(snapshot, expectedDatabaseName);
  const warnings = base.errors.filter((error) =>
    INGESTION_WARNING_PATTERNS.some((pattern) => pattern.test(error))
  );
  const errors = base.errors.filter((error) => !warnings.includes(error));
  const ownershipWarnings = [];
  const privileges = new Map(
    snapshot.tablePrivileges.map((table) => [table.relation_name, table])
  );

  for (const table of snapshot.tablePrivileges) {
    if (table.is_owner && allowTableOwner && REQUIRED_TABLES.includes(table.relation_name)) {
      ownershipWarnings.push(
        `INGESTION_ROLE_TABLE_OWNER_ALLOWED:${table.relation_name}`
      );
    } else if (table.is_owner || table.can_delete || table.can_truncate) {
      errors.push(`INGESTION_ROLE_UNSAFE_TABLE_PRIVILEGE:${table.relation_name}`);
    }
  }

  for (const tableName of ["AI_Crypto_Bot_Market_Data", "AI_Crypto_Bot_Candles"]) {
    const table = privileges.get(tableName);
    if (!table?.can_insert || !table?.can_update) {
      errors.push(`MISSING_INGESTION_WRITE_PRIVILEGE:${tableName}`);
    }
  }

  return Object.freeze({
    ...base,
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze([...warnings, ...ownershipWarnings])
  });
}
