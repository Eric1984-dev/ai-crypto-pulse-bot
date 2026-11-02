# CryptoPulse AI Agent

CryptoPulse is een crypto-analyse- en paper-tradingplatform in ontwikkeling. Phase 02 levert Supabase Authentication, Phase 03 het PostgreSQL-schema met Row Level Security, Phase 04 een database-gestuurd dashboard, Phase 05 Agent Status-visualisatie, Phase 06 publieke Bitvavo-marktdata, Phase 07 de deterministische AI Engine, Phase 08 de risk-managed paper-trading-engine, Phase 09 de read-only Market Scanner, Phase 10 de Trade History, Phase 11 realtime updates via Supabase, Phase 13 Analytics, Phase 14 Final Polish en Phase 15 AI Recommendations.

## Huidige status

- Accountacties worden afgehandeld door Supabase Authentication; sessies blijven bestaan via de Supabase JS client.
- Dashboard, portfolio, scanner, trade history, instellingen en de Admin-pagina zijn beschermd door server-side Vercel rewrites en een aanvullende browserguard.
- Het Phase 03-schema bestaat uit 16 `AI_Crypto_Bot_`-tabellen met migrations, foreign keys, indexes, seed data en RLS. Gebruikers hebben alleen geautoriseerde leesrechten; schrijfoperaties zijn server-side.
- Het dashboard toont geauthenticeerde Supabase-status-, portfolio-, positie-, trade-, watched-market- en AI-beslissingsgegevens via een read-only Vercel API. De volledige dashboarddata wordt na authenticatie en daarna iedere 30 seconden ververst; bij terugkeer naar de voorgrond volgt direct een refresh. Verzoeken blijven `no-store`.
- Database- en API-timestamps blijven UTC; Dashboard, AI Decision/Agent Log, Paper Trading, Portfolio, Scanner en Trade History formatteren zichtbare tijden naar `Europe/Brussels`, inclusief automatische zomer-/wintertijd.
- Alle gebruikersgerichte interfacecopy is Engelstalig, inclusief accountflows, navigatie, lege toestanden, statusmeldingen en foutmeldingen. Getallen en bedragen gebruiken `en-GB`-notatie; zichtbare tijden blijven `Europe/Brussels`.
- Het dashboard toont alleen de watched-marketlijst met prioriteiten. Scanner-ranglijsten, prijzen en scannerdata staan uitsluitend op de afzonderlijke Market Scanner-pagina.
- Elke portfolio-KPI heeft een toegankelijke uitleg die met muis, aanraking of toetsenbord te openen is.
- De afzonderlijke beschermde Admin-pagina toont Admin Actions en de Admin-menulink uitsluitend aan geverifieerde Supabase-gebruikers die in de server-side `ADMIN_USER_IDS`-allowlist staan. Beheerders kunnen AI-analyse en paper trading direct uitvoeren; bestaande engine-, papiermodus- en risicocontroles blijven van kracht.
- Phase 06 synchroniseert geldige EUR-markten uit de centrale configuratie en haalt publieke Bitvavo-tickers en candles op. `/api/market-refresh` vernieuwt alleen marktsnapshots; `/api/candle-refresh` verwerkt candles afzonderlijk, incrementeel, per interval en in batches van maximaal vijf markten. Beide processen schrijven uitsluitend naar bestaande tabellen en rapporteren runtimeduur en verwerkte records.
- Phase 07 analyseert echte markt snapshots en candledata met EMA, RSI, MACD, momentum, volume en volatiliteit. De AI Engine leest elk candle-interval afzonderlijk zodat een globale PostgREST-responslimiet geen intervallen uitsluit. Beslissingen en confidence worden server-side in de bestaande AI decision-tabel opgeslagen; ontbrekende of verouderde input levert veilige `WAIT`- of lagere-confidence `HOLD`-beslissingen op.
- Phase 08 voert uitsluitend de nieuwste, opgeslagen AI-beslissingen uit tegen verse, opgeslagen marktprijzen. Een server-only Supabase RPC serialiseert runs en voert risicocontroles, paper buys/sells, kosten, positiewaardering, portfolio-snapshots en trade-idempotency transactioneel uit. Een nieuw profiel krijgt een gesimuleerd startportfolio van €10.000; er worden geen trades verzonnen of echte orders geplaatst.
- Phase 09 rangschikt actieve watched markets als Top Gainers, Top Losers, Highest Volume, Strongest Momentum en AI Opportunities over 24 uur, 7 dagen en 30 dagen. De scanner leest verse snapshots, opgeslagen candles en bestaande AI-beslissingen via de bestaande authenticated `/api/market-summary`-route; er is geen extra Vercel Function of databasewijziging. Een `416/PGRST103` op een gegenereerde vervolgrange beëindigt de paginatie als lege eindpagina. Storage-fouten loggen alleen interne querymetadata (query, tabel, operatie, pagina/range, HTTP-status, foutcode en categorie); de publieke productie-response blijft ongewijzigd.
- Dashboard en portfolio lezen echte, door RLS afgeschermde databasegegevens. De portfolio toont beschikbaar saldo, totale/gerealiseerde/ongerealiseerde/dagelijkse P&L, win rate, posities en recente trades; waarden blijven onbeschikbaar als een begrensde query geen volledige berekening ondersteunt.
- Phase 10 vervangt de history-placeholder door een geauthenticeerd, filterbaar en server-side gepagineerd overzicht van opgeslagen paper-trades. Zoeken, actie/periodefilters en sortering werken op de server; statistieken worden met een SECURITY INVOKER-RPC over alle zichtbare opgeslagen SELL-uitvoeringen berekend. Trade History en Portfolio tonen BUY-kosten en SELL-opbrengsten uit bestaande uitvoeringsvelden; dit wijzigt geen database- of paper-tradingberekeningen.
- Phase 11 gebruikt een gedeelde client-side Supabase Realtime-manager voor dashboard, portfolio, trade history en scanner. Tabelupdates triggeren bestaande geauthenticeerde API-refreshes; polling blijft de fallback, en er zijn geen Vercel Functions of endpoints toegevoegd.
- De beschermde Exports-pagina downloadt Trades, Portfolio Snapshots, AI Decisions en Positions als gefilterde CSV-bestanden. Exacte recordaantallen en gestreamde pagina's gebruiken de bestaande geauthenticeerde `/api/dashboard-data`-function; de API-functiontelling blijft 12 en er zijn geen databasewijzigingen.
- Alle pagina's gebruiken hetzelfde 180×180 Apple Touch Icon met de Bitcoin-munt in blauwe handen tegen een donkergroene achtergrond en de app-naam AI Crypto Bot voor Toevoegen aan beginscherm op iPhone; de miniatuur staat ook in de navigatie en linkt naar Dashboard. De gedeelde interface gebruikt de oorspronkelijke donkergroene achtergrond met zachte groene accenten achter de tegels; tegels en functionele statuskleuren blijven ongewijzigd. Grafieken en browserchrome gebruiken de bestaande gedempte groene themakleur. Dit schakelt geen offline-functionaliteit in.
- Phase 13 biedt een aparte, beschermde Analytics-pagina voor trade-, AI-, strategie- en portfolioprestaties. Historische trades, beslissingen en snapshots zijn filterbaar op 30, 90 of 365 dagen (standaard 30); huidige posities en accounttotalen blijven actueel. De bestaande dashboard-datafunctie leest in begrensde batches van maximaal vier 500-rijpagina's tegelijk; HTTP 416 op de AI-beslissingenpagina beëindigt de stream in plaats van Analytics en Analytics Exports te laten falen. Vier CSV-rapporten gebruiken dezelfde periode; er zijn geen endpoints, tabellen of handelslogica toegevoegd.
- Phase 15 biedt een beschermde AI Recommendations-pagina met advies op basis van bestaande Analytics-uitkomsten voor 30, 90 en 365 dagen. Aanbevelingen tonen onderbouwing, gemeten impact, steekproefomvang en confidence; ze wijzigen geen strategieën, markten, portefeuilles, risico-instellingen of trades. Realtime plus polling ververst de analyse. Recommendation- en history-CSV's worden on-demand opnieuw berekend; er wordt geen aanbevelingsgeschiedenis opgeslagen. De bestaande dashboard-datafunctie en exportinfrastructuur blijven behouden, zonder nieuwe API-function of databaseobject.
- Dashboard-summary toont de eerste zes portfolio-KPI's standaard en klapt de overige metrics in; Trade History start met ingeklapte zoekfilters en een eigen scrollbare tabel.
- De Agent Status-visualisatie gebruikt de framevrije groene circuitafbeelding, met dezelfde chipvorm, printbanen en layout, in een vierkant paneel dat de beschikbare mobiele breedte vult en op desktop maximaal 440 px breed is. De basisafbeelding is gedimd zodat statusneuronen beter zichtbaar zijn; een SVG-overlay laat neuronen vanaf de chipranden langs 32 routes over de zichtbare printbanen bewegen. Tijdens `ANALYZING` zijn 24 unieke routes actief en krijgt de chiprand een subtiele extra groene gloed. Een luminantiemasker houdt signalen op de traces; routegebonden clips voorkomen dat neuronen bij kruisingen naar een andere baan springen, en ze faden aan het einde van hun route uit. Activiteit volgt uitsluitend de actuele `AI_Crypto_Bot_Status.status` via de geauthenticeerde status-API. `STOPPED` en `UNKNOWN` blijven statisch; `prefers-reduced-motion` schakelt bewegende signalen en glow-overgangen uit. De bestaande statusbron en agentlogica blijven ongewijzigd. Emergency State/Risk Control staat onderaan het dashboard.
- Interne mobiele navigatie blijft in hetzelfde venster en brengt de doelpagina na laden terug naar boven; browser-terugnavigatie behoudt de bestaande positie. Open de geïnstalleerde beginscherm-app om iOS-browserbalken te vermijden; Safari en in-app browsers bepalen hun eigen browserknoppen.
- Phase 14 final-polish-audit: all 12 pages passed Chromium viewport checks at 320px, 768px, and 1280px after removing a fixed body width that caused narrow-screen overflow. Analytics tables now have accessible captions and scoped column headers. Local test/build validation passes; physical-device, Lighthouse, browser-matrix, and hosted-production checks remain pending. See [the final release report](./docs/reports/FINAL_RELEASE_REPORT.md).
- De scanner gebruikt bestaande opgeslagen marktdata en AI-beslissingen, maar voert geen AI-analyse of trades uit. Settings blijft een placeholder; strategieoptimalisatie, backtesting en live trading zijn niet geïmplementeerd. De AI Engine blijft analysis-only; paper-trades worden uitsluitend door de afzonderlijke Phase 08 risk-managed executor aangemaakt.
- Trading-gerelateerde pagina's tonen **PAPER ACTIVE**. Er worden geen echte orders uitgevoerd.
- `ENABLE_LIVE_TRADING=false` blijft de verplichte standaard. De paper-tradingcode gebruikt geen private Bitvavo-endpoints, exchange-accountgegevens of echte orders.
- Phase 11 code en lokale validatie zijn afgerond; verificatie van de hosted Supabase-publicatiemigratie en live reconnects blijft open. De Phase 12-systeemvalidatie noteerde een productie-readinessscore van 50% (WARNING). De Phase 13 productie-fix is lokaal geïmplementeerd; de oorspronkelijke falende query en hosted runtime blijven onbevestigd totdat de wijziging is uitgerold en de nieuwe veilige logs zijn gecontroleerd. De huidige Phase 14-polishwijzigingen zijn lokaal geïmplementeerd; de volledige release-checklist en fysieke mobiele validatie zijn nog open.

