# Archive POC Simplification Assessment

**Assessment date:** 2026-11-07  
**Mode:** Read-only repository/configuration assessment. No SQL was executed, no database was queried or changed, and no credentials, code, settings, or deployment were modified.

## Executive decision

A safe first copy can be simpler than a production synchronization service: use a manually started, bounded Pi CLI, copy a small decision batch, and keep a local checkpoint. However, the current “decisions only” scope has a foreign-key prerequisite: the target archive must already contain a watched-market row for each decision symbol. The minimum referentially valid copy is therefore either:

1. **Pre-seed the required `AI_Crypto_Bot_Watched_Markets` rows, then copy decisions**, or
2. Expand the POC to copy the required market rows first, then decisions.

No evidence confirms that those rows already exist in the Pi database.

The local `.env` has `SUPABASE_URL` and `SUPABASE_ANON_KEY`, but those alone cannot read the decision table: `anon` has no table grant. The existing bot uses `SUPABASE_SERVICE_ROLE_KEY` in server-side operations according to project documentation, but its deployed value was not verified and it must not be copied to the Pi or used for this POC because it has broad CRUD access and bypasses RLS. No suitable authenticated token or dedicated source reader was found locally.

**Conclusion:** the proof of concept needs a usable read-only source credential now. A permanent production credential lifecycle can be deferred, but under the approved least-privilege design, a table-scoped POC identity or equivalent restricted mechanism cannot be deferred. A temporary authenticated user JWT is technically possible only with explicit acceptance of its broader RLS-visible read access; it is not the recommended shortcut.

## Findings

### Existing Supabase credentials

The local environment was checked for credential variable names/presence only; secret values were not displayed.

| Credential/configuration | Finding | POC suitability |
|---|---|---|
| `SUPABASE_URL` and `SUPABASE_ANON_KEY` in local `.env` | Present locally. These identify the project and API role, but the schema revokes `anon` table access. | **Insufficient by themselves.** |
| Authenticated user access token | Not found in the inspected local environment. The normal authenticated role can read decisions, but its RLS grants cover more than this dataset. | **Possible only with explicit owner approval of broader read scope; not least-privilege.** |
| `SUPABASE_SERVICE_ROLE_KEY` | Required by existing server-side bot paths in project documentation; no value was found in the inspected local environment, and remote Vercel secrets were not checked. | **Do not use or transfer to the Pi.** It bypasses RLS and has broad CRUD privileges. |
| Dedicated read-only PostgreSQL/source credential | No such variable or role is documented in the inspected workspace. | **Not available locally; provision or independently confirm one.** |
| Archive sync writer credential | No `ARCHIVE_SYNC_DB_*` values are configured locally. The Pi `.env` is absent from the workspace. | **Not available locally; provision or independently confirm one.** |

This is not a claim about secret stores on the Pi, Vercel, or Supabase; those were not accessed.

### RLS and grants

The local migrations and [database documentation](../DATABASE.md) show that:

- RLS is enabled on `AI_Crypto_Bot_AI_Decisions` and `AI_Crypto_Bot_Watched_Markets`.
- `authenticated` has `SELECT` grants and policies allowing reads of all rows in both tables.
- `authenticated` also has read access to other global project tables and its own user-scoped data; that credential is not restricted to the archive POC tables.
- `anon` has no table privileges.
- `service_role` has server-side CRUD privileges and bypasses RLS.

A direct custom PostgreSQL reader would need database connect access, schema usage, and `SELECT` on the approved source tables, plus an RLS policy that permits that role without `BYPASSRLS`. A table grant alone does not bypass RLS. Any new source role/policy or grant is a database access-control change and requires separate review and authorization; none was applied here.

On the archive side, do not elevate the documented `ARCHIVE_DB_*` health-check account. The copy needs a separate writer. For the two-table minimal POC, that writer needs only the target-table access necessary to inspect market anchors and insert/update market anchors and decisions. It must not have `DELETE`, `TRUNCATE`, DDL, or superuser privileges.

## Can watched markets be copied first?

**Yes. This is the simplest way to satisfy the deployed archive schema without weakening its constraints.**

`AI_Crypto_Bot_AI_Decisions.symbol` references `AI_Crypto_Bot_Watched_Markets.symbol` with `ON DELETE RESTRICT`. Before inserting a decision, the matching target market row must exist. `strategy_name` and `strategy_version` are text snapshots, so `AI_Crypto_Bot_Strategies` is not a prerequisite. Profiles, portfolios, positions, candles, and trades are also not parents of a decision row.

The minimum market seed is every distinct symbol in the selected decision cohort. For a full decision-history copy, use every distinct source decision symbol, including symbols that are no longer enabled. The easiest safe POC is a small one-symbol decision cohort and its matching market row; after that succeeds, expand the market anchors and decision batches under the same validation rules.

