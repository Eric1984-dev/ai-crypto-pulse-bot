# Phase 7.5 — Profile and Portfolio Initialization Review

## Scope and observed state

This is a documentation-only review. No application code or database was changed. The reported Pi counts (zero profiles, portfolios, trades, and positions) were supplied for this review and were not independently queried.

The paper-trading runtime can complete its cycle while processing zero portfolios. Existing AI decisions, including BUY decisions, do not create a profile or portfolio.

## Expected initialization path in the existing schema

The repository's Supabase schema uses an auth-owned profile model:

1. `AI_Crypto_Bot_Profiles.id` is a UUID primary key and a foreign key to `auth.users.id`.
2. The schema migration defines `AI_Crypto_Bot_Sync_Auth_Profile`, which inserts or updates a profile when a row is inserted into or has its email updated in `auth.users`. The migration also backfills profiles from existing `auth.users` rows.
3. The Phase 08 migration defines an `AFTER INSERT` trigger on `AI_Crypto_Bot_Profiles`. It provisions a virtual portfolio with a 10,000 starting, available, and total balance, then creates the initial portfolio snapshot. That migration also backfills portfolios and snapshots for profiles that already exist.
4. Independently of those database triggers, the Raspberry Pi paper runtime calls `ensureDefaultPortfolios()` on each paper run. Its direct SQL selects existing profiles that have no portfolio, inserts a portfolio for each candidate, and inserts the initial snapshot. It does not insert profiles or access `auth.users`.

The trigger path is defined in `PostgreSQL/migrations/20261031190000_create_agent_tables.sql` and `PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql`. The Pi runtime's direct initialization is in `raspberry-pi/src/repositories/paper-trading-repository.mjs`; it is designed not to require PostgreSQL business functions.

## Required records

Under the current per-profile model, at least one row must exist in `AI_Crypto_Bot_Profiles`. Its `id` must satisfy the profile table's `auth.users` foreign key in the current schema.

For that profile, the system needs one `AI_Crypto_Bot_Portfolios` row. The Phase 08 trigger can create it at profile insertion; otherwise the Pi runtime can create it on its next paper run. Portfolio initialization also creates the first `AI_Crypto_Bot_Portfolio_Snapshots` row. Trades and positions are not bootstrap records and should remain absent until normal paper-trading rules produce them.

## Can the runtime initialize a portfolio with zero profiles?

No. The portfolio initialization query selects candidates from `AI_Crypto_Bot_Profiles`. With zero profiles, the candidate set is empty, so it inserts neither portfolios nor snapshots. The service then iterates over an empty portfolio list and executes no BUY or SELL decisions. It can still return a completed trading result with `portfoliosProcessed: 0` and `tradesExecuted: 0`, which explains how runtime cycles can be healthy while no paper account exists.

The current implementation does not create a default system profile, generate a user identity, or insert records into `auth.users`. Its initialization behavior is intentionally limited to portfolios for profiles that already exist.

## Supabase Auth dependency and Pi uncertainty

The source schema is coupled to Supabase Auth through the `auth.users` foreign key, synchronization trigger, and backfill. A new Supabase signup creates the source profile through that database trigger, but the Pi runtime has no auth integration or profile synchronization path. A Supabase profile therefore does not automatically appear in `ai_crypto_bot_store`.

The migrations establish what the original Supabase schema expects; they do not prove that the Pi database contains `auth.users`, the Supabase triggers, or their trigger functions. The Pi runtime reports state that does not rely on PostgreSQL business functions. The live Pi schema and trigger inventory were not inspected for this review.

## Default system profile and recommended production setup

The current code requires a profile row but does not require that the row be labeled as a system profile. For a single autonomous Pi bot, one dedicated system-owned paper profile is the clearest operational model. It must be provisioned deliberately; automatically fabricating an identity from the scheduler would bypass the current auth ownership model and could not satisfy the existing foreign key safely.

Recommended path:

1. Keep paper trading operationally unprovisioned until the account owner is decided; BUY decisions alone must not be treated as evidence that paper trading is active.
2. For a temporary deployment that retains Supabase Auth, use an explicitly designated, legitimate auth identity and ensure its matching profile row is present in the Pi database through an approved provisioning/synchronization process. Do not assume a Supabase signup is synchronized to the Pi.
3. For the intended standalone Pi architecture, plan a separately approved schema migration that removes or replaces the `auth.users` dependency and defines a protected, one-time system-profile provisioning step. Do not make the scheduler create profiles on every run.
4. Once a profile exists, let the existing runtime provision its portfolio and initial snapshot. Verify the profile ID, portfolio ownership, 10,000 virtual starting balance, and initial snapshot on the Pi before treating paper trading as initialized. Do not seed trades or positions.
5. Confirm the effective Pi schema and whether any auth triggers/functions exist before selecting the transition path. No migration, profile insert, grant, or data operation was performed in this phase.

## Documentation gap

The Phase 7 report documents that missing portfolios are initialized for existing profiles and that the runtime does not create profiles. It does not explicitly state that zero profiles means no portfolio can ever be created, nor does it provide an initial profile provisioning step. Production operations documentation should add that gate once the identity model and approved provisioning mechanism are decided.

## Validation and completion

This review changed documentation only. No tests were run, and no live Pi database validation was performed. Phase 7.5 stops here; no code or database work was started.
