# AI Decision Archive Agent Proof of Concept

**Assessment date:** 2026-11-07  
**Status at assessment time:** The manual Pi CLI and its installation/validation guides had been generated, but the CLI had not been run when this 2026-11-07 assessment was written.

**Operational update (2026-11-09):** The user reports that the first manual sync succeeded and copied data from Supabase into PostgreSQL on the Pi. Exact row counts and run metrics were not provided or independently verified. The CLI remains manually invoked on the Pi and is not deployed to Vercel.

## Purpose and scope

Plan a manually invoked Raspberry Pi agent that reads `public."AI_Crypto_Bot_AI_Decisions"` from Supabase and copies those rows into `public."AI_Crypto_Bot_AI_Decisions"` in `ai_crypto_bot_archive`.

“Read-only” applies to Supabase: the source connection must be read-only and the agent may issue only read-only data queries plus transaction/session setup. It must never update or delete source rows, and this proof of concept must not delete archive rows.

The only dataset copied by the agent is `AI_Crypto_Bot_AI_Decisions`. It will not copy candles, trades, profiles, watched-market records, or any other table. No dashboard/API integration or scheduled execution is included. Supabase remains the live source of truth.

## Architecture

```text
Operator manually starts the agent on the Raspberry Pi
        │
        ├── TLS-verified connection using a dedicated read-only source credential
        │       └── Supabase: SELECT AI_Crypto_Bot_AI_Decisions only
        │
        ├── bounded batches, validation, and local checkpoint
        │
        └── TLS-verified connection using a separate archive-writer credential
                └── ai_crypto_bot_archive:
                    idempotent upsert into AI_Crypto_Bot_AI_Decisions
```

Keep the agent separate from the health HTTP service. Do not expose a synchronization endpoint through the existing health tunnel, add a Vercel Function, or run synchronization from AI analysis, candle refresh, or paper trading. The archive being offline must not affect those operations.

The existing `archive-server` package uses Node.js ES modules, requires Node.js 20.6 or newer, and depends on `pg`. The generated `src/archive-ai-decisions.mjs` CLI reuses that package and dependency. It remains a manual operator command only: no systemd timer, cron, or unattended retries.

## Dataset contract

Use one fixed table name and one explicit ordered column list:

1. `id`
2. `symbol`
3. `decision`
4. `confidence`
5. `indicators`
6. `reason`
7. `strategy_name`
8. `strategy_version`
9. `created_at`

The archive DDL defines the same fields and types as the production table:

- `id`: `uuid` primary key
- `symbol`, `decision`, `reason`, `strategy_name`, `strategy_version`: `text`
- `confidence`: `numeric(5,2)`
- `indicators`: `jsonb`
- `created_at`: `timestamptz`

Do not omit nullable strategy fields, regenerate IDs, substitute defaults for historical values, convert `confidence` to a JavaScript number, or round/format timestamps in application code. Preserve timestamp precision by reading timestamps as text (or configuring the driver to return them as text) and letting PostgreSQL parse the original value at the archive. Preserve JSONB numeric values by transferring `indicators` as JSON text and casting/storing it as JSONB on the target, rather than parsing arbitrary JSON numbers through JavaScript `Number`. PostgreSQL may normalize JSONB textual formatting/key order; validation should compare JSON values, not whitespace or key order.

The AI analysis write paths insert decisions into this table; the schema supplies UUID and `created_at` defaults. The application does not maintain an `updated_at` column for decisions. This makes `created_at` a suitable primary incremental key for the current append-oriented writer, but it does not detect arbitrary later edits or backdated inserts.

## Required environment variables

These are agent-only settings; this report does not provision or populate them. Store secrets in a service-account-readable mode-`0600` Pi environment file outside the repository. Never place them in Vercel, the browser, command-line arguments, logs, or checked-in environment templates.

