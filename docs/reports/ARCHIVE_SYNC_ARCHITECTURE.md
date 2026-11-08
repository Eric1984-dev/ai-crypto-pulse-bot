# Archive Sync Architecture Assessment

**Assessment date:** 2026-11-07  
**Mode:** Read-only architecture assessment at the time of writing. No SQL was executed; no code, database, configuration, migration, or deployment was changed during that assessment.

**Operational update (2026-11-09):** The user reports that the first manual `npm run sync:ai-decisions` run succeeded and copied data to PostgreSQL on the Pi. Exact row metrics were not provided or independently verified. The CLI remains Pi-side; this update supersedes the earlier not-yet-run status but does not establish backup/restore readiness.

**Implementation update at assessment time:** The approved proof-of-concept scope was narrowed to AI decisions only, after watched-market seeding, and a manual Pi pull CLI was generated in `archive-server/src/archive-ai-decisions.mjs`. The CLI had not been run or deployed when this 2026-11-07 assessment was written.

## Executive recommendation

**Recommend option B: a Raspberry Pi-initiated pull from Supabase using a dedicated, least-privilege read-only source credential.**

Run one small archive agent on the Pi, independently of Vercel's AI-analysis and paper-trading jobs. The Pi should initiate outbound, certificate-verified connections to Supabase, read only the approved archival tables in bounded batches, and write them to the local archive database. Supabase remains the live source of truth; the archive is a secondary, eventually consistent copy. Keep the existing HTTPS tunnel for health monitoring only.

Do **not** copy `SUPABASE_SERVICE_ROLE_KEY` to the Pi. It bypasses RLS and would expose broad production access if the Pi or its environment file were compromised. Before any operational run, confirm that a direct read path can be restricted to the decision table. If that cannot be achieved safely under the current RLS/connection model, do not deploy or execute direct pull; seek separate approval for a constrained relay instead of substituting the service-role key.

Vercel push is not recommended as the initial design. Vercel currently has 12 API functions, the project forbids adding another `/api` function without explicit approval, and the Pi tunnel exposes only the health route. Push would require a new authenticated ingestion surface or coupling archive writes to existing scheduled/trading handlers, increasing failure and maintenance risk.

## Scope, assumptions, and current state

- The user reports that the Raspberry Pi archive database and schema have been deployed. This report does not independently verify them.
- The user states that an HTTPS tunnel architecture exists for health monitoring. Prior repository documents describe that architecture, but also state that production tunnel connectivity was not verified. This assessment treats the tunnel as a design premise, not as verified live infrastructure.
- The existing Pi service accepts `GET /api/health`. Its database check reads the configured database name and size; it does not ingest rows or validate the archive schema. The Vercel dashboard proxy only consumes this health response.
- At the time of this assessment, a repository search found no archive synchronization implementation. A manual copy-only AI-decision CLI has since been generated; it does not add archive reads to the application or replace the separate restore/backup requirements.
- Existing production measurements in prior reports are historical and are not used here as current volume or cost estimates. No Supabase connection or query was made.

## Option comparison

