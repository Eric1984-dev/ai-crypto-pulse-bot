# Archive Market Reader Role V2 Review

- **Review date:** 2026-11-07
- **Mode:** Static review and script generation only. No SQL was executed, no database was queried or changed, and no credentials were inspected.

## Summary

The original role-membership assertion conflated two different directions in `pg_auth_members`. On Supabase PostgreSQL 16 or later, this also intersects with a documented platform membership:

- `member = reader_oid`: the archive reader is a member of another role. This can let it inherit privileges or use `SET ROLE`, so V2 continues to reject this.
- Supabase automatically gives `postgres` an admin membership in each role it creates. In `pg_auth_members`, the new role is `roleid`, `postgres` is `member`, `supabase_admin` is the grantor, and `admin_option` is true while `inherit_option` and `set_option` are false. The original `roleid = reader_oid` predicate rejected this expected management relationship.

The failed check is therefore explained by Supabase's PostgreSQL 16+ role-management behavior. The transaction exception rolled back the new role, so the later `pg_roles` query returning zero rows is expected. V2 allows only the documented `postgres`/`supabase_admin` membership with those exact option flags. It rejects any membership where the archive reader is itself a member and any other role granted membership in it.

## Supabase membership behavior

**Supabase does automatically create this one management membership on PostgreSQL 16 or later.** The Supabase Knowledge Base documents that when `postgres` creates a role, Supabase's bootstrap superuser `supabase_admin` grants `postgres` an admin membership in the new role. It has `INHERIT FALSE` and `SET FALSE`, so `postgres` does not inherit the archive reader's privileges and cannot switch into it through that membership. The admin option lets the managed `postgres` role manage/drop the role and grant it to others.

Other role memberships are not implied by that platform behavior. PostgreSQL's role-membership clauses and `GRANT` semantics remain the source of other memberships. V2 includes a PostgreSQL 16+ guard because the `inherit_option` and `set_option` catalog columns are required to distinguish the documented Supabase management membership safely.

## Supabase PUBLIC privileges and read-only limitation

Supabase also documents unavoidable privileges granted to `PUBLIC`: `CONNECT` and `TEMPORARY` on database `postgres`, `USAGE` on `public`, and execution on large-object functions. The `NOINHERIT` attribute does not remove `PUBLIC` privileges, and `default_transaction_read_only=on` is a session default that a connected user can override. V2 therefore does not reject the standard `TEMPORARY` grant; it still rejects database `CREATE`, application table writes, public sequence access, executable public routines, and non-system schema access.

If `pg_net` is enabled and its documented `PUBLIC` grants expose the `net` schema or its objects, V2 fails closed on that additional access. Do not waive that failure or revoke Supabase service grants to make the script pass. The direct database role is read-only with respect to the watched-market application table, but it is **not an absolute no-write credential** because Supabase's `PUBLIC` temporary/large-object capabilities cannot safely be removed for one role. The seed utility's source transaction is explicitly read-only; keep it that way. If the security requirement forbids all source-side writes even by a compromised credential, use a different constrained read architecture rather than treating this direct role as absolutely read-only.

## Security controls in V2

[`ARCHIVE_MARKET_READER_ROLE_V2.sql`](../../ARCHIVE_MARKET_READER_ROLE_V2.sql):

- Preserves the non-login, non-inheriting, non-admin, non-replication, non-`BYPASSRLS` role profile and `CONNECTION LIMIT 1`.
- Grants only `CONNECT` to `postgres`, `USAGE` on `public`, and `SELECT` on the watched-market table.
- Creates only a table-specific all-row `SELECT` RLS policy for the reader. The existing authenticated policy is not altered.
- Allows only the exact Supabase-managed `postgres` admin membership; rejects other memberships and reader membership in any other role.
- Checks effective access to public tables/views, sequences, and routines; it aborts if the reader can access other public relations, any public sequence, or execute a public routine.
- Keeps the transaction atomic. A failed validation rolls back the role, grants, and policy created by that run.

The reader remains `NOLOGIN` after this script. Set the password out of band and enable `LOGIN` only after the owner has reviewed the exact grants and full-row RLS visibility. The script is designed for PostgreSQL 16+ and has not been executed or parser-tested.

## Review outcome

**B. Changes required before treating this as an absolutely read-only credential.** The original failure is fixed for Supabase's documented membership, and V2 is narrowly scoped to application tables. However, Supabase's unavoidable `PUBLIC` temporary/large-object privileges mean the login is not intrinsically incapable of all source-side writes. Before proceeding, confirm that this platform limitation is acceptable for the manually invoked POC, inspect whether `pg_net` is enabled, verify the intended project/database and policy/role names, and approve the remaining public privilege surface. If absolute no-write source access is mandatory, do not use this direct-login design.

The superseded `ARCHIVE_MARKET_READER_ROLE.sql` draft and standalone RLS migration draft both created the same policy name. They have been removed; V2 is the retained policy-creation path.

## References reviewed

- [`ARCHIVE_MARKET_READER_ROLE_V2.sql`](../../ARCHIVE_MARKET_READER_ROLE_V2.sql)
- Removed superseded drafts: `ARCHIVE_MARKET_READER_ROLE.sql` and `ARCHIVE_MARKET_READER_RLS_MIGRATION.sql`
- [`ARCHIVE_MARKET_READER_SETUP.md`](./ARCHIVE_MARKET_READER_SETUP.md)
- [`ARCHIVE_MARKET_READER_FINAL_REVIEW.md`](./ARCHIVE_MARKET_READER_FINAL_REVIEW.md)
- [`DATABASE.md`](../DATABASE.md)
- Supabase [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- Supabase [Custom role inherits privileges not explicitly granted](https://supabase.com/kb/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted-ddaa1c)
- Supabase [Can't revoke a role membership granted by supabase_admin](https://supabase.com/kb/troubleshooting/cant-revoke-a-role-membership-granted-by-supabase_admin-d08922)
- PostgreSQL 17 [role membership](https://www.postgresql.org/docs/17/role-membership.html)
