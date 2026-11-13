# Database-migraties uitvoeren op de Raspberry Pi

Deze procedure geldt voor de bestaande PostgreSQL-database `ai_crypto_bot_store`.
Voer migraties handmatig uit als database-schema-owner. Runtime-start voert
nooit migraties uit. Gebruik deze instructies ook als basis voor latere
Pi-migraties: controleer altijd eerst de juiste versie, backup en volgorde en
voer ieder bestand afzonderlijk uit.

## Voorbereiden

Voer commando's in de **Linux-shell** op de Pi uit. Als je in `psql` zit, sluit
die sessie eerst met `\q`. Een shellcommando zoals `psql --file=...` werkt niet
als SQL-invoer in de `psql`-prompt. De rol `postgres` wordt hieronder gebruikt
als schema-owner; gebruik de bestaande geautoriseerde schema-owner als die op
de Pi anders heet.

```bash
cd ~/ai-crypto-pulse-bot/raspberry-pi
git status --short
```

Controleer dat de benodigde migratiebestanden aanwezig zijn en dat je de
verwachte database en eigenaar gebruikt:

```bash
ls -l migrations/phase-8.13-portfolio-snapshot-order.sql \
  migrations/phase-8.14-position-aware-trailing-exits.sql \
  migrations/phase-8.15-paper-execution-audit.sql
sudo -u postgres psql --dbname=ai_crypto_bot_store \
  --command="SELECT current_database(), current_user;"
```

Stop de runtime tijdens schemawijzigingen en maak een backup:

```bash
sudo systemctl stop cryptopulse-runtime.service
sudo systemctl is-active cryptopulse-runtime.service
umask 077
sudo -u postgres pg_dump -Fc ai_crypto_bot_store \
  > "$HOME/ai_crypto_bot_store-before-migration-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

`is-active` hoort `inactive` te melden. Ga niet verder als de database,
gebruiker, bestanden of backup niet kloppen.

## Phase 8.13 en 8.14 toepassen

Voer de migraties één voor één uit en controleer de exitstatus en volledige
uitvoer na elke opdracht. `ON_ERROR_STOP` laat `psql` direct falen zodra een
SQL-statement een fout geeft.

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 \
  --dbname=ai_crypto_bot_store \
  --file=migrations/phase-8.13-portfolio-snapshot-order.sql
```

Ga alleen door als die opdracht zonder fouten eindigt. Phase 8.14 vereist de
**exacte rolnaam** die in de Pi-configuratie als `PAPER_DATABASE_USER` staat.
Het gaat om de PostgreSQL-gebruikersnaam, niet om het wachtwoord. Vervang de
voorbeeldrol hieronder indien nodig:

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store <<'SQL'
SELECT pg_catalog.set_config(
  'cryptopulse.paper_database_user',
  'ai_crypto_bot_paper_writer',
  false
);
\i migrations/phase-8.14-position-aware-trailing-exits.sql
SQL
```

Voer dit hele blok uit in de Linux-shell. Plak de regels niet in een reeds
geopende `psql`-sessie. De migratie controleert dat de opgegeven
`PAPER_DATABASE_USER` een bestaande, beperkte loginrol is en krijgt alleen
`SELECT` op candlegegevens. Gebruik nooit die runtime-rol om schemawijzigingen
uit te voeren.

## Controleren

Controleer na beide geslaagde migraties dat de nieuwe kolommen bestaan:

```bash
sudo -u postgres psql --dbname=ai_crypto_bot_store --command="
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'AI_Crypto_Bot_Portfolio_Snapshots'
      AND column_name = 'snapshot_order')
    OR (table_name = 'AI_Crypto_Bot_Positions'
      AND column_name IN ('high_water_price', 'trailing_stop_price'))
    OR (table_name = 'AI_Crypto_Bot_Trades'
      AND column_name = 'execution_reason')
  )
ORDER BY table_name, column_name;"
```

Verwacht vier kolommen: `snapshot_order`, `high_water_price`,
`trailing_stop_price` en `execution_reason`. Bevestig ook dat de paper-rol
overeenkomt met de lokale configuratie. Start de runtime pas als de Pi-code die
de nieuwe kolommen gebruikt is bijgewerkt en de post-migratiecontroles slagen.
Een Git-push of Vercel-deployment werkt de Pi-runtime niet automatisch bij.

## Phase 8.15 audit-tabel toepassen

Phase 8.15 is een aparte, additieve migratie voor per-evaluatie uitkomsten van
directionele paper BUY/SELL-beslissingen. Pas deze alleen toe na backup en als
database-schema-owner. De tabel biedt het runtime-paperaccount uitsluitend
INSERT-toegang; de bestaande dashboard-lezer krijgt SELECT-toegang. Controleer
dat `ai_crypto_bot_runtime_reader` bestaat en gebruik de exacte, beperkte
`PAPER_DATABASE_USER`-rol uit de lokale Pi-configuratie:

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store <<'SQL'
SELECT pg_catalog.set_config(
  'cryptopulse.paper_database_user',
  'ai_crypto_bot_paper_writer',
  false
);
\i migrations/phase-8.15-paper-execution-audit.sql
SQL
```

Vervang de voorbeeldrol door de geconfigureerde PostgreSQL-rolnaam, niet het
wachtwoord. Voer dit blok alleen uit nadat de vorige migraties zijn beoordeeld;
het is geen runtime-startactie en is niet automatisch toegepast.

Controleer de tabel, kolommen en belangrijkste grants:

```bash
sudo -u postgres psql --dbname=ai_crypto_bot_store --command="
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AI_Crypto_Bot_Paper_Execution_Audit'
ORDER BY ordinal_position;
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'AI_Crypto_Bot_Paper_Execution_Audit'
ORDER BY grantee, privilege_type;"
```

Verwacht auditkolommen voor evaluation-run/portfolio/decision IDs, symbol,
action, confidence, decision/evaluation timestamps, outcome, reason code en
nullable trade ID. De paper writer mag INSERT hebben maar geen UPDATE, DELETE
of TRUNCATE; de dashboard reader moet SELECT hebben. Valideer runtime-contracts
met de geïnstalleerde code voordat de runtime opnieuw wordt gestart.

## Volgende migraties en fouten

- Controleer migratiebestanden en eventuele volgorde-afhankelijkheden in de
  projectdocumentatie voordat je een nieuw SQL-bestand toepast.
- Maak een verse backup vóór iedere schemawijziging.
- Voer elk SQL-bestand precies één keer uit met
  `--set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store --file=<bestand>`.
- Controleer na iedere migratie de uitvoer voordat je de volgende toepast.
- De scripts gebruiken transactionele DDL. Bij een fout: stop, bewaar de
  volledige foutmelding en inspecteer de databaseschema-objecten. Voer een
  migration niet blind opnieuw uit en wijzig een migration niet om een
  bestaande-objectfout te omzeilen.
- Pas geen migratie toe op Supabase; de Raspberry Pi PostgreSQL is de actieve
  database. Deze procedure wijzigt geen watched markets, saldo, tradehistorie
  of productiegegevens buiten de expliciet beschreven SQL-migratie.

De Phase 8.13- en 8.14-migraties zijn schemawijzigingen, geen
paper-trading-reset. Zie [de aparte resetprocedure](paper-trading-reset.md)
alleen als je bewust een nieuwe paper-tradingrun wilt starten.
