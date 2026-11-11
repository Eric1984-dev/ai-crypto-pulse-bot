# Archive Market Reader RLS Migration Review

**Review date:** 2026-11-07  
**Mode:** Static review and SQL generation only. No SQL was executed and no database was queried or changed.

**Historical note:** This review covered the standalone RLS draft, which has since been removed as superseded by `ARCHIVE_MARKET_READER_ROLE_V2.sql`. Use the V2 setup artifact and current operator guidance, not this report, for any future setup.

## Final verdict

# B. Changes required before execution

The proposed RLS policy was narrowly scoped and did not alter the existing `authenticated` policy or bot behavior. The role-provisioning artifact `ARCHIVE_MARKET_READER_ROLE.sql` also created a policy with the same name, so applying both drafts would have failed on a duplicate policy.

This migration also assumes that the role has already been created and granted `SELECT` on the watched-market table by the role-provisioning step. It deliberately adds no grant. The prior final review's separate sequence/function privilege gap for the complete reader role remains unresolved by this policy-only migration.

## Migration contents

The removed `ARCHIVE_MARKET_READER_RLS_MIGRATION.sql` draft performed fail-closed preflight checks, created one permissive `SELECT` policy for `cryptopulse_archive_market_reader`, and included a commented rollback block. The forward migration:

- Requires the Supabase database name `postgres`.
- Requires the reader role to exist, be non-privileged and non-inheriting, and allows only Supabase's platform-managed membership edge: `cryptopulse_archive_market_reader` as the granted role, `postgres` as member, `supabase_admin` as grantor, `ADMIN=true`, `INHERIT=false`, and `SET=false`. The legacy standalone migration still contains an older zero-membership assertion and is not safe to execute unchanged; prefer the reviewed V2 role script, which includes the Supabase membership exception and creates the policy itself.
- Requires RLS to be enabled and the reader not to own the target table.
- Requires effective table `SELECT` and rejects table write/trigger privileges.
- Confirms the existing `AI_Crypto_Bot_Watched_Markets_select_authenticated` policy still exists with its expected all-row `SELECT` definition.
- Fails if the archive-reader policy name already exists.
- Does not issue grants, alter RLS settings, drop/recreate the authenticated policy, or modify any application data.

The policy uses `USING (true)` so every watched-market row, including disabled markets, is visible to the reader. This matches the manual market-seed utility's requirement to copy all configured rows. The role still needs an independent `GRANT SELECT`; an RLS policy does not grant SQL table privileges by itself.

## Interaction with existing RLS

PostgreSQL's default permissive policies combine with logical **OR** for a role to which multiple policies apply. The existing policy is specifically `TO authenticated`; the new policy is specifically `TO cryptopulse_archive_market_reader`. Consequently, it adds all-row read access on this table to the archive reader without changing what the existing authenticated policy permits.

The expected platform edge is one-way: `postgres` is a member of the archive-reader role. `ADMIN=true` lets `postgres` grant that role to other roles; its `INHERIT=false` and `SET=false` options prevent `postgres` from inheriting the reader's privileges or switching into it. The edge does not make the reader a member of `authenticated` or any other role. Reject any other membership involving the reader, including membership in `authenticated`, which could cause additional authenticated policies to apply. The role must also remain non-owner and `NOBYPASSRLS` so that RLS is enforced.

## Execution prerequisites and collision handling

1. Confirm the intended Supabase project and that the administrative connection is to database `postgres`.
2. Ensure the role exists with the expected least-privilege attributes and has the separate `SELECT` table grant. Do not add a write or RLS-bypass grant.
3. This historical draft duplicated policy creation from `ARCHIVE_MARKET_READER_ROLE.sql`; both have since been superseded by V2 and removed. Do not use this report as an execution procedure.
4. Inspect the live role and policy state before applying. Do not remove or replace an unexpected policy to make this migration pass.
5. Apply through the project's approved, versioned Supabase migration/change-control process. This generated standalone file is not timestamped and has not been added to the migration chain.
6. After application, verify the reader can select every expected row and that the authenticated policy definition remains unchanged. This verification was not performed for this report.

## Rollback

The SQL file contains a separately commented rollback block. Execute only the `DROP POLICY` transaction if rollback is approved and the archive reader no longer requires access. Rollback removes only the archive-reader policy; it leaves the role, table grant, existing authenticated policy, and RLS setting untouched.

## Reviewed sources

- Removed superseded drafts: `ARCHIVE_MARKET_READER_RLS_MIGRATION.sql` and `ARCHIVE_MARKET_READER_ROLE.sql`
- [`ARCHIVE_MARKET_READER_SETUP.md`](./ARCHIVE_MARKET_READER_SETUP.md)
- [`ARCHIVE_MARKET_READER_FINAL_REVIEW.md`](./ARCHIVE_MARKET_READER_FINAL_REVIEW.md)
- [`20261031190000_create_agent_tables.sql`](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql)
- [`DATABASE.md`](../DATABASE.md)