This expands the prior decisions-only POC scope to include the minimum parent rows. If the requirement remains strictly “copy AI decisions only,” the market row must be pre-seeded separately before the agent runs. Do not disable or defer the foreign key.

The generated [archive schema DDL](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql) contains table definitions, not seed data. The five-market seed migration runs against Supabase and does not populate the Raspberry Pi. No live archive query was made, so current target market rows are **NOT VERIFIABLE**.

## A. Required Now

1. **Choose the POC access path.**
   - Recommended: provision or confirm a dedicated, table-scoped, read-only source identity for decisions and watched-market rows.
   - A dedicated *permanent production* role can be deferred, but only if the POC uses an already-issued authenticated JWT and the owner explicitly accepts that it can read other RLS-visible project data. No such JWT was found locally, so this is not currently an available shortcut.
   - Do not use the anon key alone, and do not move `SUPABASE_SERVICE_ROLE_KEY` to the Pi.
2. **Confirm/archive-seed market parents.** Run a later authorized read-only symbol comparison. If anchors are missing, either separately approve copying the minimal watched-market rows first or pre-seed them through an approved process. Stop on any missing symbol.
3. **Provide a separate target writer credential.** Keep it distinct from the health account; restrict it to the target tables needed by the POC.
4. **Confirm target identity/schema before writing.** Verify `ai_crypto_bot_archive`, the decision PK/FK, and type parity. These are currently owner-reported, not independently verified.
5. **Keep the POC manual and bounded.** Start with a small selected cohort, explicit columns, ID-based upserts, a fixed batch limit, and a local checkpoint. Log rows read/upserted and verify that a rerun does not increase duplicate counts.
6. **Keep source rows immutable.** Source queries are `SELECT` only; no source updates/deletes, archive deletions, scheduling, Vercel integration, or production cleanup.

## B. Required Before Production

- A durable dedicated source identity with narrowly scoped grants/RLS, documented ownership, rotation/revocation, verified TLS, and restricted network access.
- A separate archive writer role and verified target database grants. The Pi health role remains read-only.
- A verified initial market-symbol set and complete source/target integrity manifest for all decision rows: counts, timestamp range, per-market/action counts, ID uniqueness, field-level comparison, and deterministic checksums.
- Tested checkpoint recovery, interrupted-batch rollback/replay, single-run locking, and periodic reconciliation. `created_at` is the available decision timestamp; there is no `updated_at` to detect arbitrary old edits.
- Independent archive backup and a rehearsed isolated restore. A healthy `/api/health` response is not proof of copied-row integrity.
- Operational owner, failure alerting, source query/egress monitoring, and an approved sync cadence before unattended operation.
- Separate approval for any access-control migration or policy change. No production data deletions are part of this POC or implied by production readiness.

## C. Optional Improvements

- Add a dry-run/preflight mode that validates credentials, identities, target schema, and all required market anchors without writing rows.
- Add per-batch content hashes and a compact run manifest stored outside the repository.
- Add a later archive-aware Analytics/export path if product requirements call for querying history without restoring it.
- Consider scheduled execution, CDC, or more elaborate reconciliation only after the manual POC measures actual volume and operational need.

## Simplest safe first-copy sequence

1. Resolve the access decision and obtain a source identity that cannot write to Supabase.
2. Choose a single market for the first bounded sample. Read its watched-market parent row and a small decision batch.
3. If its market row is missing from the target, copy that row first under explicit two-table POC approval; otherwise verify the existing row matches the source symbol.
4. Upsert the selected decisions with original IDs and exact typed values. Commit each batch before checkpoint advancement.
5. Compare source/target counts and all copied fields, confirm the foreign key is satisfied, and rerun the same batch to prove idempotency.
6. Expand to additional market anchors and batches only after the first sample passes. Leave Supabase unchanged.

No step above was executed in this assessment.

## Overall classification

| Category | Assessment |
|---|---|
| Ready To Implement | **No, not with currently confirmed credentials or target data.** |
| Ready After Minor Changes | **No.** Safe access provisioning and required market anchors are unresolved; these are security/data prerequisites, not cosmetic changes. |
| Not Ready | **Yes, pending the Required Now actions.** |

## References

- [Archive agent POC plan](./ARCHIVE_AGENT_POC.md)
- [Archive agent deployment readiness](./ARCHIVE_AGENT_DEPLOYMENT_READINESS.md)
- [Archive sync architecture](./ARCHIVE_SYNC_ARCHITECTURE.md)
- [Archive retention plan](./ARCHIVE_RETENTION_PLAN.md)
- [Archive schema analysis](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md)
- [Archive schema validation](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_VALIDATION.md)
- [Archive Server connectivity](./ARCHIVE_SERVER_CONNECTIVITY.md)
- [Database documentation](../DATABASE.md)
- [Source schema migration](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql)
- [Initial market seed migration](../../PostgreSQL/migrations/20261031190100_seed_initial_data.sql)
- [Archive schema DDL](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
