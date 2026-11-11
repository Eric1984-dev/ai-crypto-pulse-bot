# Fase 1 — CryptoPulseBot-migratieaudit

> **Historische audit:** Dit document beschrijft de pre-cutover Supabase/Vercel-runtime en was een uitgangsmeting, geen actuele productie-inventaris. De huidige runtime- en deploymentgrenzen staan in [de Phase 10-cleanuprapportage](../post-migration-cleanup-report.md) en de actuele root-documentatie.

**Auditdatum:** 10 november 2026
**Doel:** huidige applicatie beoordelen voor een latere migratie naar een Raspberry Pi 3 met Node.js en PostgreSQL.

## Samenvatting

CryptoPulse is nu een Vercel-applicatie met Supabase als operationele database, authenticatie- en realtimevoorziening. De Pi-componenten zijn afzonderlijke archief- en healthdiensten. De huidige Market Scanner, AI Engine, market-data-ingestie, paper-trading-engine en dashboard lezen of schrijven hun operationele gegevens dus niet rechtstreeks naar PostgreSQL op de Pi.

Voor deze migratiefase bevestigt de gebruiker dat PostgreSQL op de Pi al operationeel is, dat het volledige schema is uitgevoerd en dat de benodigde gegevens al zijn overgezet. Dit is de opgegeven uitgangssituatie; er is geen live Pi-verbinding gebruikt om deze status onafhankelijk te verifiëren. De migratie richt zich daarom op applicatiecode, runtime en API-verkeer, niet op schema-installatie of data-overdracht.

De bedoelde markttabel is `public."AI_Crypto_Bot_Watched_Markets"`. Bestaande archiefconfiguratie/documentatie noemt `ai_crypto_bot_archive`, maar dat is niet read-only tegen de live primaire Pi-database bevestigd. Het in de repository vastgelegde contract bevat `id`, `symbol`, `enabled`, `priority`, `created_at` en `updated_at`. De scanner gebruikt deze Pi-tabel momenteel niet; hij leest de actieve markten uit de gelijknamige Supabase-tabel via PostgREST. Voor fase 2 moet de bestaande Pi-tabel de ongewijzigde bron voor de marktenlijst blijven.

**Conclusie:** deze fase levert een concreet plan om de applicatie gefaseerd naar de bestaande Pi-database te laten werken. De databasequery's en actuele schedulerconfiguratie zijn niet live getest; begin een uitvoeringsfase daarom met read-only connectiviteits-/contractcontroles, zonder schema of data opnieuw uit te voeren.

## 1. Auditgrenzen en bewijsstatus

- De audit is gebaseerd op de code, SQL-bestanden en documentatie in deze repository.
- Er is geen verbinding met Supabase of PostgreSQL op de Raspberry Pi gemaakt en er zijn geen SQL-query's uitgevoerd.
- Er is geen backup gemaakt, data gemigreerd of database gewijzigd.
- Er is geen applicatiecode gewijzigd, er zijn geen tradingorders uitgevoerd en er is geen deployment uitgevoerd.
- De gebruiker bevestigt dat het volledige schema en de benodigde data al op de Pi aanwezig zijn. Dit auditrapport behandelt dat als projectuitgangspunt, niet als door de audit geverifieerd databasefeit.
- De Pi-markttabel en kolommen hieronder zijn het repository-contract; dit bewijst niet de actuele tabeldefinitie of inhoud op het apparaat.
- Oudere repositoryrapporten beschrijven een Pi-archief/market-seed-POC en melden dat aantallen destijds niet zijn geverifieerd. De recentere projectinstructie van de gebruiker stelt dat de benodigde gegevens al zijn overgezet; er wordt niet opnieuw gezaaid, geïmporteerd of gemigreerd.

## 2. Huidige backendarchitectuur

### Applicatie

- De gebruikersinterface bestaat uit statische HTML-, CSS- en JavaScript-bestanden. De browser gebruikt Supabase Auth en Supabase Realtime; eigen gegevensaanvragen verlopen grotendeels via same-origin `/api/*`-routes.
- De backend bestaat uit Vercel Functions in `api/`, gedeelde Node.js-modules in `lib/` en PostgreSQL-functies/migraties in `supabase/migrations/`.
- Server-side dataverzoeken gebruiken Supabase PostgREST. Geauthenticeerde gebruikersaanvragen sturen de gecontroleerde gebruikers-JWT mee zodat Supabase RLS van toepassing blijft. Geplande ingestie, analyse en paper trading gebruiken de service-role key uitsluitend server-side.
- De root `package.json` heeft `node --test` en `node scripts/validate-project.js && node scripts/validate-database.js` als scripts; de applicatie heeft geen root-runtimeafhankelijkheid op de `pg`-driver.
- Er zijn 12 `.mjs`-bestanden onder `api/`, gelijk aan de gedocumenteerde Vercel Hobby-limiet. Er zijn geen aparte routebestanden voor Raspberry Pi-archivering.

### Belangrijkste API- en modulegroepen

