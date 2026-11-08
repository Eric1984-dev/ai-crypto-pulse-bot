# Supabase Historical Data Archive Destination Assessment

**Assessment date:** 2026-11-06  
**Production project checked:** `jgnuhgsceilhxugffauj`  
**Scope:** Read-only feasibility assessment. No production data was exported, copied, deleted, or changed. No cloud resources, settings, schema, code, or deployments were changed.

## Executive summary

Archiving historical candles can be separated from live bot operation if the current operational candle windows remain in Supabase. Decisions are different: at this snapshot, all 162,078 decisions are within the current 365-day Analytics period. Removing any of them would make at least one current history surface incomplete, even if the remaining decisions were enough for the bot to trade.

The least-risk destination for infrequently accessed history is private object storage containing a versioned, compressed PostgreSQL archive and an integrity manifest. It is not directly SQL-queryable: manual analysis requires restoring the archive to a compatible PostgreSQL database. Azure Database for PostgreSQL and Neon are viable SQL-queryable alternatives, but neither should replace Supabase for live trading. Azure’s 12-month offer is conditional and its minimum provisioned database storage is disproportionate to the current archive. Neon’s free tier is convenient for occasional queries, but its storage and backup limits are not suitable as the sole long-term archive.

**Recommendation:** begin only with an authorized copy-only proof of concept. Restore and validate that copy in isolation, then test historical queries. Keep decisions online until Analytics and exports have an archive-aware path or an explicit retention policy is approved. Any deletion requires a separate preflight and explicit approval.

## Production evidence and limits

The project identity was confirmed as `jgnuhgsceilhxugffauj`. The findings below come from read-only database metadata and aggregate queries, not from an export. The snapshot is approximate to **2026-11-06 19:17 UTC**; live counts can change as scheduled jobs run.

| Dataset | Rows | Timestamp range (UTC) | PostgreSQL relation size | Summed row payload |
|---|---:|---|---:|---:|
| `AI_Crypto_Bot_AI_Decisions` | 162,078 | 2026-11-01 05:57:38.832659 – 2026-11-06 19:16:09.8565 | 350,445,568 bytes | 278,349,360 bytes |
| `AI_Crypto_Bot_Candles` | 551,380 | 2025-06-13 – 2026-11-06 19:15 | 131,555,328 bytes | 55,012,602 bytes |
| **Combined** | **713,458** | — | **482,000,896 bytes** | **333,361,962 bytes** |

The measured whole-database size was **497,175,699 bytes** (about 497.2 decimal MB). The two relation sizes include PostgreSQL table/TOAST and index storage; the summed row-payload figures do not. Neither is a measured export-file size or a promise of how much Supabase storage deletion would reclaim.

There were **102 enabled markets**, each with a latest decision. **Five** decisions were referenced by trades, and **five** positions were open. No decision was older than 365 days at the snapshot.

### Conservative runtime retention estimate

These are candidate cohorts calculated from current runtime read limits, not approved deletion sets:

| Dataset | Conservative online set | Candidate outside that set | Candidate row-payload estimate |
|---|---:|---:|---:|
| Decisions | Newest 5,000 plus 5 trade-referenced decisions (5,005 rows in the observed result) | 157,073 rows | 269,491,432 bytes |
| Candles | 298,552 rows: newest 500 per symbol/interval plus scanner windows | 252,828 rows | 24,303,588 bytes |

The candle candidate counts by interval were: 1m 135,967; 5m 69,292; 15m 34,558; 1h 9,586; 4h 3,095; 1d 330. The runtime set includes the market scanner’s 32-day daily and 10-hour hourly lookbacks. The latest 500-per-market/interval rule is deliberately more conservative than the AI engine’s 150-candle limit.

The runtime-only decision cohort is **not** a safe deletion cohort: all decisions are currently inside Analytics’ 365-day window, and the dashboard count and default decision export also read Supabase. A copy-only archive would not itself cause those surfaces to change.

### Growth observation

