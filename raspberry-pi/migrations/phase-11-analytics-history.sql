BEGIN;

DO $migration$
DECLARE
  v_dashboard_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.dashboard_database_user', true),
    ''
  );
  v_writer_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.analytics_database_user', true),
    ''
  );
  v_paper_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.paper_trading_database_user', true),
    ''
  );
  v_dashboard_role_oid oid;
  v_writer_role_oid oid;
  v_dashboard_role_ok boolean;
  v_writer_role_ok boolean;
BEGIN
  IF v_dashboard_role_name IS NULL
    OR v_writer_role_name IS NULL
    OR v_paper_role_name IS NULL THEN
    RAISE EXCEPTION
      'Set the dashboard, analytics-writer, and paper-trading database user settings before applying this migration.';
  END IF;

  IF v_dashboard_role_name = v_writer_role_name
    OR v_dashboard_role_name = v_paper_role_name
    OR v_writer_role_name = v_paper_role_name THEN
    RAISE EXCEPTION
      'Dashboard, analytics-writer, and paper-trading database roles must be distinct.';
  END IF;
  IF current_user IN (v_dashboard_role_name, v_writer_role_name) THEN
    RAISE EXCEPTION
      'Apply this migration as a schema owner, not as a runtime database role.';
  END IF;

  SELECT role_row.oid,
         role_row.rolcanlogin AND NOT role_row.rolsuper
           AND NOT role_row.rolcreatedb AND NOT role_row.rolcreaterole
           AND NOT role_row.rolbypassrls
  INTO v_dashboard_role_oid, v_dashboard_role_ok
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = v_dashboard_role_name;

  IF NOT FOUND OR NOT v_dashboard_role_ok THEN
    RAISE EXCEPTION
      'Configured DATABASE_USER role "%" must exist as a restricted login role.',
      v_dashboard_role_name;
  END IF;

  SELECT role_row.oid,
         role_row.rolcanlogin AND NOT role_row.rolsuper
           AND NOT role_row.rolcreatedb AND NOT role_row.rolcreaterole
           AND NOT role_row.rolbypassrls
  INTO v_writer_role_oid, v_writer_role_ok
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = v_writer_role_name
    AND role_row.rolcanlogin
    AND NOT role_row.rolsuper
    AND NOT role_row.rolcreatedb
    AND NOT role_row.rolcreaterole
    AND NOT role_row.rolbypassrls;

  IF NOT FOUND OR NOT v_writer_role_ok THEN
    RAISE EXCEPTION
      'Configured ANALYTICS_DATABASE_USER role "%" must exist as a restricted login role.',
      v_writer_role_name;
  END IF;

  IF pg_catalog.has_schema_privilege(v_dashboard_role_name, 'public', 'CREATE')
    OR pg_catalog.has_schema_privilege(v_writer_role_name, 'public', 'CREATE') THEN
    RAISE EXCEPTION
      'Dashboard and analytics-writer roles must not create objects in the public schema.';
  END IF;
END;
$migration$;

CREATE TABLE public."AI_Crypto_Bot_Analytics_Runs" (
  id uuid NOT NULL,
  calculation_version text NOT NULL,
  period text NOT NULL,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  generated_at timestamp with time zone NOT NULL,
  source_counts jsonb NOT NULL,
  analytics_summary jsonb NOT NULL,
  insights jsonb NOT NULL,
  CONSTRAINT "AI_Crypto_Bot_Analytics_Runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "AI_Crypto_Bot_Analytics_Runs_period_check"
    CHECK (period IN ('30d', '90d', '365d')),
  CONSTRAINT "AI_Crypto_Bot_Analytics_Runs_window_check"
    CHECK (period_start < period_end AND generated_at >= period_end),
  CONSTRAINT "AI_Crypto_Bot_Analytics_Runs_source_counts_check"
    CHECK (pg_catalog.jsonb_typeof(source_counts) = 'object'),
  CONSTRAINT "AI_Crypto_Bot_Analytics_Runs_summary_check"
    CHECK (pg_catalog.jsonb_typeof(analytics_summary) = 'object'),
  CONSTRAINT "AI_Crypto_Bot_Analytics_Runs_insights_check"
    CHECK (pg_catalog.jsonb_typeof(insights) = 'object'),
  CONSTRAINT "AI_Crypto_Bot_Analytics_Runs_window_unique"
    UNIQUE (calculation_version, period_start, period_end)
);

CREATE INDEX "AI_Crypto_Bot_Analytics_Runs_generated_at_idx"
  ON public."AI_Crypto_Bot_Analytics_Runs" (generated_at DESC, id DESC);

DO $migration$
DECLARE
  v_dashboard_role_name text := pg_catalog.current_setting(
    'cryptopulse.dashboard_database_user'
  );
  v_writer_role_name text := pg_catalog.current_setting(
    'cryptopulse.analytics_database_user'
  );
BEGIN
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', v_dashboard_role_name);
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', v_writer_role_name);
  EXECUTE pg_catalog.format(
    'GRANT SELECT ON TABLE public."AI_Crypto_Bot_Analytics_Runs" TO %I',
    v_dashboard_role_name
  );
  EXECUTE pg_catalog.format(
    'GRANT INSERT ON TABLE public."AI_Crypto_Bot_Analytics_Runs" TO %I',
    v_writer_role_name
  );

  IF NOT pg_catalog.has_table_privilege(
       v_dashboard_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       v_dashboard_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       v_dashboard_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       v_dashboard_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       v_dashboard_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       v_dashboard_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       v_dashboard_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'TRIGGER'
     )
     OR NOT pg_catalog.has_table_privilege(
       v_writer_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       v_writer_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       v_writer_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       v_writer_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       v_writer_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       v_writer_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       v_writer_role_name,
       'public."AI_Crypto_Bot_Analytics_Runs"',
       'TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'Analytics roles must have dashboard SELECT-only and writer INSERT-only access.';
  END IF;
END;
$migration$;

COMMIT;