| Onderdeel | Functie |
|---|---|
| `api/auth-config.mjs`, `api/auth-session.mjs`, `api/protected-page.mjs` | Publieke Supabase-configuratie, sessievalidatie/cookie en bescherming van HTML-pagina's. |
| `api/dashboard-data.mjs`, `api/agent-status.mjs` | Geauthenticeerde dashboard-, portfolio-, historie-, analytics-, aanbevelings- en statusgegevens. Dashboarddata wordt via één bestaande functie aangeboden met verschillende `view`-opties. |
| `api/market.mjs`, `api/market-summary.mjs` | Markt-/candlegegevens en scanneroverzichten via gedeelde handlers. |
| `api/market-refresh.mjs`, `api/candle-refresh.mjs` | Scheduler-beveiligde Bitvavo-ticker- en candle-ingestie. |
| `api/ai-analysis.mjs`, `api/paper-trading.mjs` | Scheduler-beveiligde analyse en afzonderlijke paper-trading-uitvoering. |
| `api/admin-actions.mjs` | Beveiligde handmatige AI-analyse- en paper-tradingacties voor geautoriseerde administrators. |
| `lib/market-data.mjs` | Publieke Bitvavo-data ophalen, valideren, cachen, opslaan en samenvatten. |
| `lib/market-scanner.mjs` | Read-only rankinglogica voor bestaande snapshots, candles en AI-beslissingen. |
| `lib/ai-engine.mjs` | Deterministische indicatoren, signalen, confidence en opslag van AI-beslissingen. |
| `lib/paper-trading.mjs`, `lib/shadow-exits.mjs` | Aansturing van de paper-trading-RPC en geïsoleerde hypothetische exit-scenario's. |
| `lib/analytics.mjs`, `lib/exports.mjs`, `lib/recommendations.mjs` | Analytics, exports en on-demand aanbevelingen op basis van bestaande databasegegevens. |
| `lib/auth-session.js`, `lib/admin-auth.js`, `lib/cron-auth.js` | Sessies, administratorautorisatie en scheduler-tokenvalidatie. |
| `archive-server/src/` | Afzonderlijke Pi-side healthdienst, archiefsynctools en PostgreSQL-verbinding. Deze dienst voert de huidige trading- of scannerlogica niet uit. |

De route- en databaseverdeling wordt ook beschreven in [API-documentatie](../API.md), [architectuurdocumentatie](../ARCHITECTURE.md) en [databasedocumentatie](../DATABASE.md).

## 3. AI-engine, Market Scanner en trading engine

### AI-engine en bullish/bearish-analyse

De standaardimplementatie is `Deterministic Technical Analysis V2` in `lib/ai-engine.mjs`. Het is geen LLM/AI-providerintegratie: beslissingen volgen vaste rekenregels op opgeslagen Bitvavo-snapshots en OHLCV-candles.

Per interval worden EMA 12/26, RSI 14, MACD, momentum, volume en volatiliteit berekend. EMA 12 boven EMA 26 wordt als bullish trend geclassificeerd; EMA 12 onder EMA 26 als bearish. MACD en momentum worden als diagnostische indicatoren opgeslagen, maar bepalen in V2 niet de richting.

De V2-richtingsscore gebruikt:

- 75% van de genormaliseerde 1d EMA-spread;
- 10% directionele overeenstemming van 1h- en 1d-trend;
- 10% bevestiging door de 1h-volumeratio;
- 5% bevestiging door 1d RSI.

De score wordt begrensd tot -100…100. Een positieve score kan `BUY` opleveren; een negatieve score kan `SELL` opleveren. Richtingssignalen vereisen een verse, bruikbare 1h-volumeratio en 1d EMA/RSI, minimaal vier verse intervallen met voldoende candles, en confidence van ten minste 65. Bij onvoldoende/ongeldige gegevens resulteert analyse in `WAIT`; bij een score met absolute waarde onder 20 of onvoldoende confidence resulteert zij in `HOLD`. `SELL` betekent in de executor een positie sluiten, niet short gaan.

De analyse gebruikt hoogstens 150 nieuwste candles per markt per interval en ondersteunt `1m`, `5m`, `15m`, `1h`, `4h` en `1d`. Het markt-snapshot moet maximaal 15 minuten oud zijn. De maximale leeftijd van de nieuwste candle is respectievelijk 30 minuten, 2 uur, 6 uur, 12 uur, 24 uur en 72 uur. Intervallen die niet vers zijn, worden uitgesloten; bij te weinig verse intervallen wordt geen richtingstrade-signaal gemaakt.

JavaScript is de standaardmodus. Een optionele database-side analyse kan via `AI_ANALYSIS_MODE=database` dezelfde API/RPC-route gebruiken, maar is expliciet opt-in. De repository documenteert dat productievalidatie van de nieuwste V2-databasevervanging nog niet is bevestigd. De uiteindelijke ingestie/engineverplaatsing mag dus niet uitgaan van een live geverifieerde database-modus.

### Market Scanner

`lib/market-scanner.mjs` is een read-only rangschikker; hij genereert geen nieuwe AI-beslissingen en plaatst geen trades. De scanner combineert:

- ingeschakelde watched markets en prioriteit;
- snapshots uit `AI_Crypto_Bot_Market_Data`;
- `1h`- en `1d`-candles uit `AI_Crypto_Bot_Candles`;
- de meest recente opgeslagen beslissingen uit `AI_Crypto_Bot_AI_Decisions`.