| Variable | Required | Purpose |
|---|---:|---|
| `SUPABASE_ARCHIVE_READONLY_URL` | Yes | PostgreSQL connection URI for a dedicated Supabase identity that can read only the approved decision table. It must use verified TLS. |
| `SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF` | Yes | Approved Supabase project reference; the CLI requires it to match the direct database host. |
| `SUPABASE_ARCHIVE_READONLY_ROLE` | Yes | Exact database role in the URI username; `service_role` is rejected. |
| `SUPABASE_ARCHIVE_DECISION_READ_SCOPE_CONFIRMED` | Yes | Must be `true` after independently confirming the exact read scope and role-specific RLS policy; effective privileges are also checked by the CLI. |
| `SUPABASE_ARCHIVE_SSL_CA` | No | Trusted CA certificate path if the source certificate is not trusted by the Pi system store. |
| `SUPABASE_ARCHIVE_SSL_SERVERNAME` | No | Verified certificate DNS name when it differs from the source connection host. |
| `ARCHIVE_SYNC_DB_HOST` | Yes | Archive PostgreSQL host. |
| `ARCHIVE_SYNC_DB_PORT` | Yes | Archive PostgreSQL port; expected default is `5432`. |
| `ARCHIVE_SYNC_DB_NAME` | Yes | Must identify `ai_crypto_bot_archive`; fail closed on a mismatch. |
| `ARCHIVE_SYNC_DB_USER` | Yes | Dedicated archive sync writer, not a superuser. |
| `ARCHIVE_SYNC_DB_PASSWORD` | Yes | Archive sync writer password. |
| `ARCHIVE_SYNC_DB_SSL_CA` | No | Trusted archive PostgreSQL CA path when required. |
| `ARCHIVE_SYNC_DB_SSL_SERVERNAME` | No | Verified archive certificate DNS name when it differs from the host. |
| `ARCHIVE_SYNC_STATE_PATH` | Yes | Absolute checkpoint path outside the repository; the directory must be owned by the service account and mode `0700`. |
| `ARCHIVE_SYNC_BATCH_SIZE` | No | Bounded source/target batch size; default `250`, hard maximum `500`. |
| `ARCHIVE_SYNC_OVERLAP_SECONDS` | No | Re-read window before the saved timestamp watermark; default `86400` seconds, maximum `2592000`. |

### Credential readiness blocker

Do not use `SUPABASE_SERVICE_ROLE_KEY`: the repository documents that it bypasses RLS and has broad CRUD privileges. The current Supabase policies grant authenticated users read access to more than the decision table, so a normal authenticated JWT is not equivalent to a table-scoped credential. The repository does not document a dedicated direct-PostgreSQL read role for this agent.

Before any operational run, verify that the source credential can be constrained to `SELECT` on the decision table only. The generated CLI checks effective grants and a role-specific RLS policy, but it does not provision roles or policies. If access requires a new role, grant, policy, or read-only accessor, obtain separate approval for that database/security change. Do not silently widen access or assume that a secret URL is least-privilege.

The existing `ARCHIVE_DB_*` account is documented as a read-only health-check user. Do not elevate or reuse it for synchronization writes. The agent needs its own archive writer credential with only the required target-table insert/update rights.

## Synchronization and state model

### First run

1. Validate configuration, TLS, source and target identity, expected columns/types, and target constraints before copying.
2. Capture a fixed run cutoff so rows created while a long copy is running are picked up by a later manual run.
3. Read source rows in ascending `(created_at, id)` key order, bounded by `ARCHIVE_SYNC_BATCH_SIZE`. Use the source `created_at` index and keyset pagination; do not load the complete table into memory.
4. For each batch, validate fields and commit the target upserts in one archive transaction.
5. Only after the target transaction commits, atomically persist the last committed `(created_at, id)` cursor and run summary to the local state file.

### Reruns and incremental runs

Treat delivery as at-least-once. A later manual run re-reads from the saved high-water timestamp minus the configured overlap and upserts again. The overlap handles concurrent inserts and equal-timestamp boundary cases; the fixed `(created_at, id)` ordering makes pagination deterministic. The saved source project reference, target database identity, table name, and state-format version must match the current run or the agent must stop rather than resume against another project or database.

