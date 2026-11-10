import {
  REQUIRED_TABLES,
  REQUIRED_FUNCTION_CONTRACTS,
  OPTIONAL_FUNCTION_CONTRACTS
} from "../services/database-contracts.mjs";
import { withReadOnlyTransaction } from "../database/read-only-transaction.mjs";

const TABLE_NAMES = Object.freeze([...REQUIRED_TABLES]);
const FUNCTION_NAMES = Object.freeze([
  ...REQUIRED_FUNCTION_CONTRACTS,
  ...OPTIONAL_FUNCTION_CONTRACTS
].map(({ name }) => name));

const CONNECTION_SQL = `
  SELECT current_database() AS database_name,
         current_user AS role_name,
         current_setting('default_transaction_read_only') AS default_transaction_read_only,
         current_setting('transaction_read_only') AS transaction_read_only,
         role.rolsuper AS is_superuser,
         role.rolbypassrls AS bypasses_rls,
         role.rolcreatedb AS can_create_database,
         role.rolcreaterole AS can_create_role,
         pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
           AS can_create_objects_in_public
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = current_user
`;

const TABLES_SQL = `
  SELECT relation.relname AS relation_name
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = $1
    AND relation.relname = ANY($2::text[])
    AND relation.relkind IN ('r', 'p')
  ORDER BY relation.relname
`;

const COLUMNS_SQL = `
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = $1
    AND table_name = ANY($2::text[])
  ORDER BY table_name, ordinal_position
`;

const CONSTRAINTS_SQL = `
  SELECT relation.relname AS relation_name,
         constraint_row.contype AS constraint_type,
         ARRAY_AGG(attribute.attname::text ORDER BY key_column.ordinality) AS columns
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL
    pg_catalog.unnest(constraint_row.conkey) WITH ORDINALITY
      AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attnum = key_column.attnum
  WHERE namespace.nspname = $1
    AND relation.relname = ANY($2::text[])
    AND constraint_row.contype IN ('p', 'u')
  GROUP BY relation.relname, constraint_row.contype, constraint_row.oid
  ORDER BY relation.relname, constraint_row.contype
`;

const TABLE_PRIVILEGES_SQL = `
  SELECT relation.relname AS relation_name,
         (relation.relowner = current_role_oid.role_oid) AS is_owner,
         pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select,
         pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert,
         pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE') AS can_update,
         pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE') AS can_delete,
         pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE') AS can_truncate
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL (
    SELECT oid AS role_oid
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
  ) AS current_role_oid
  WHERE namespace.nspname = $1
    AND left(relation.relname, length($2)) = $2
    AND relation.relkind IN ('r', 'p')
  ORDER BY relation.relname
`;

const SEQUENCE_PRIVILEGES_SQL = `
  SELECT sequence.relname AS relation_name,
         (sequence.relowner = current_role_oid.role_oid) AS is_owner,
         pg_catalog.has_sequence_privilege(current_user, sequence.oid, 'USAGE') AS can_use,
         pg_catalog.has_sequence_privilege(current_user, sequence.oid, 'UPDATE') AS can_update
  FROM pg_catalog.pg_class AS sequence
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = sequence.relnamespace
  CROSS JOIN LATERAL (
    SELECT oid AS role_oid
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
  ) AS current_role_oid
  WHERE namespace.nspname = $1
    AND left(sequence.relname, length($2)) = $2
    AND sequence.relkind = 'S'
  ORDER BY sequence.relname
`;

const FUNCTIONS_SQL = `
  SELECT proc.proname AS function_name,
         pg_catalog.oidvectortypes(proc.proargtypes) AS argument_types,
         pg_catalog.pg_get_function_result(proc.oid) AS result_type,
         proc.prokind AS function_kind,
         proc.prosecdef AS security_definer
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = $1
    AND proc.proname = ANY($2::text[])
  ORDER BY proc.proname, argument_types
`;

export async function inspectDatabaseContract(pool, expectedRoleName, {
  schemaName = "public",
  logger = console
} = {}) {
  return withReadOnlyTransaction(pool, async (client) => {
    const connection = await client.query(CONNECTION_SQL);
    const tables = await client.query(TABLES_SQL, [schemaName, TABLE_NAMES]);
    const columns = await client.query(COLUMNS_SQL, [schemaName, TABLE_NAMES]);
    const constraints = await client.query(CONSTRAINTS_SQL, [schemaName, TABLE_NAMES]);
    const tablePrivileges = await client.query(TABLE_PRIVILEGES_SQL, [schemaName, "AI_Crypto_Bot_"]);
    const sequencePrivileges = await client.query(SEQUENCE_PRIVILEGES_SQL, [schemaName, "AI_Crypto_Bot_"]);
    const functions = await client.query(FUNCTIONS_SQL, [schemaName, FUNCTION_NAMES]);

    return Object.freeze({
      expectedRoleName,
      connection: connection.rows[0] || {},
      tables: tables.rows,
      columns: columns.rows,
      constraints: constraints.rows,
      tablePrivileges: tablePrivileges.rows,
      sequencePrivileges: sequencePrivileges.rows,
      functions: functions.rows
    });
  }, { logger });
}