Hij rangschikt per periode van 24 uur, 7 dagen en 30 dagen topstijgers, topdalers, EUR-volume, momentum en AI-kansen. Voor 24-uursmomentum wordt 6-uurs candleverandering gebruikt; voor 7 dagen 3 dagen; voor 30 dagen 7 dagen. Alleen verse/valide input wordt getoond. De marktdata-service haalt de markt-universe momenteel via Supabase PostgREST op, niet vanaf de Pi.

### Trading engine en risicoregels

De AI-engine slaat beslissingen op, maar schrijft zelf geen portfolio-, positie- of tradegegevens. De paper-trading-RPC in PostgreSQL voert de beslissing daarna transactioneel uit, na de risicocontroles. De huidige gedocumenteerde regels zijn:

- maximale entry-notional 10% van de portfolio-waarde;
- maximaal vijf open posities;
- minimum-confidence voor een nieuwe BUY-entry momenteel 67 (een gedocumenteerd experiment; de oorspronkelijke baseline was 70);
- cooldown van 15 minuten per markt na een trade;
- gesimuleerde fee 0,25% en adverse slippage 0,10%;
- nieuwe entries blokkeren vanaf 5% dagelijkse drawdown of 15% portfolio-drawdown;
- emergency stop bij 20% drawdown, met status `STOPPED`;
- verse SELL-besluiten mogen bestaande posities sluiten; HOLD/WAIT handelen niet.

De executor werkt alleen met opgeslagen besluiten en marktprijzen. Database-locks en idempotency voorkomen gelijktijdige/gedupliceerde trades. Shadow Exit Scenarios zijn uitsluitend simulaties en hebben geen uitvoeringsbevoegdheid. De details staan in [Risk Management](../RISK_MANAGEMENT.md).

## 4. Bitvavo en paper/live-functionaliteit

- `lib/market-data.mjs` gebruikt uitsluitend publieke Bitvavo-API-routes voor marktcatalogus, 24-uurs-tickers en candles. Er is geen Bitvavo-API-key nodig.
- Marktdata wordt gevalideerd en kort gecachet; snapshots en candles worden in de bestaande prefixed Supabase-tabellen opgeslagen. Providerfouten laten opgeslagen gegevens ongemoeid en worden als fouten/events gerapporteerd.
- Er zijn geen private Bitvavo-account-, saldo- of orderroutes. Er wordt geen echte order uitgevoerd.
- De huidige handelsmodus is **PAPER ACTIVE**. `ENABLE_LIVE_TRADING=false` is vereist voor de paper-trading-endpoint; andere waarden blokkeren die endpoint. Live trading is niet geïmplementeerd.

## 5. Supabase-afhankelijkheden

| Afhankelijkheid | Huidig gebruik | Gevolg voor migratie |
|---|---|---|
| Supabase Auth | Browser-SDK voor registratie/login/wachtwoordstromen; Vercel valideert tokens en sessiecookies. | Auth- en gebruikersprofielbeheer moet behouden/vervangen worden voordat de bestaande beveiligde dashboardroutes kunnen blijven werken. |
| Supabase PostgreSQL | Operationele tabellen, RLS, triggers, constraints en server-only RPC's voor paper trading, candle reads, statistieken en shadow exits. | De SQL- en autorisatiemodellen zijn niet automatisch gelijk aan een zelfstandige PostgreSQL-installatie; RPC's, rollen, Auth-referenties en grants moeten gericht worden herontworpen en getest. |
| Supabase PostgREST | Vercel Functions lezen/schrijven via `/rest/v1/`; gebruikersreads gebruiken JWT/RLS, schedulerprocessen de service-role key. | De huidige clients kunnen niet zonder adapter op lokale PostgreSQL draaien. |
| Supabase Realtime | Browserabonnementen ontvangen invalidaties; de pagina ververst de benodigde data via bestaande API's. Er wordt geen muterende gebeurtenispayload gebruikt. | Voor Pi-dashboardupdates is een alternatief nodig of polling blijft bestaan. |
| Supabase JS CDN-client | Auth en Realtime in de browser, geladen via jsDelivr. | Als Supabase niet langer operationeel wordt gebruikt, moeten browserauth en realtime-initialisatie worden aangepast. |
| Supabase migraties/rollen | Tabellen, triggers, RLS en rollen zijn in de repository gedefinieerd; functies gebruiken onder meer `auth.uid()`, Supabase-rollen en `SECURITY DEFINER`/`INVOKER`. | Volgens de gebruiker is het schema al op de Pi uitgevoerd. Voer geen migratie opnieuw uit. Controleer later alleen read-only of bestaande objecten/signatures/rechten de directe runtime-aanroepen ondersteunen. |

Ook archiveringscredentials zijn apart van de Vercel-service-role key ontworpen. De Pi-side sync gebruikt directe, TLS-gevalideerde PostgreSQL-verbindingen met een begrensde reader en een aparte writer. De sync is geen operationele route voor scanner of trading.

### Databaseverzoeken en databasebewerkingen die nog van Supabase los moeten