Persist at least:

- state format version and fixed table name
- non-secret Supabase project reference and expected archive database name
- current run cutoff and last committed `(created_at, id)` cursor
- completion/in-progress marker, last successful run time, and batch/row counters
- last validation summary and any non-secret error category

Do not store credentials, decision payloads, or raw database errors in the state file or logs. Use an exclusive process lock so two manual invocations cannot race on the same checkpoint.

The current application appends decisions and gives them a database-generated `created_at`, but no decision `updated_at` exists. This cursor model therefore assumes current application behavior continues to be append-only. It cannot discover an old row modified or inserted with an earlier timestamp outside the overlap. If that becomes possible, add a separately reviewed reconciliation mechanism before relying on completeness.

## Duplicate prevention and target upserts

- The archive table's primary key on the original `id` is the authoritative duplicate guard.
- Use an explicit target column list and `ON CONFLICT (id) DO UPDATE` for all copied fields. Replaying a committed batch is safe and refreshes the archive copy if a source row changed.
- Count rows read and rows successfully upserted per batch and in the run summary. A batch that rolls back must not advance the checkpoint.
- Do not use generated IDs, blind inserts, or a state cursor as the only duplicate protection.
- Do not delete rows or propagate source deletions.

## Important archive-schema dependency

The generated archive schema defines a foreign key from `AI_Crypto_Bot_AI_Decisions.symbol` to `AI_Crypto_Bot_Watched_Markets.symbol`. The schema DDL creates tables and constraints but does not seed market rows. Because this POC is restricted to copying decisions only, the agent must not insert market rows or disable/defer the foreign key.

Before the first write, verify that the archive already contains a watched-market anchor for every distinct `symbol` in the source decision cohort. If any are missing, stop before writing and request a decision: either separately authorize copying the minimal market identity rows, or revise the scope/schema through an approved process. Do not bypass referential integrity. The deployed archive contents have not been independently checked in this assessment.

## Batch logging and safety behavior

For each run, log structured, non-sensitive fields such as:

- run ID, dry-run/copy mode, source project reference, target database name, and table
- batch number, first/last cursor, source rows read, target rows upserted, and committed status
- elapsed time, last successful checkpoint, total run counts, and safe error category

Never log connection strings, credentials, bearer tokens, raw decision rows, JSON indicators, or unfiltered driver error details. A source-read, validation, TLS, FK, archive-write, checkpoint, or identity failure must return a non-success exit status and stop; it must not report a successful run. Keep source transactions read-only and never call analysis or paper-trading RPCs.

## Validation strategy

Validate locally and against a disposable PostgreSQL 17 test database before any authorized Pi copy:

1. **Schema/identity:** verify the source project reference, `ai_crypto_bot_archive` target database, exact nine-column contract, compatible PostgreSQL types, decision primary key, watched-market foreign key, and target-role privileges.
2. **Input checks:** reject null/invalid IDs, missing symbols/decisions/reasons/timestamps, invalid decision values, confidence outside 0–100, non-object JSON, or mismatched nullable strategy name/version.
3. **Target FK preflight:** compare the source decision symbols with target watched-market anchors; fail closed if any are missing.
4. **Counts and uniqueness:** compare source cohort count with rows selected and rows committed; assert target distinct-ID count equals target row count for the copied cohort. Check repeated runs do not increase the row count.
5. **Exact value checks:** compare IDs, decision fields, confidence decimal text/value, JSONB values, strategy snapshots, and timestamp instants with sub-millisecond precision preserved. Include boundary rows and representative rows across markets and decision values.
6. **Integrity summary:** compare min/max `created_at`, per-market counts, BUY/SELL/HOLD/WAIT counts, and a deterministic per-batch content digest computed from typed field values. Total row count alone is insufficient.
7. **Source immutability:** the source identity must be read-only and the code path must contain no source `INSERT`, `UPDATE`, `DELETE`, DDL, or RPC calls. Record source counts before/after a pilot only if a separately authorized read-only check is available.
8. **Failure tests:** simulate disconnects and process termination before target commit, after commit but before checkpoint update, and during checkpoint replacement. Confirm rollback or replay is safe and the source remains untouched.

