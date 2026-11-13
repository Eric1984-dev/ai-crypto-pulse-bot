# Paper-tradinggeschiedenis resetten en starten met €2.000

Deze operatorprocedure wist geselecteerde paper-tradinggegevens van het
standalone systeemportfolio. Het zijn destructieve handelingen; voer ze
uitsluitend uit als je bewust een nieuwe paper-tradingrun wilt beginnen.
De scripts zijn niet automatisch uitgevoerd.

## Wat wordt verwijderd en behouden

`sql/reset-system-paper-data.sql` verwijdert de trades, posities, snapshots en
shadow-exitgegevens van het actieve systeemportfolio, alle AI-beslissingen en
alle analytics-runs (als die tabel is geïnstalleerd). Vervolgens maakt het één
nieuwe basissnapshot aan op het bestaande `starting_balance`.

Het script behoudt watched markets, marketdata, candlehistorie,
profiel-/portfolio-identiteit, scanner-events, strategieën,
strategiewijzigingen, strategieprestaties, backtests, agentstatus en
emergency-state. Een bestaande `EMERGENCY_STOP` wordt dus niet gewist of
omzeild. Controleer die staat voor je de runtime weer start.

AI-beslissingen zijn marktbreed en niet aan een portfolio gekoppeld. Om
geschiedenis van andere portfolios te beschermen, stopt het reset-script
zonder wijzigingen als een trade buiten het systeemportfolio naar een
AI-beslissing verwijst. Stop dan en laat de bestaande gegevens beoordelen;
verwijder die trades niet om de reset te forceren.

## Uitvoeren

Voer deze commando's in de Linux-shell van de Pi uit, niet in een `psql`-prompt.
Sluit een open `psql`-sessie eerst met `\q`. Stop het runtime-service en maak
eerst een backup:

```bash
cd ~/ai-crypto-pulse-bot/raspberry-pi
sudo systemctl stop cryptopulse-runtime.service
sudo systemctl is-active cryptopulse-runtime.service
umask 077
sudo -u postgres pg_dump -Fc ai_crypto_bot_store \
  > "$HOME/ai_crypto_bot_store-before-paper-reset-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

De service hoort `inactive` te zijn. Zorg ook dat er geen handmatige
AI-analyse- of ingestiecommando's draaien. Pas de reset toe met de expliciete
bevestigingsoptie:

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 \
  --set=confirm_paper_reset=on \
  --dbname=ai_crypto_bot_store \
  --file=sql/reset-system-paper-data.sql
```

Zet daarna het startkapitaal op €2.000. Dit script accepteert alleen de schone
basissituatie die het reset-script heeft aangemaakt:

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 \
  --set=confirm_new_paper_capital=on \
  --dbname=ai_crypto_bot_store \
  --file=sql/start-system-paper-portfolio-2000.sql
```

Controleer de portefeuille en basissnapshot voordat de runtime opnieuw wordt
gestart:

```bash
sudo -u postgres psql --dbname=ai_crypto_bot_store --command="
SELECT portfolio.id, portfolio.starting_balance, portfolio.available_balance,
       portfolio.portfolio_value, snapshot.open_positions,
       snapshot.captured_at
FROM public.\"AI_Crypto_Bot_Portfolios\" AS portfolio
JOIN public.\"AI_Crypto_Bot_Profiles\" AS profile
  ON profile.id = portfolio.user_id
JOIN public.\"AI_Crypto_Bot_Portfolio_Snapshots\" AS snapshot
  ON snapshot.portfolio_id = portfolio.id
WHERE profile.id = '00000000-0000-4000-8000-000000000100'
ORDER BY snapshot.captured_at DESC, snapshot.snapshot_order DESC
LIMIT 1;"
```

Verwacht: `starting_balance`, `available_balance` en `portfolio_value` zijn
alle drie `2000`; `open_positions` is `0`. Controleer ook de nieuwste
emergency-state, agentstatus, bijgewerkte Pi-code en
`ENABLE_LIVE_TRADING=false`. Start pas daarna de Pi-runtime volgens de
bestaande operatorprocedure.

## Verwachte positiegrootte

Ja: bij een portfoliowaarde van €2.000 is de maximale BUY-notional ongeveer
**€200**, omdat de executor maximaal 10% van de actuele `portfolio_value`
gebruikt. De code beperkt die waarde ook tot wat het beschikbare saldo na
kosten toelaat. De fee van 0,25% komt boven op de notional (ongeveer €0,50
bij €200); 0,10% slippage is verwerkt in de gesimuleerde uitvoeringsprijs.
Afronding kan de notional iets onder €200 brengen. Het is een maximum, geen
vaste ordergrootte, en de limiet verandert mee met de actuele portfoliowaarde.

Bij SQL-fouten: stop, voer geen volgende stap uit en start de runtime niet.
Inspecteer de fout en de database voordat je verdergaat. Zie ook
[de migratieprocedure](database-migrations-on-pi.md); migraties worden hiermee
niet toegepast.