| Huidige caller | Huidige operatie | Vervanging in de Pi-runtime |
|---|---|---|
| `lib/market-data.mjs` | PostgREST-reads van watched markets, snapshots en candles; checkpoint-RPC; inserts/upserts van marktdata, candles en scanner-events. De huidige market sync kan ontbrekende configured markets in Watched Markets invoegen. | Parameterized `pg`-queries en transacties op de bestaande Pi-DB. Lees de bestaande marktrows; zet de Supabase/config-market auto-seed uit de operationele Pi-flow. Schrijf alleen de data-tabellen die de bestaande ingestie moet bijhouden. |
| `lib/ai-engine.mjs` | Reads van status/markets/snapshots en candle-RPC; PATCH van agentstatus; INSERT van beslissingen; optionele database-AI-RPC. | Reads/writes via `pg`. Gebruik de bestaande AI-/statusfunctie indien lokaal aanwezig en direct aanroepbaar, of port de huidige JavaScript-engine; houd V2-score, confidence, freshness en output-identiek. De database-mode-RPC is optioneel en geen vereiste voor de eerste Pi-engine. |
| `lib/paper-trading.mjs` | POST naar `AI_Crypto_Bot_Run_Paper_Trading()` via PostgREST. | Parameterized directe SQL-aanroep van de bestaande functie, uitsluitend na read-only bevestiging van signature/rechten, of gelijkwaardige transactionele code. Behoud lock-, idempotency- en risk-guards. |
| `lib/shadow-exits.mjs` | POST naar `AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios()`; best-effort onderdeel van paper run. | Directe DB-functieaanroep als het bestaande dashboard-/simulatiegedrag behouden blijft; dit blijft nooit een order- of portfolio-uitvoerder. |
| `api/dashboard-data.mjs` | Geauthenticeerde PostgREST-SELECTs voor status, emergency state, portfolio's, posities, trades, markten, besluiten, snapshots, marktdata en shadow-scenario's; trade-statistiek-RPC. | Pi API-repositories met expliciete queries, parameterbinding, paging en autorisaties. Houd het bestaande JSON-contract aan zodat dashboardpagina's niet functioneel veranderen. |
| `lib/analytics.mjs`, `lib/exports.mjs`, `lib/recommendations.mjs` | PostgREST-SELECTs, filters, count/range-paginering over portfolio-, position-, trade-, snapshot- en AI-decision-tabellen. | Leesqueries/aggregate queries via `pg`; behoud exacte filter-, UTC-, sorteer-, count- en exportsemantiek en bestaande response-shapes. |
| `api/agent-status.mjs`, market/API-handlers | Authenticated reads en geselecteerde markt-/candle-refreshes via PostgREST. | Leesstatus/gegevens via de Pi API. Directe Bitvavo-fetch blijft bij de backend; de browser krijgt geen databaseverbinding. |

De huidige app-callable Supabase RPC's zijn:

| Functie | Huidig gebruik | Migratiebehandeling |
|---|---|---|
| `AI_Crypto_Bot_Get_Latest_Candle_Checkpoints(text[], text)` | Incrementele candle-refresh. | Directe aanroep met gebonden parameters; controleer dat de functie/index al in de bestaande Pi-DB zit. |
| `AI_Crypto_Bot_Get_Latest_AI_Candles_Compact(text[], text)` | JavaScript AI-engine; batches van maximaal vier symbols en maximaal 150 candles per symbol. | Directe parameterized query/functieaanroep of gelijkwaardige bounded select; behoud exacte volgorde, volledigheids- en freshnessvalidatie. |
| `AI_Crypto_Bot_Run_Database_AI_Analysis(timestamptz)` | Optionele `AI_ANALYSIS_MODE=database`-route. | Optioneel vervangen; de JavaScript-engine is de standaard en voorkomt dat fase 2 afhankelijk wordt van een opt-in SQL-pad. |
| `AI_Crypto_Bot_Run_Paper_Trading()` | Paper executor. | Behoud bestaande transactie/risico-/idempotencylogica; verifieer dat de Pi-runtime rol de bestaande functie mag aanroepen. Geen nieuw schema uitvoeren. |
| `AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios()` | Best-effort schaduwscenario-evaluatie bij paper trading. | Behoud bestaande simulatie indien huidige UI-functionaliteit dit vereist; blijft gescheiden van trades. |
| `AI_Crypto_Bot_Trade_History_Stats()` | Dashboardstatistieken voor trade history. | Directe function call of equivalente SQL-aggregatie, met dezelfde metrics en filtersemantiek. |
| `AI_Crypto_Bot_Get_Latest_AI_Candles(text[], text)` | Oudere flat-row candle-RPC die in het schema voor compatibiliteit blijft. | Geen actieve caller gevonden in huidige JavaScript-code; alleen verwijderen uit afhankelijkheden als geen andere runtime/caller hem gebruikt. |

Daarnaast zijn `AI_Crypto_Bot_Set_Updated_At`, `AI_Crypto_Bot_Sync_Auth_Profile`, portfolio provisioning/refresh/decision-apply functies en `AI_Crypto_Bot_Internal`-AI helpers database-triggers of interne helperfuncties. Ze zijn geen losse HTTP-endpoints; behoud hun huidige effecten, maar verifieer de installed function/signature/grants voordat de Pi-user ze direct gebruikt. Het overzetten van PostgREST naar `pg` verandert niet vanzelf RLS-context: de Pi API moet elke gebruikersoperatie zelf autoriseren en mag geen onbeperkte DB-role aan het dashboard blootstellen.