| Area | A. Vercel pushes to the Pi | B. Pi pulls from Supabase |
|---|---|---|
| Security boundary | Supabase credentials can remain in Vercel, but a write-capable Pi ingestion path must be reachable through the tunnel. It needs a separately scoped token, strict method/path/body limits, validation, replay protection, and a writer role. The current health-only route is not that path. | The Pi needs a source credential, but it can be read-only and limited to explicitly approved source tables. No public archive write endpoint is needed. A service-role key on the Pi is unacceptable; if a narrow read-only role cannot be established, do not proceed with direct pull. |
| Vercel CPU/function impact | Each batch consumes function time for source reads, serialization, network transfer, and error handling. Adding a dedicated API file is blocked by the current 12-function count unless the user approves and another function is removed/reused. Adding archive work to AI, candle-refresh, or paper-trading paths risks extending critical jobs. | No archive-sync Vercel function or serverless CPU is required. The Pi owns batching, retries, and target writes. |
| Supabase load | Still requires source reads unless payloads are passed directly from each writer. Hooking every writer is complex and can add latency to trading/analysis. | Adds bounded read queries and outbound data transfer from Supabase. Incremental indexed reads and low concurrency are required; a full-table scan on every run would be wasteful. |
| Failure recovery | If the Pi/tunnel is unavailable, the push caller needs a durable queue or reliable scheduled replay. Vercel function memory is not a durable queue. A failed transfer must never fail or delay paper trading. | The Pi retries when Supabase or the archive is unavailable. It can resume from a durable checkpoint; Supabase remains unchanged and trading is independent. |
| Incremental sync | Can send just-written rows, but each writer must reliably capture them and handle retries, duplicates, and delivery after an invocation ends. No shared outbox exists. | A single agent can apply per-table cursors, overlap windows, idempotent upserts, and reconciliation consistently. Candle timestamps require special handling because they are bar time, not insertion time. |
| Operations | Requires a Pi ingestion service exposed through the tunnel, Vercel-side transport/auth, and decisions about which existing endpoint owns each dataset. | Requires a systemd service/timer, a protected source credential, checkpointing, and local monitoring. It does not depend on Vercel schedules or a public Pi ingestion route. |
| Cost | Same source data volume, plus Vercel execution and Vercel-to-Pi transfer. A new endpoint could also consume scarce function capacity. | No Vercel execution or Vercel egress for archive transfer. Supabase query/egress usage and Pi storage/backup costs remain. |
| Consistency | Delivery may be interleaved with source writes; each handler needs a stable cutoff and replay-safe payload. | A read-only source snapshot can provide a consistent initial copy. Incremental runs can use bounded cutoffs, deterministic keyset pagination, and reconciliation. |
| Scalability | Serverless parallelism can scale, but consumes function resources and requires a durable retry strategy and new API surface. | A single Pi worker can be rate-limited and checkpointed. It is simpler at current scale, but archive storage, backup, and catch-up capacity need monitoring as history grows. |

Both options ultimately read the same source history and transfer the same records unless synchronization is integrated into the writers. Neither inherently reduces Supabase query load or egress. The key distinction is where the synchronization workload and credentials live.

## Security design

### Source access on the Pi

1. Provision a separate Supabase read identity limited to the required archive source tables and columns. Prefer a database role with `SELECT` only and no write, DDL, role-management, or delete privileges.
2. Verify how the role interacts with the project's RLS policies before use. Do not grant broad RLS bypass simply to make synchronization work. If the required scope cannot be achieved safely, defer implementation or seek approval for a constrained server-side relay.
3. Use TLS with certificate verification. Restrict outbound access from the Pi to the required Supabase host/port where practical. Do not expose the Pi's PostgreSQL port to the Internet.
4. Store source credentials outside the repository in a root-owned, service-readable environment file. Do not place them in dashboard/Vercel configuration, source control, process arguments, or logs.
5. Keep source-read credentials separate from the archive database writer credentials and from the existing health-check identity. The health account's size-check permissions are not sync permissions.

### Archive writes on the Pi

- Use a dedicated archive writer with insert/update privileges only on the approved archive tables and any sync-state metadata. It must not be a PostgreSQL superuser.
- Validate table names, column sets, types, row limits, and required fields against a fixed allowlist. Do not accept arbitrary SQL or arbitrary table names from the network.
- Preserve the original UUIDs, timestamps, numeric precision, JSONB values, and unique keys. Use duplicate-safe upserts where source rows can be replayed or corrected.
- The archive schema omits Supabase RLS, functions, and triggers. Configure local ownership and grants separately; do not use the archive database as a live application database.
- Do not add a public sync endpoint to the Pi for option B. The existing health tunnel is not required for sync and should remain a separate, read-only path.

## Vercel CPU, Supabase load, and cost

### Vercel

For option B, archive work runs on the Pi, so it does not consume Vercel function execution time or require a new Vercel route. The dashboard's existing five-minute health polling remains independent.