A prior point-in-time aggregate from approximately 10:02 UTC showed a database size of 469,331,091 bytes, 150,960 decisions, and 530,614 candles. By approximately 19:17 UTC, the corresponding values were 497,175,699 bytes, 162,078 decisions, and 551,380 candles. That is about **27.8 MB of whole-database size growth over 9.25 hours**. A naive linear annualization is roughly 26.4 GB/year, but this short interval is not a forecast or a table-only archive estimate: scheduled workload, retention, table churn, and storage maintenance can change the rate materially. It does show why free-tier capacity and archive growth need monitoring.

## What must remain in Supabase

### Bot runtime

- Keep all enabled rows in `AI_Crypto_Bot_Watched_Markets`; it is the active market universe and is referenced by decisions and candles.
- Keep each enabled market’s latest decision, plus the newest 5,000 decisions used by scanner logic. Keep every decision referenced by a trade. Trade rows have a foreign key to decisions with `ON DELETE RESTRICT`; an archive copy does not satisfy that foreign key.
- Keep current candles needed by the AI, scanner, and market-detail paths. The AI engine reads up to 150 newest candles per market and interval; market detail can request up to 500. Scanner logic reads the recent daily and hourly windows. Retaining the observed 500-per-symbol/interval set plus scanner windows preserves these current read paths.
- Keep current market snapshots, portfolio, positions, trades, and other operational records in Supabase. They are not candidates in this assessment.

These floors are based on current code and production state; they are not a substitute for rechecking requirements immediately before any retention change.

### Historical and user-facing behavior

- `lib/analytics.mjs` supports 30-, 90-, and 365-day periods and pages through decisions, trades, and portfolio history in the selected period. Removing decisions in those periods would make analytics incomplete.
- `api/dashboard-data.mjs` reads a bounded recent decision list and exposes decision totals/operational data from Supabase. Moving rows without changing the read path will reduce or otherwise distort those Supabase-only totals.
- `lib/exports.mjs` defines an all-time decision export by default, including indicators and reason. Archived rows would be omitted from that export unless it is extended.
- `lib/market-data.mjs` reads active-market data and the scanner’s candle windows from Supabase. Historical candles outside those windows are not needed by those current live reads, but future backtesting and manual research would need an archive-aware reader or a restore.
- Phase 16 explicitly calls for simulation against historical AI and paper-trading data. The archive is not currently a substitute for that phase’s source queries.

The current analytical and export paths do not read Azure, Neon, or object storage. To include archived records in Dashboard Analytics or exports, code must be changed to securely merge/restore archive data while preserving date filters, pagination, counts, authorization, and ordering. Prefer extending existing data paths such as `/api/dashboard-data` and the existing export infrastructure; do not assume a new `/api` function is necessary. A new endpoint would also need to satisfy the project’s Vercel Hobby function limit.

## Schema and compatibility

The live decision table uses UUID IDs, `numeric` confidence, `jsonb` indicators, and `timestamptz` timestamps, with decision and payload checks and a watched-market foreign key. Candles use UUID IDs, numeric OHLCV fields, `timestamptz`, interval and OHLC checks, a unique `(symbol, interval, timestamp)` key, and a watched-market foreign key. The trade-to-decision foreign key is restrictive.

These types and core constraints are supported by PostgreSQL-compatible archive databases. Azure Database for PostgreSQL lists PostgreSQL 17 as supported; the live project is on PostgreSQL 17.6. A destination should still be tested with a restored sample because server minor versions, extensions, collation, and defaults can differ.

Do not copy the whole Supabase application schema blindly. Supabase Auth objects, `auth.uid()`-dependent policies, grants, triggers, and application RPCs are not needed for manual archive queries and may not exist at a destination. A minimal archive schema should preserve the history tables’ types, IDs, key constraints, indexes needed for query performance, and a small watched-market lookup snapshot. It should not create a false cross-database foreign-key guarantee to live trades. Archive credentials must remain server-side and separate from the live bot’s production environment.

## Destination comparison