Do not claim production completeness from a successful HTTP response, a process exit alone, matching total counts, or the archive health card. The health endpoint checks connectivity/database size; it does not verify copied rows.

## Recovery after interruption or failure

- **Failure before archive commit:** the transaction rolls back and the checkpoint remains at the previous batch. Rerun from that cursor.
- **Failure after archive commit but before state write:** rerun the batch. The primary-key upsert safely repeats it.
- **Checkpoint file missing/corrupt:** stop and preserve the file for diagnosis. Rebuild by rescanning from the beginning with upserts, or restore a known-good checkpoint; never guess a later cursor.
- **Source or target unavailable:** stop with a non-zero result; retain the last committed state and retry manually when service is restored.
- **Validation/FK/schema mismatch:** stop without advancing state. Correct the approved prerequisite, then resume or perform an intentional full replay.
- **Target backup/restore:** the copy is not the only backup. Before treating it as durable history, separately back up the archive and rehearse restoring it to an isolated PostgreSQL target.

## Implementation status and remaining gates

The generated CLI provides the fixed decision-table/column allowlist, source and archive identity/privilege checks, source RLS-policy check, TLS verification, watched-market FK preflight, bounded keyset batches, fixed run cutoff, overlap-based reruns, process locking, atomic checkpointing, per-batch target read-back, safe counters, and graceful signal handling. It has no dry-run mode; a first authorized run copies the eligible cohort.

Before any operational run:

1. Verify/provision through a separately approved process a source role scoped to read decisions only and a separate archive writer scoped to decisions plus watched-market reads. The CLI does not create roles or grants and fails closed if access is broader or insufficient.
2. Verify the direct TLS endpoints, deployed schema, target database identity, independent archive backup/restore, and all watched-market FK anchors.
3. Review the [installation guide](./AI_DECISION_ARCHIVE_AGENT_INSTALLATION.md) and [validation guide](./AI_DECISION_ARCHIVE_AGENT_VALIDATION.md); validate on a disposable PostgreSQL environment before production.
4. Run manually only after the owner separately authorizes execution. Keep Supabase source rows unchanged and do not add scheduling or deletion.

`tests/archive-ai-decisions.test.mjs` was added for config, value-validation, upsert, counter, TLS, and checkpoint behavior. Tests were not executed as part of the implementation request; no live database, Pi connectivity, or copy result is claimed.

## Decisions and evidence still needed

- Can the Supabase source identity be restricted to read-only access for this one table without using `service_role` or broad authenticated access?
- Are all referenced watched-market symbols already present in the archive? If not, is copying minimal market identity rows an approved scope expansion?
- What should the Pi's independent archive-writer credentials and backup/restore process be?
- What batch cap and overlap window are acceptable after measuring Pi memory and source query latency?
- Are decision rows guaranteed append-only and never backdated by any operational/manual process?
- The reported archive schema is not independently verified against the Pi; no live source/target counts, credentials, or connectivity were inspected for this report.

## References

- [Archive sync architecture](./ARCHIVE_SYNC_ARCHITECTURE.md)
- [Archive retention plan](./ARCHIVE_RETENTION_PLAN.md)
- [Archive schema analysis](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md)
- [Archive schema validation](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_VALIDATION.md)
- [Archive Server connectivity](./ARCHIVE_SERVER_CONNECTIVITY.md)
- [Archive Server monitoring](./ARCHIVE_SERVER_MONITORING.md)
- [Archive remote-access plan](./ARCHIVE_SERVER_REMOTE_ACCESS_PLAN.md)
- [Database documentation](../DATABASE.md)
- [API documentation](../API.md)
- [Deployment guide](../DEPLOYMENT.md)
- [AI decision writer](../../lib/ai-engine.mjs)
- [Archive schema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
- [Archive Server package](../../archive-server/package.json)
