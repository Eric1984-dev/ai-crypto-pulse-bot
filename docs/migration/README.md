# CryptoPulseBot-migratie

Deze map bevat de fasegebonden migratieaudit en het plan voor een zelfstandige Pi-runtime. Zij vult de bestaande projectdocumentatie aan; tradingregels, schema-informatie en API-contracten blijven beschreven in de bestaande documenten waar mogelijk.

## Status

- **Fase 1 — Audit en migratieplan:** documentatie bijgewerkt; geen applicatiecode, databaseschema of data gewijzigd.
- **Doel:** Raspberry Pi 3 voert Node.js backend, scanner, AI-analyse, paper-trading-engine en scheduler uit op de bestaande primaire PostgreSQL-database.
- **Frontend:** Vercel blijft statische frontend/dashboard hosting; dashboardverzoeken gaan naar een beveiligde Pi API.
- **Supabase:** wordt pas verwijderd nadat alle bijbehorende runtimepaden en dashboardfuncties vervangen en gevalideerd zijn.

## Migratiedocumenten

- [01-audit.md](./01-audit.md) — huidige implementatie, Supabase-calls/RPC's, scanner-marktbron, scheduler, resterende afhankelijkheden en fase-1-besluit.
- [architecture.md](./architecture.md) — huidige en beoogde component-, data- en beveiligingsgrenzen.
- [roadmap.md](./roadmap.md) — voorstel voor afhankelijkheden, uitvoeringsvolgorde en acceptatiegates.

## Niet-onderhandelbare grenzen

- Gebruik de al bestaande Pi PostgreSQL-database en het bestaande schema. Maak geen database aan, voer geen schema/migraties opnieuw uit en kopieer geen data opnieuw vanuit Supabase.
- Behoud de volledige bestaande marktlijst exact; de Pi-tabel is de runtime-bron voor scanner en agent. Geen seed, inserts, updates of deletes van watched-market-rijen als onderdeel van de migratie.
- Behoud de bestaande tradingregels, indicatoren, AI/confidenceberekeningen, dashboardfuncties en paper/live-veiligheidsgrenzen. Paper trading blijft de actieve modus; voer nooit echte orders uit.
- Windows is alleen ontwikkelomgeving. Er draaien geen productieonderdelen of schedulers op Windows.
- Vercel verzorgt alleen de frontend/dashboard. Deployments voert de gebruiker zelf uit.
- Werk alleen aan de fase die de gebruiker expliciet opdraagt. Tests, documentatie en Git-review horen bij elke fase; commit alleen na succesvolle afronding en stop daarna voor toestemming.

Zie [AGENTS.md](../../AGENTS.md) en de bestaande [architectuur](../ARCHITECTURE.md), [API](../API.md), [database](../DATABASE.md), [scheduling](../SCHEDULING.md), [deployment](../DEPLOYMENT.md) en [risk management](../RISK_MANAGEMENT.md) voor de bredere projectregels.