| Approach | Manual SQL access | Durability / recovery | Main trade-offs |
|---|---|---|---|
| Private object storage | No; restore the archive to PostgreSQL first | Depends on provider redundancy, versioning/immutability, and a separately tested restore. Replication alone does not protect against accidental deletion. | Best fit for cold, infrequently queried history and lowest storage cost. Requires operational restore steps; no existing dashboard or bot reader. |
| Azure Database for PostgreSQL | Yes, while the server is running | Automated backups support point-in-time restore, seven days by default and up to 35 days. These are service recovery backups, not an exportable long-term archive. | PostgreSQL is straightforward to query, but a continuously running server has a compute cost and the minimum provisioned storage is much larger than the current dataset. Account eligibility is unknown. |
| Neon through Vercel Marketplace | Yes; serverless PostgreSQL can scale to zero | Free plan advertises a six-hour history window and one manual snapshot, but no scheduled snapshots. Paid plans have longer history and optional snapshots. Keep a separate archive copy. | Convenient for occasional SQL and scale-to-zero, but the free project storage is only 1 GB and its backup features are not enough as the sole archive. Vercel integration can inject database environment variables, which is unnecessary and risky for an archive-only use. |

### Object storage

The simplest cold-archive shape is a private, versioned object containing a compressed PostgreSQL custom-format dump for the chosen tables and a manifest. The manifest should record source project reference, snapshot/cutoff time, schema version, table row counts, timestamp ranges, per-market/interval counts, and deterministic chunk checksums. Include required lookup rows or define an archive-only lookup schema. Encrypt objects, restrict access, and use version retention or immutability where available. Keep a second independent copy if the archive becomes the sole copy of old history.

Object storage is not directly queryable by the current application. Manual history work requires restoring into a compatible PostgreSQL instance; exposing archive data to the dashboard would require new code. A full restore must be rehearsed before selecting a deletion cohort.

As an example only, Azure’s free-account offer currently lists 5 GB of hot LRS Blob storage for 12 months, plus 20,000 read and 10,000 write operations. The Azure Retail Prices API returned **€0.017595/GB-month** for West Europe Hot LRS data storage on 2026-11-06. For scale only, 27 GB stored at that rate is about **€0.47/month** for stored bytes, excluding operations, retrieval, network egress, taxes, and the actual compressed dump size. The 27 GB is not a measured archive size or a forecast. This is not a destination selection or a total bill estimate. LRS replicates within one physical datacenter; choose a different redundancy tier if regional recovery is required. Any redundancy tier still needs deletion protection and restore testing.

### Azure Database for PostgreSQL

Microsoft’s Free Account page lists, for 12 months, **750 hours/month of Burstable B1MS**, **32 GB server storage**, and **32 GB backup storage**. Eligibility depends on the account holder and region; Microsoft limits the free account and $200 credit to one per new customer. Sign-up requires a phone, non-prepaid credit/debit card, and Microsoft or GitHub account. The account owner must verify eligibility; it is not assumed here.

The free account also includes $200 of credit for 30 days. To continue services after the credit/initial period, the owner must move to pay-as-you-go; without that upgrade the account and services can be disabled. At the end of the 12-month service offer, active resources continue at pay-as-you-go rates if the subscription is active.

For West Europe, the Azure Retail Prices API returned **€0.017864/hour** for B1MS and **€0.122896/GB-month** for PostgreSQL Flexible Server storage. A continuously running 730-hour month plus 32 GB provisioned storage is approximately **€16.97/month** (`730 × €0.017864 + 32 × €0.122896`). This is an indicative list-price calculation, not a quote; it excludes tax, network costs, and backup storage above the included amount. PostgreSQL backup documentation says up to 100% of provisioned storage is included for backup storage, with excess charged; actual backup usage depends on retained snapshots and WAL volume. The 32 GB free-account backup allowance is not a long-term archive guarantee.