## 6. Bestaande geplande taken

`vercel.json` declareert **geen** `crons`. De functies zijn endpoint-geschikt voor een externe scheduler; de opgeslagen externe configuratie en feitelijke productie-uitvoeringen zijn in de documentatie niet geverifieerd.

| Taak | Endpoint | Werk en randvoorwaarden |
|---|---|---|
| Market snapshot refresh | `GET /api/market-refresh` | Synchroniseert/valideert watched markets en ververst stale ticker-snapshots; geen candle-ingestie. Vereist scheduler-Authorization en server-side Supabase service-role key. |
| Candle refresh | `GET /api/candle-refresh?interval=<interval>&batch=<index>` | Een interval (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) en één batch per request; maximaal vijf markten per batch. Voor volledige dekking moeten alle batches voor alle gewenste intervallen worden gepland. |
| AI-analyse | `POST /api/ai-analysis` | Leest verse snapshots/candles en slaat beslissingen op; maakt zelf geen trades. Overlappende status voorkomt een tweede analysetrun. |
| Paper trading | `POST /api/paper-trading` | Moet na succesvolle AI-analyse lopen, niet gelijktijdig; verwerkt opgeslagen beslissingen met database-locks en idempotency. Live-tradingvlag moet `false` zijn. |
| Handmatige AI-decision-archivering | `npm run sync:ai-decisions` in `archive-server/` | Pi-side pull naar de archiefdatabase. Dit is handmatig, geen Vercel Cron of actieve systemd-timer volgens de schedulingdocumentatie. |

Documentatie noemt vijf minuten als redelijke startcadans voor ticker-snapshots en meldt circa vijf minuten effectieve spacing van opgeslagen AI-besluiten, maar de externe cronexpressies zijn niet opnieuw gecontroleerd. De candlecadans en batchdekking zijn operationele instellingen, geen Vercel-configuratie. De werkelijk actieve taken moeten vóór migratie worden geïnventariseerd.

## 7. Hoe het Vercel-dashboard gegevens ophaalt

1. De browser initialiseert de Supabase Auth-client en verkrijgt een geauthenticeerde sessie.
2. De browser vraagt same-origin Vercel Functions aan met de sessiecookie; beschermde endpoints verifiëren de gebruiker met Supabase Auth.
3. Dashboarddata wordt door `GET /api/dashboard-data` gelezen uit Supabase met de gebruikers-JWT en anon key zodat RLS portfolio-, trade- en gebruikersgegevens afschermt. Er wordt geen service-role key aan de browser gegeven.
4. Status wordt afzonderlijk gelezen via `/api/agent-status`; markt-/scannerresultaten via `/api/market-summary`. De dashboardpagina pollt dashboarddata periodiek en gebruikt Supabase Realtime-events als invalidaties met polling als fallback.
5. De Pi-kaart vraagt `/api/dashboard-data?view=archive-health` op. De Vercel-handler doet een begrensde HTTPS-aanvraag met bearer-token naar de Pi-healthdienst. Dat controleert bereikbaarheid, database-identiteit/-grootte en diskgebruik; het haalt geen scanner- of tradingdata op.

De Pi-healthview maakt de Pi niet tot bron voor het dashboard of de bot. Zie de [dashboard/API-contracten](../API.md) en [Pi-monitoringdocumentatie](../reports/ARCHIVE_SERVER_MONITORING.md).

## 8. PostgreSQL op de Raspberry Pi en bestaande marktenlijst

### Repository-contract

De repository gebruikt als archiefdatabase de naam `ai_crypto_bot_archive`. De bedoelde markttabel staat in schema `public` en heet exact:

```text
public."AI_Crypto_Bot_Watched_Markets"
```

De kolommen volgens `AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql`, `archive-server/src/archive-market-seed.mjs` en de import/exportbestanden:

| Kolom | Type | Gebruik |
|---|---|---|
| `id` | `uuid` | Primaire sleutel |
| `symbol` | `text` | Uniek marktsymbool, bijvoorbeeld `BTC-EUR` |
| `enabled` | `boolean` | Of de markt actief is |
| `priority` | `integer` | Positieve prioriteit; lagere waarde wordt eerder gesorteerd |
| `created_at` | `timestamptz` | Aanmaaktijd |
| `updated_at` | `timestamptz` | Laatste wijziging |

De archive market seed-code valideert deze zes kolommen en de primary-key-/unique-symbol-constraints. `market_export.sql` verwachtte bij het maken van dat exportcontract 102 bronrijen; dat is geen actuele telling van de Pi. De rapportage over de seed markeert live aantallen/kopieerresultaten als niet uitgevoerd/niet verifieerbaar. De door de gebruiker gemelde bestaande Pi-marktlijst is daarom niet onafhankelijk vergeleken met dit contract.

### Behoud en scanner-toegang
The existing Watched Markets table is the only source of truth.

No configuration file may add markets.

No synchronization process may add markets.