## Pagina's en projectstructuur

```text
api/        Supabase-config, sessiecookie, beschermde routes, dashboard-, analytics-, export-, admin-, marktdata-, AI-analyse- en paper-trading-APIs
config/     Centrale standaardmarktconfiguratie voor database-seeding
css/        Gedeelde stijlen
docs/       Projectdocumentatie en faserapporten
js/ Browsercode, Supabase Auth- en Realtime-services, dashboard-, analytics-, scanner-, exports- en trade-history-rendering en statusgestuurde circuitvisualisatie
lib/        Server-side analytics-, sessie-, export-, admin-autorisatie-, marktdata-, scanner-, AI Engine- en paper-trading-services
prompts/    Faseprompts
scripts/    Statische projectvalidatie
supabase/   Supabase-configuratie en versioned SQL migrations
tests/      Node.js unit- en routetests
```

Publieke accountpagina's: `login.html`, `register.html` en `reset-password.html`. Beschermde pagina's: `dashboard.html`, `analytics.html`, `portfolio.html`, `scanner.html`, `history.html`, `exports.html` en `settings.html`. De Supabase anon key wordt vanuit serveromgeving beschikbaar gemaakt voor de browser; gebruik nooit een service-role key.

## Configuratie en checks

- Node.js 18 of hoger voor tests en validatie.
- De database-integratietests voeren de Supabase migrations uit in PGlite; er zijn geen Supabase-credentials nodig.
- Voor lokaal Supabase draaien zijn de Supabase CLI en Docker vereist. De SQL is niet automatisch toegepast op een externe database.
- Configureer `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` en `ADMIN_USER_IDS` in een lokaal genegeerd `.env`-bestand en als Vercel Environment Variables. `ADMIN_USER_IDS` bevat een komma-gescheiden lijst van Supabase Auth-gebruikers-UUID's. De service-role sleutel, cron secret en allowlist blijven server-side; geef `CRON_SECRET` alleen aan een externe scheduler mee als `Authorization: Bearer <CRON_SECRET>`.
- Voeg in Supabase Auth de productie-URL voor e-mailbevestiging en wachtwoordherstel toe aan de toegestane redirect-URL's.
- Supabase JS en Chart.js worden via vastgepinde CDN-modules geladen. De Agent Status-circuitvisualisatie gebruikt native SVG/CSS en voegt geen externe renderbibliotheek toe. PGlite is alleen een development dependency voor database tests.