Azure Flexible Server requires an allowed network path: for public access, configure firewall rules for the authorized client IP and use TLS; private networking requires appropriate VNet connectivity. Stopping the server stops compute billing, but storage remains billable and the database is not queryable. Microsoft documents that a stopped server is automatically started after seven days and may briefly restart for scheduled monthly maintenance. Stopping it is therefore not equivalent to an indefinitely cold object archive.

### Neon via Vercel Marketplace

Neon’s current Free plan lists **100 compute-hours per project**, **1 GB storage per project** and **20 GB total per account**, **5 GB public egress per project**, scale-to-zero after five minutes, a six-hour history window, and one manual snapshot. It does not include scheduled snapshots. Its paid Launch plan lists storage at **$0.35/GB-month**, compute at **$0.106/CU-hour**, up to seven days of history, scheduled snapshots at **$0.09/GB-month**, and instant restore at **$0.20/GB-month**.

The current 482 MB of measured source relation storage could fit under 1 GB initially, but the short observed whole-database growth rate would use the remaining headroom in roughly a week if similar growth continued. If a Neon archive reached 26.9 GB, Launch storage alone would be about **$9.42/month**; a 27 GB scheduled snapshot at the listed rate would add about **$2.43/month**, plus compute and any other usage. These are scale illustrations, not an archive-size forecast or account quote. Free-plan compute is not the same as a durable backup.

The Vercel Marketplace listing supports Neon, and Neon's documentation describes integrations that can inject database environment variables into Vercel deployments. For archive-only use, create a separate archive project and use manual/controlled connections; do not connect it to the production CryptoPulse Vercel project or alter its environment variables. Account billing and the current applicable plan must be confirmed by the owner.

## Integrity, restore, and deletion safeguards

1. **Approve a retention policy first.** Decide whether the goal is a cold copy, lower live storage, or archived history in Analytics/exports. These are different requirements. No policy is approved by this assessment.
2. **Copy without deletion.** Under separate authorization, take a consistent snapshot at a documented cutoff. Export only the named history tables and required lookup data; do not include credentials. Keep the source rows unchanged.
3. **Record and verify a manifest.** Compare per-table counts, timestamp minima/maxima, ID uniqueness, per-market and per-interval counts, candle uniqueness/check constraints, decision validity, and trade-referenced decision IDs. Use deterministic chunk checksums and verify them after upload and restore.
4. **Restore into an isolated PostgreSQL target.** Confirm schema/types and indexes, run representative historical queries, and compare query results to the source snapshot. Exercise the restore from the stored object, not just from the live source. No archive should be considered validated based only on matching total row counts.
5. **Decide how history remains usable.** For manual research, document the restore and connection procedure. For dashboard Analytics/exports, implement and test an archive-aware read path before removing records; retain existing authorization and do not expose archive credentials to browsers.
6. **Run a separate deletion preflight only after explicit approval.** Recalculate all candidates from fresh production state. Exclude active-market requirements, current candle windows, latest decisions, every trade-referenced decision, and all records needed by current Analytics/exports until those consumers are changed or a retention exception is explicitly accepted. Obtain a fresh recoverable Supabase backup and confirm the archive restore before any deletion.
7. **Rollback by restoring from the validated archive or a Supabase recovery point.** Restore IDs and original typed values; validate FK dependencies before re-enabling or relying on constraints. Reconcile duplicates and timestamps against the live database before reinsertion. A deletion should never be treated as reversible merely because an object copy exists.

Deleting rows may make pages reusable inside PostgreSQL without reducing the reported database size. `VACUUM` generally enables reuse; relation shrinking may require a rewrite such as `VACUUM FULL`, which has locking and temporary-space implications. The amount reclaimed must be measured after any approved deletion and maintenance; it cannot be inferred from `pg_column_size` or row counts.

## Risks, unknowns, and decisions