For option A, Vercel would query/serialize data and transmit it to the tunnel. The current API count is 12. A new `/api` file is not available under the project's stated Hobby constraint without explicit approval and a function-count/reuse decision. Extending `/api/ai-analysis`, `/api/candle-refresh`, or `/api/paper-trading` risks making archive availability part of operational execution; such endpoints must not wait for, or fail because of, an archive transfer.

### Supabase

Option B still causes database reads and network egress. Keep the load bounded:

- Perform a one-time baseline copy, then use indexed keyset batches rather than repeatedly scanning complete histories.
- Run one agent instance at a time with low concurrency, backoff, and a configurable batch size.
- Set a lag objective before choosing a timer cadence. Archive sync is cold-history work, not a prerequisite for each paper trade.
- Record rows read, rows written, bytes transferred when measurable, lag, and query duration. Do not call serialized payload estimates billed egress.

Option A also needs Supabase reads unless the applications' write handlers send the records directly. That alternative would couple several independent writers to the archive and still require retry-safe durable delivery.

### Cost

No current sync-volume, Supabase billing, Raspberry Pi capacity, or backup-cost measurement was taken, so no cost estimate is justified. The likely cost components are:

- **B:** Supabase query/egress usage, Pi disk and power, and an independent archive backup.
- **A:** the same source-data egress, plus Vercel compute/egress and additional tunnel/ingestion operations.

The Pi is already reported deployed, so the main new cost is its storage growth and a second recoverable copy. Cost must be measured during a copy-only pilot before setting a permanent cadence or retention policy.

## Consistency, incremental synchronization, and recovery

Supabase remains canonical. Treat synchronization as **at-least-once delivery with idempotent writes**, not as exactly-once replication. Never delete or modify source rows as part of synchronization.

### Initial copy

1. Approve an explicit table/data allowlist. Start with the historical candle cohort and the watched-market identity rows needed by its foreign key. Do not mirror all 18 tables merely because the archive schema contains them.
2. Take a consistent read-only source snapshot or establish a fixed cutoff for keyset-paginated reads. Record the source project reference, schema version, cutoff, table counts, timestamp ranges, per-market/interval counts, and deterministic chunk checksums.
3. Load parent/reference rows before dependent rows. For a full history copy, follow the archive schema's dependency order: Auth UUID anchor/profile (if profiles are included), watched markets and strategies, portfolios, positions/market data/candles/decisions, trades, dependent history/snapshots/events, then shadow scenarios and events.
4. Compare source and archive IDs, counts, checksums, type/constraint validity, foreign-key closure, and representative query results. Restore from the stored archive backup into an isolated PostgreSQL target and repeat those checks.

### Incremental agent

Run one dedicated Pi service under a systemd timer. A conservative first pilot can run hourly; use a shorter interval only if an approved recovery-point objective requires it. Prevent overlapping runs with a process lock.

The agent should have these components:

1. **Configuration and credential loader:** fixed source/target endpoints, TLS verification, table allowlist, batch limits, and secret-file permissions.
2. **Sync planner:** per-table strategy and watermark; only approved historical tables are eligible.
3. **Source reader:** read-only, keyset-paginated queries with a run cutoff and bounded batch size.
4. **Validator:** schema version and field checks; counts and deterministic chunk checksums.
5. **Archive writer:** explicit typed inserts/upserts in bounded transactions, with FK-safe ordering.
6. **Checkpoint and manifest store:** persist last committed cursor and run summary on the Pi. Advance a cursor only after its archive transaction commits. A crash before cursor persistence may replay rows; unique keys/upserts must make that safe.
7. **Retry and observability:** exponential backoff with jitter, safe error categories, last-success time, current lag, counts, duration, and no secrets or raw sensitive rows in logs.

Use table-specific watermarks:

- Append-oriented decisions, trades, snapshots, and events can use stable timestamp-plus-ID keysets with a small overlap and duplicate-safe writes.
- Mutable rows must be re-read using a reliable update/capture timestamp and upserted; do not assume inserts-only behavior for portfolio, position, watched-market, status, market-data, or scenario rows.
- Candles are keyed by `(symbol, interval, timestamp)`, but the timestamp is the bar time and existing rows may be corrected or historical rows backfilled. Re-read an overlap window and upsert recent rows, then periodically reconcile older date partitions. A single maximum candle timestamp is not sufficient to detect late backfills or old holes.
- Do not propagate source deletes. Any future deletion/tombstone behavior needs a separate policy and review.