No seed process may add markets.

The active market universe is determined solely by:

public."AI_Crypto_Bot_Watched_Markets"

 Fase 2 mag geen configuratielijst uit `config/markets.js` als vervanging gebruiken, geen seed uitvoeren en geen rijen toevoegen, bijwerken of verwijderen. De bestaande code heeft een `archive-market-seed`-utility die een Supabase-lijst naar de archieftabel kan upserten; deze audit heeft die utility niet uitgevoerd. Deze utility is geen scanner-reader en er staat geen seed-commando in `archive-server/package.json`.

De huidige scanner leest alleen de Supabase-tabel. Een Pi-implementatie kan de bestaande marktlijst read-only via de bestaande `pg`-driver ophalen met een beperkte query van deze vorm:

```sql
SELECT symbol, enabled, priority
FROM public."AI_Crypto_Bot_Watched_Markets"
WHERE enabled IS TRUE
ORDER BY priority ASC, symbol ASC;
```

Dit is een doelontwerp, geen uitgevoerde query. De scanner heeft de drie genoemde velden nodig; voor audit/vergelijking blijven de overige drie velden behouden. Gebruik een read-only databasegebruiker voor deze reader en pas de actieve markt-universe nooit automatisch aan. De bestaande lijst blijft de runtime-bron van waarheid.

De market-data-service valideert nu `config/markets.js` tegen de Bitvavo catalogus en kan nieuwe symbols in Watched Markets toevoegen. Dat bestaande gedrag mag niet ongewijzigd aan de Pi-runtime worden gekoppeld: de migratie mag de reeds aanwezige Pi-marktlijst niet aanvullen, overschrijven of verwijderen. Refreshes moeten alleen reeds ingeschakelde Pi-markten verwerken.

## 9. Raspberry Pi 3-geschiktheid

| Aspect | Korte beoordeling |
|---|---|
| ARM/Node.js | De geïsoleerde Pi-service vraagt Node.js `>=20.6` en gebruikt de `pg`-driver. Controleer vóór installatie de exacte Pi 3-variant, OS (32-/64-bit), beschikbare Node-build en dependencycompatibiliteit. De repository bevat geen hardware- of OS-verificatie. |
| RAM | Een Pi 3 heeft doorgaans 1 GB RAM. PostgreSQL, OS, Node-processen en eventuele lokale dashboard/API-processen delen dit geheugen. Het is haalbaar voor een bescheiden workload, maar beperkt voor gelijktijdige markt-/candletaken; meet geheugengebruik en stel limieten in. |
| CPU | Deterministische indicatoren zijn lichter dan lokale LLM-inference, maar huidige AI-candleverwerking en scannerpaginering zijn ontworpen voor Supabase/Vercel en concurrency tot 24 RPC-requests. Die concurrency is niet geschikt om zonder meting naar de Pi over te nemen. Begin met lage, begrensde concurrency en meet volledige runtimes. |
| PostgreSQL | Geschikt voor kleine operationele datasets mits schema, indexen, verbindingen, WAL, vacuum en diskruimte worden beheerd. De Pi-healthservice gebruikt een pool van maximaal één verbinding, maar dat is alleen voor healthchecks en zegt niets over de benodigde tradingpool. |
| Opslag | Candles, beslissingen, trades en snapshots zorgen voor doorlopende writes. Een betrouwbare SSD is geschikter dan een microSD voor langdurige database-WAL/writebelasting. Backups, hersteltest, diskmonitoring en retentie zijn nodig. Er is geen backupstatus vastgesteld. |
| AI | De huidige engine is deterministisch en heeft geen externe AI-provider nodig. Lokale AI-inference is niet vereist en is op een Pi 3 ongeschikt voor substantiële modellen. Eventuele toekomstige generatieve verwerking kan extern plaatsvinden, maar is geen huidige functionaliteit en vereist een aparte provider-/privacybeslissing. |
| Geplande taken | Eén langlopend Pi Node.js-proces met interne scheduler. `systemd` beheert alleen boot, restart en procesbewaking; geen externe scheduler, Vercel-executor of aparte `systemd`-timer. De volledige doelvolgorde staat in [runtime-execution-spec.md](./runtime-execution-spec.md). |

**Kort oordeel:** Raspberry Pi 3 kan waarschijnlijk een zorgvuldig begrensde Node.js/PostgreSQL-workload uitvoeren, maar de huidige Vercel/Supabase-configuratie is niet plug-and-play naar die hardware te verplaatsen. De candlehistorie-/writebelasting, databasegrootte, schedulerconcurrency, SSD- en herstelstrategie moeten op de daadwerkelijke Pi worden gemeten voordat de volledige bot daar als enige runtime wordt beschouwd.

## 9.1 Market Load Constraints
The production system currently monitors approximately 100 markets.

The migration must assume
100 enabled markets.

Performance validation may not be based on
10 or 20 demonstration markets.

All scheduler, scanner,
AI analysis and database workloads
must be tested against the expected
100-market production universe.

Performance Targets

The migration must be validated against approximately 100 enabled markets.

Target requirements:

- Full pipeline must complete before the next cycle begins.
- No execution overlap.
- Stable memory consumption.
- No database growth caused by retry loops.
- No duplicate AI decisions.
- No duplicate paper trades.