- **Current decisions have no age-based deletion cohort:** every observed row is under 365 days. The 157,073 runtime-only candidate decisions would still remove data required by current 365-day Analytics and all-time exports.
- **Dashboard and exports stay Supabase-only:** archived history will be missing from their Supabase-backed totals/results until code is changed.
- **Growth estimates are weak:** the annualized figure extrapolates one 9.25-hour interval and must not be used as a capacity guarantee.
- **Archive file size and restore duration are unmeasured:** no production export was performed. Compression, indexes, TOAST, transfer, egress, and destination billing can change the result.
- **Quota recovery is uncertain:** relation size and row payload are not Supabase’s guaranteed recoverable quota amount. Deleting rows may not immediately reduce the provider’s reported storage metric.
- **Provider accounts are unverified:** Azure free eligibility, Neon plan/organization limits, Vercel billing arrangement, allowed networking, and payment details require account-owner confirmation.
- **Backup is not an archive:** Azure’s PITR window and Neon’s plan history are for recovery and can expire; neither replaces an independent versioned archive and tested restore.
- **Data governance remains undecided:** archive region, redundancy, retention duration, encryption/key ownership, access control, and whether research may use a secondary provider all need approval.
- **No exact future Analytics contract exists for archived data:** Phase 16 historical simulation requirements should be settled before implementing any dual-source query.

## Staged recommendation

1. **Proof of concept, no deletion:** after explicit authorization to export, copy a small representative decision/candle slice to a private object-storage archive. Keep Supabase unchanged. An Azure Blob free allowance is one possible low-cost test, not a selected provider.
2. **Restore and integrity rehearsal:** restore the copied slice to an isolated PostgreSQL 17-compatible database; verify the manifest, types, key/constraint behavior, query results, and restore procedure. Separately test Neon or Azure PostgreSQL only if interactive SQL is a confirmed requirement.
3. **Historical-analysis decision:** determine whether manual restore-on-demand is sufficient. If dashboards/exports must show archived history, implement and validate reuse of existing server-side routes before any data removal.
4. **Separate deletion preflight:** only after the above and explicit approval, recalculate the eligible rows, secure a current recovery point, compare source/archive checksums, document quota and rollback expectations, and request approval for a precisely bounded deletion. No deletion is authorized by this report.

**Bottom line:** archiving old candles outside the current runtime windows appears feasible for bot operation, provided the online keep set is revalidated and preserved. Decisions cannot safely be removed under current Analytics/export behavior. Prefer a versioned object archive for cold history; use Azure PostgreSQL or Neon only if direct SQL access is worth the ongoing capacity, backup, networking, and billing constraints.

## References

### Repository

- [AI engine](../../lib/ai-engine.mjs)
- [Market data and scanner](../../lib/market-data.mjs)
- [Analytics](../../lib/analytics.mjs)
- [Dashboard data API](../../api/dashboard-data.mjs)
- [Exports](../../lib/exports.mjs)
- [Database documentation](../DATABASE.md)
- [Architecture documentation](../ARCHITECTURE.md)
- [Phase 16 strategy optimization simulator](../../prompts/16_STRATEGY_OPTIMIZATION_SIMULATOR.md)
- [Earlier Supabase archive feasibility report](./SUPABASE_AI_CANDLE_HISTORY_ARCHIVE_FEASIBILITY_REPORT.md)

### Official provider sources

- [Azure Free Account and offer terms](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account/)
- [Azure free services](https://azure.microsoft.com/en-us/free/)
- [Azure Database for PostgreSQL Flexible Server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/)
- [Azure Retail Prices API](https://prices.azure.com/api/retail/prices)
- [Azure PostgreSQL backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore)
- [Azure PostgreSQL stop compute](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-stop-server)
- [Azure PostgreSQL supported versions](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-supported-versions)
- [Azure PostgreSQL public networking](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-networking-public)
- [Azure Blob Storage pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)
- [Azure Storage redundancy](https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy)
- [Neon pricing](https://neon.com/pricing)
- [Neon backup and restore](https://neon.com/docs/guides/backup-restore)
- [Neon Vercel integration documentation](https://neon.com/docs/guides/neon-managed-vercel-integration)
- [Neon on Vercel Marketplace](https://vercel.com/marketplace/neon)
