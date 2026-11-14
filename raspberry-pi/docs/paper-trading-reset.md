# Volledige paper-data reset en starten met €2.000

Dit is een destructieve, operatorgestarte reset voor een nieuwe paper-tradingrun.
Het SQL-script is nooit automatisch onderdeel van de runtime en wordt niet
uitgevoerd tijdens installatie of deployment. Maak eerst een databasebackup en
voer het alleen uit wanneer je de beschreven historie bewust wilt wissen.

## Wat wordt verwijderd en behouden

`sql/reset-system-paper-data.sql` wist in één transactie:

- paper execution-audit (eerst, vanwege de foreign key naar trades);
- trades, posities, portfolio-snapshots en AI-beslissingen;
- shadow-exit events/scenario's en analytics-runs, indien geïnstalleerd;
- marktprijs-snapshots en alle candlehistorie;
- scanner-events;
- strategie-wijzigingen, strategieprestaties en backtests.

De bestaande profielrijen, de watched-marketslijst, het systeemportfolio en de
strategie-definities blijven bestaan. Het systeemportfolio wordt in hetzelfde
script op `starting_balance`, `available_balance` en `portfolio_value` van
`2000` gezet, met één nieuwe basissnapshot en nul open posities. Agentstatus en
alle emergency-state-rijen blijven bewust behouden: een bestaande
`EMERGENCY_STOP` of `PAUSED` wordt nooit gewist of omzeild. Controleer de meest
recente status voordat je de runtime opnieuw start.

Het script weigert te starten bij een ontbrekende vereiste tabel, een
inconsistente set shadow-exittabellen, meer dan één systeemportfolio of enig
niet-systeemportfolio. Zo worden gedeelde trades, audit- of portfoliohistorie
niet per ongeluk verwijderd. Herstel dan eerst de database-situatie; forceer
de reset niet.

Er worden geen tabellen, constraints of andere schema-objecten aangepast en er
wordt geen `TRUNCATE` gebruikt. De watched markets blijven ongewijzigd. Omdat
marketdata en candles wel worden gewist, moeten die opnieuw worden opgehaald;
de eerste candle-bootstrap is begrensd op 150 gesloten candles per markt en
interval. De paper-engine kan pas analyseren/handelen als voldoende verse data
beschikbaar is.

## Uitvoeren via PowerShell/SSH

Open in Windows PowerShell een SSH-sessie naar de Pi:

```powershell
ssh eric@raspberrypi
```

De commando's hieronder voer je daarna uit in de Linux-shell op de Pi (waar de
prompt bijvoorbeeld `eric@raspberrypi:~$` toont), niet binnen `psql`. Als de
Pi-repository nog niet is bijgewerkt:

```bash
cd ~/ai-crypto-pulse-bot
git pull --ff-only origin main
cd raspberry-pi
```

Stop de runtime en controleer dat deze niet meer draait. Sluit eventuele open
`psql`-sessies met `\q` en zorg dat er geen handmatige AI-, ingestie- of
paper-tradingcommando's lopen:

```bash
sudo systemctl stop cryptopulse-runtime.service
sudo systemctl is-active cryptopulse-runtime.service
```

De tweede opdracht hoort `inactive` te tonen. Maak daarna een backup en
controleer dat het dumpbestand bestaat en niet leeg is:

```bash
umask 077
backup="$HOME/ai_crypto_bot_store-before-full-reset-$(date -u +%Y%m%dT%H%M%SZ).dump"
sudo -u postgres pg_dump -Fc ai_crypto_bot_store > "$backup"
test -s "$backup" && ls -lh "$backup"
```

Voer de reset uit met de expliciete bevestigingsoptie. De transactie wordt
afgebroken bij een SQL-fout:

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 \
  --set=confirm_paper_reset=on \
  --dbname=ai_crypto_bot_store \
  --file=sql/reset-system-paper-data.sql
```

Controleer de nieuwe portefeuille en basissnapshot:

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store --command="
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

Verwacht: alle drie balansvelden zijn `2000` en `open_positions` is `0`.
Controleer de lege geschiedenis en de behouden gegevens:

```bash
sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store --command="
SELECT
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Trades\") AS trades,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Positions\") AS positions,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_AI_Decisions\") AS decisions,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Paper_Execution_Audit\") AS execution_audit,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Market_Data\") AS market_data,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Candles\") AS candles,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Scanner_Events\") AS scanner_events,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Watched_Markets\") AS watched_markets,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Profiles\") AS profiles,
  (SELECT count(*) FROM public.\"AI_Crypto_Bot_Strategies\") AS strategy_definitions,
  (SELECT status FROM public.\"AI_Crypto_Bot_Emergency_State\"
   ORDER BY created_at DESC, id DESC LIMIT 1) AS emergency_state,
  (SELECT status FROM public.\"AI_Crypto_Bot_Status\"
   ORDER BY updated_at DESC, id DESC LIMIT 1) AS agent_status;"
```

Trades, positions, decisions, execution audit, market data, candles en scanner
events horen `0` te zijn; de watched-market-, profile- en strategy-definition
rijen horen behouden te zijn. Controleer dat de meest recente emergency-state
en agentstatus kloppen en dat `ENABLE_LIVE_TRADING=false`. Start de runtime pas
opnieuw wanneer de reset en deze controles succesvol zijn. Candlehistorie moet
opnieuw worden opgebouwd voordat AI-analyse weer voldoende verse intervallen
heeft. Voer bij een SQL-fout geen volgende stap uit.

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