```powershell
npm.cmd test
npm.cmd run build
```

`npm.cmd run build` valideert de pagina's, lokale verwijzingen, auth-, marktdata-, AI- en paper-trading-endpoints, beschermde rewrites, database-table/RLS-contract en behoud van de initiële marktseeds; het vereist geen schedulerconfiguratie in Vercel. `npm.cmd test` bevat ook indicator-, confidence-, besluitlogica-, AI API-, dashboard-, trade-history-, marktdata-, scanner-, database- en authenticatietests, plus PGlite-RLS-, risico- en paper-tradingintegratietests.

Database migrations staan in `supabase/migrations/`. Gebruik lokaal `supabase start` en `supabase db reset`. Link een project en inspecteer bestaande prefixed objecten vóór `supabase db push`; migrations mogen niet zonder review op productie worden toegepast.

## Deployen

Importeer de repository in Vercel met de projectroot als root directory en configureer de Supabase- en server-side secret-variabelen. Op Vercel Hobby kan een externe scheduler, zoals cron-job.org, `GET /api/market-refresh`, de afzonderlijke candle-batches, `POST /api/ai-analysis` en daarna `POST /api/paper-trading` aanroepen met de `CRON_SECRET`-autorisatieheader. Plan paper trading na AI analysis; zie [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) en [docs/SCHEDULING.md](./docs/SCHEDULING.md). De anon key is bedoeld voor clientgebruik en is geen service secret; plaats nooit `SUPABASE_SERVICE_ROLE_KEY` of andere private credentials in clientconfiguratie.