An agent failure must not change the live bot, AI analysis, risk controls, or scheduler outcomes. If the Pi is offline, sync pauses and resumes later; Supabase retains the source rows. Do not begin source deletion until archive lag is zero for the approved cohort and a fresh integrity/restore check passes.

## Long-term maintainability and scale

- Keep the sync agent independent from market analysis, paper trading, and the dashboard. The application must never depend on the archive being online.
- Version the sync manifest and table mappings. Fail closed on unknown schema versions or unexpected columns instead of silently omitting data.
- Monitor archive disk headroom, backup age, restore test results, sync lag, failed batches, and source egress. Alert before capacity or retention thresholds are reached.
- Keep operational metadata distinct from mirrored source data. If a target-side sync-state table is used, apply the `AI_Crypto_Bot_` naming convention; a durable local state file is also viable if it is atomically updated after target commits and can be rebuilt safely.
- At larger volumes, reassess partitioned exports or PostgreSQL replication/CDC only after measuring polling load and defining recovery semantics. Do not add CDC/WAL replication for the current proof of concept without evidence that incremental polling is insufficient.

## Implementation sequence

1. Confirm the direct Supabase read path, RLS behavior, TLS/network access, least-privilege source role, and separate archive writer role. Do not use the service-role key on the Pi.
2. The approved first proof-of-concept allowlist is `AI_Crypto_Bot_AI_Decisions`; its watched-market anchors were copied separately. This scope does not include candles or a retention policy.
3. The manual Pi CLI and local checkpoint implementation have been generated. No Vercel route or trading-handler changes are needed.
4. Copy without deletion, validate counts/checksums/FKs, restore to an isolated target, and compare representative historical queries.
5. Run incremental synchronization in parallel with unchanged Supabase retention. Observe lag, source query cost, archive disk growth, retries, and backup restoration.
6. Only after a separate review, prepare a deletion preflight for exact eligible IDs and their user-visible impacts. Deletion requires explicit approval and is outside this assessment.

## Readiness decision

| Area | Assessment |
|---|---|
| Preferred direction | B: Pi-initiated pull |
| Safe source credential | Not present/configured in repository; must be separately provisioned and scoped |
| Existing tunnel | Health architecture only; not a data-ingestion service and not needed for pull |
| Vercel capacity | 12 functions; avoid new route and avoid coupling archive writes to trading/analysis |
| Archive schema | User-reported deployed; not independently verified in this read-only assessment |
| Sync implementation/checkpoints | Manual decision-only CLI and local checkpoint generated; unrun and not production-validated |
| Current production data consistency/cost | Not measured for this assessment |
| Data deletion | Not authorized |

**Conclusion:** A Pi-owned pull agent is the better operational boundary, provided it uses a truly restricted read-only source identity and a separate local writer. If those privileges cannot be established without exposing a broad Supabase credential, do not run the generated direct-pull CLI; return for a constrained relay design decision. Keep the archive a non-authoritative cold copy until copy, integrity, backup, and restore procedures are proven.

## References

- [Archive retention plan](./ARCHIVE_RETENTION_PLAN.md)
- [Archive schema analysis](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md)
- [Archive schema validation](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_VALIDATION.md)
- [Archive Server connectivity](./ARCHIVE_SERVER_CONNECTIVITY.md)
- [Archive Server monitoring](./ARCHIVE_SERVER_MONITORING.md)
- [Archive Server remote-access plan](./ARCHIVE_SERVER_REMOTE_ACCESS_PLAN.md)
- [Database documentation](../DATABASE.md)
- [Deployment guide](../DEPLOYMENT.md)
- [Scheduling guide](../SCHEDULING.md)
- [API documentation](../API.md)
- [Archive health service](../../archive-server/src/server.mjs), [health handler](../../archive-server/src/health.mjs), [dashboard proxy](../../lib/archive-server-health.mjs)
- [Archive schema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