The system must remain operational on a Raspberry Pi 3 with approximately 1 GB RAM.

## 10. Voorgestelde doelarchitectuur voor fase 2

1. **Pi PostgreSQL als operationele bron:** behoud `public."AI_Crypto_Bot_Watched_Markets"` en alle bestaande rijen; gebruik deze tabel read-only voor scan-/analyse-universe. Behoud de kolommen, symbolen, enabled-vlaggen en prioriteiten exact.
2. **Node.js worker/service op de Pi:** vervang de Vercel-schedulerketen door één gecontroleerde Node-runtime die market refresh, candle refresh, AI-analyse en paper-trading uitvoert.
Use a single long-running Node.js runtime on the Raspberry Pi.

The runtime owns:

- market refresh
- candle refresh
- AI analysis
- paper trading
- health monitoring

Use systemd only to:

- start the runtime at boot
- restart on crash
- monitor process health

Do not use separate systemd timers.

Do not use external schedulers.

The runtime itself is responsible for sequencing and execution.
3. **Databaseadapter en SQL-transacties:** vervang Supabase REST/RPC-aanroepen door expliciete PostgreSQL-repositories en lokale transacties. Port de risk checks, idempotency, locking en statusovergangen met parity-tests voordat de Pi worker writes mag doen.
4. **Verwerkers in vaste volgorde:** verfris snapshots/candles; voer analyse uit; voer pas na succesvolle analyse paper trading uit. Behoud freshness-, cooldown-, confidence-, drawdown-, noodstop- en PAPER-only-guards.
5. **Begrensde belasting:**
Single Owner Execution

At any point in time only one execution pipeline exists.

Sequence:

1. Refresh market snapshots
2. Refresh candles
3. Run AI analysis
4. Execute paper trading
5. Update status
6. Sleep until next cycle

No concurrent trading pipeline may exist.

A new cycle may only begin after the previous cycle completes.
6. **Beveiligde presentatie/API:** expose PostgreSQL niet rechtstreeks aan browser of Internet. Als dashboardtoegang nodig blijft, gebruik een afgeschermde lokale API of reverse proxy met TLS/auth; dashboard leest alleen via die API. Vercel kan eventueel statische UI blijven hosten, maar is dan niet de bot-runtime of datastore.
7. **Bestaande Pi-database gebruiken:** de gebruiker bevestigt dat deze database het volledige schema en de benodigde data bevat en de primaire database wordt. Verbind de backend met de bestaande database; maak geen database aan, voer geen migrations/schema uit en kopieer geen Supabase-data opnieuw. `ai_crypto_bot_archive` is de naam in bestaande repositoryconfiguratie en moet niet zonder read-only identiteitscontrole als de definitieve operationele database worden aangenomen.
8. **Geen live trading:** behoud paper-only gedrag en `ENABLE_LIVE_TRADING=false`; live trading valt buiten deze migratiefase.

Database Compatibility Rule

The migration is a runtime migration only.

All existing tables must remain unchanged.

All existing functions must remain unchanged.

All existing views must remain unchanged.

All existing AI decision data,
trade history,
portfolio history,
market history
and analytics data
must remain accessible.

The Raspberry Pi runtime must adapt to the existing database.

The database must not be redesigned to adapt to the Raspberry Pi.

Logic Parity Rule

The migration is a runtime migration only.

The following behaviour must remain identical:

- AI scoring
- confidence calculations
- indicator calculations
- signal generation
- scanner ranking
- paper trading execution
- risk management
- drawdown handling
- emergency stop handling
- cooldown handling

The Raspberry Pi runtime must reproduce the existing behaviour.

No strategy changes may be introduced during migration.

No indicator weights may change.

No confidence thresholds may change.

No risk settings may change.

No entry or exit logic may change.

Behavioural changes are only allowed after the migration is fully completed and validated.


## 11. Risico's en ontbrekende informatie

1. **Database niet live bevraagd:** de gebruiker bevestigt schema/data op de Pi; exacte database-identiteit, PostgreSQL-versie, tabellen/rijtellingen, market-row-inhoud, function signatures en runtime-rechten zijn niet door deze audit gelezen.
2. **Marktuniverse beschermen:** huidige Vercel-market-refresh kan markten vanuit `config/markets.js` toevoegen. Deze synchronisatie moet uit de Pi-runtime verdwijnen; uitsluitend de bestaande, ingeschakelde Pi-rows sturen de scanner.
3. **Auth/RLS vervangen:** gebruikersgegevens zijn nu met Auth-user-ID en `auth.uid()`/RLS afgeschermd. Een directe databaseverbinding omzeilt PostgREST/RLS-claims; de nieuwe Pi API moet expliciete server-side authorisatie krijgen.
4. **RPC-rechten en signatures:** de SQL-functies kunnen al in de Pi-schema zitten, maar PostgREST `/rpc` is geen PostgreSQL-protocol. Directe aanroepen vereisen bekende signatures, werkende dependencies, geschikte DB-rol en tests van transactiegedrag.
5. **Schedulerconfiguratie niet geverifieerd:** `vercel.json` bevat geen Cron; externe cadans, batchvolledigheid, secrets en laatste succesvolle runs zijn niet vastgesteld. De paper executor moet alleen volgen op succesvolle analyse.
6. **Pi-capaciteit onbekend:** modelvariant, OS/architectuur, vrij geheugen, opslagtype/-ruimte, temperatuur/throttling, backupplan en gemeten workload ontbreken.
7. **Vercel-limiet:** de bestaande 12 API-bestanden vullen de Hobby-limiet; geen nieuwe Vercel-route toevoegen. Het doel gebruikt Vercel uitsluitend voor statische frontend/dashboard.
8. **Realtime- en sessiegedrag:** Supabase Realtime levert invalidaties; polling is fallback. Het verwijderen van Supabase vereist vervanging van login, sessievalidatie, admin allowlist, beschermde routes en liefst dezelfde update-ervaring.
9. **Beveiliging en netwerk:** expose PostgreSQL niet. De Vercel-naar-Pi-API moet TLS, strikte authenticatie/originregels, bounded requests, rate limiting en veilige secretbeheer afdwingen; geen service-/DB-token in de browser.