## Documentatie

- [Roadmap](./ROADMAP.md)
- [Database](./docs/DATABASE.md)
- [Architectuur](./docs/ARCHITECTURE.md)
- [Authentication API](./docs/API.md)
- [Teststrategie](./docs/TESTING.MD)
- [Phase 02 completion report](./docs/reports/PHASE_02_COMPLETION_REPORT.md)
- [Phase 03 completion report](./docs/reports/PHASE_03_COMPLETION_REPORT.md)
- [Phase 04 completion report](./docs/reports/PHASE_04_COMPLETION_REPORT.md)
- [Dashboard auto-refresh report](./docs/reports/DASHBOARD_AUTO_REFRESH_REPORT.md)
- [Phase 05 completion report](./docs/reports/PHASE_05_COMPLETION_REPORT.md)
- [Phase 05 Brain Improvement Report](./docs/reports/PHASE_05_BRAIN_IMPROVEMENT_REPORT.md)
- [Phase 05 Final Fix Report](./docs/reports/PHASE_05_FINAL_FIX_REPORT.md)
- [Phase 05 Visual Redesign Report](./docs/reports/PHASE_05_VISUAL_REDESIGN_REPORT.md)
- [Phase 05 Final Visual Redesign Report](./docs/reports/PHASE_05_FINAL_VISUAL_REDESIGN_REPORT.md)
- [Phase 05 Final Visual Refinement Report](./docs/reports/PHASE_05_FINAL_VISUAL_REFINEMENT_REPORT.md)
- [Phase 05 Final Redesign Report](./docs/reports/PHASE_05_FINAL_REDESIGN_REPORT.md)
- [Phase 05 Neural Activity Refinement Report](./docs/reports/PHASE_05_NEURAL_ACTIVITY_REFINEMENT_REPORT.md)
- [Phase 06 completion report](./docs/reports/PHASE_06_COMPLETION_REPORT.md)
- [Phase 06 candle refresh optimization report](./docs/reports/PHASE_06_CANDLE_OPTIMIZATION_REPORT.md)
- [Phase 06 candle batching report](./docs/reports/PHASE_06_CANDLE_BATCHING_REPORT.md)
- [Phase 06 deployment fix report](./docs/reports/PHASE_06_DEPLOYMENT_FIX_REPORT.md)
- [Phase 07 completion report](./docs/reports/PHASE_07_COMPLETION_REPORT.md)
- [Dashboard Admin Actions report](./docs/reports/DASHBOARD_ADMIN_ACTIONS_REPORT.md)
- [UI language standardization report](./docs/reports/UI_LANGUAGE_STANDARDIZATION_REPORT.md)
- [Phase 08 completion report](./docs/reports/PHASE_08_COMPLETION_REPORT.md)
- [Phase 09 completion report](./docs/reports/PHASE_09_COMPLETION_REPORT.md)
- [Phase 10 completion report](./docs/reports/PHASE_10_COMPLETION_REPORT.md)
- [Phase 11 completion report](./docs/reports/PHASE_11_COMPLETION_REPORT.md)
- [Exports module report](./docs/reports/EXPORTS_MODULE_REPORT.md)
- [Phase 13 Analytics report](./docs/reports/PHASE_13_ANALYTICS_REPORT.md)
- [Phase 15 AI Recommendations report](./docs/reports/PHASE_15_AI_RECOMMENDATIONS_REPORT.md)
- [Phase 13 Analytics production fix report](./docs/reports/PHASE_13_ANALYTICS_PRODUCTION_FIX_REPORT.md)
- [Analytics pagination fix report](./docs/reports/ANALYTICS_PAGINATION_FIX_REPORT.md)
- [Phase 07 candle query fix report](./docs/reports/PHASE_07_CANDLE_QUERY_FIX_REPORT.md)
- [Final release report](./docs/reports/FINAL_RELEASE_REPORT.md)