## 12. Uitgevoerde validatie

- `npm run build` — geslaagd. Project- en databasevalidatiescripts zijn uitgevoerd als lokale, statische repositorycontroles; er is geen databaseverbinding geopend en geen schema toegepast.
- Gerichte Node-tests — 290 geslaagd, 0 mislukt, 0 overgeslagen uit de 25 testbestanden die geen PGlite-schema-opzet uitvoeren.
- Niet uitgevoerd: `database-migrations.test.js`, `archive-decision-reader-migration.test.js`, `archive-ai-decisions.test.mjs` en `archive-decision-writer-sql.test.mjs`. Deze suites zetten PostgreSQL-schema in PGlite op; ze zijn overgeslagen om de fasegrens tegen schema-uitvoering te respecteren.
- Geen live read-only query tegen de Pi-PostgreSQL, Supabase of productie uitgevoerd. De database-/marktlijststatus blijft gebaseerd op de gebruikersbevestiging en repositorydocumentatie, niet op een externe verificatie.

## 13. Fase 2-startbesluit

De code- en architectuuraudit plus dit plan zijn voldoende als startpunt voor fase 2, zodra de gebruiker die fase goedkeurt. De eerste uitvoeringsstap moet een beperkte read-only verbinding-/contracttest met de bestaande Pi-PostgreSQL zijn; die test is geen aanleiding om schema of data te wijzigen.

Voor implementatie zijn minimaal nodig:

- read-only vaststelling van de bestaande database-identiteit, connection path en DB-role capabilities;
- read-only bevestiging van Watched Markets en de bestaande function signatures; geen selectielijst aanpassen of seeden;
- besluit over de Pi API-authenticatie en Vercel-naar-Pi TLS/origin-/sessiegrens;
- gecontroleerde mapping van PostgREST-query's/RPC's naar directe parameterized PostgreSQL-operaties met paper-trading parity-tests;
- inventarisatie van externe schedules en gemeten Pi-capaciteit; herstel-/backupvalidatie apart plannen zonder in deze fase data te wijzigen.

Tot die gates zijn afgerond: geen seed/import, geen marktwijzigingen, geen databasewrites, geen live orders en geen verwijdering van bestaande data.

Het volledige afhankelijkhedenoverzicht staat in [migratiearchitectuur](architecture.md); de voorgestelde fasering en gatingcriteria staan in de [migratieroadmap](roadmap.md).

## Bronnen in de repository

- [Projectinstructies](../../AGENTS.md), [README](../../README.md), [roadmap](../../ROADMAP.md)
- [Architectuur](../ARCHITECTURE.md), [database](../DATABASE.md), [API](../API.md), [scheduling](../SCHEDULING.md), [deployment](../DEPLOYMENT.md), [risk management](../RISK_MANAGEMENT.md)
- [AI-engine](../../lib/ai-engine.mjs), [market scanner](../../lib/market-scanner.mjs), [market-data service](../../lib/market-data.mjs), [paper-trading service](../../lib/paper-trading.mjs)
- [Vercel-configuratie](../../vercel.json), [API-handlers](../../api), [Pi archive-service](../../archive-server)
- [Archiefschema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql), [market export](../../market_export.sql), [market import](../../market_import.sql), [market-seedstatus](../reports/ARCHIVE_MARKET_SEED_IMPLEMENTATION.md), [archiefsync-architectuur](../reports/ARCHIVE_SYNC_ARCHITECTURE.md)

## Historical Analysis Preservation
Historical decision data is a strategic asset.

The migration may optimize runtime performance
but must not remove the ability to evaluate:

- historical AI decisions
- historical confidence scores
- historical indicators
- historical market conditions
- historical trades
- historical portfolio performance

Future strategy improvement and
decision-quality analysis remain requirements.

Performance optimizations must preserve
analysis capability.

Future Optimization Boundary

Performance optimizations may be implemented after migration.

The migration phase itself must not:

- remove historical decision records
- remove historical trade records
- remove historical portfolio records
- remove historical market records
- change retention policies

Any future data retention or archival strategy must be implemented only after migration completion and after validation of analytical requirements.