# CryptoPulse AI Agent

CryptoPulse is een crypto-analyse- en paper-tradingplatform in ontwikkeling. Phase 02 levert Supabase Authentication, Phase 03 het PostgreSQL-schema met Row Level Security, Phase 04 een database-gestuurd dashboard, Phase 05 de Three.js Agent Brain visualisatie, Phase 06 publieke Bitvavo-marktdata en Phase 07 de deterministische AI Engine.

## Huidige status

- Accountacties worden afgehandeld door Supabase Authentication; sessies blijven bestaan via de Supabase JS client.
- Dashboard, portfolio, scanner, trade history en instellingen zijn beschermd door server-side Vercel rewrites en een aanvullende browserguard.
- Het Phase 03-schema bestaat uit 16 `AI_Crypto_Bot_`-tabellen met migrations, foreign keys, indexes, seed data en RLS. Gebruikers hebben alleen geautoriseerde leesrechten; schrijfoperaties zijn server-side.
- Het dashboard toont geauthenticeerde Supabase-status-, portfolio-, positie-, trade-, markt- en beslissingsgegevens via een read-only Vercel API.
- Phase 06 synchroniseert geldige EUR-markten uit de centrale configuratie en haalt publieke Bitvavo-tickers en candles op. `/api/market-refresh` vernieuwt alleen marktsnapshots; `/api/candle-refresh` verwerkt candles afzonderlijk, incrementeel, per interval en in batches van maximaal vijf markten. Beide processen schrijven uitsluitend naar bestaande tabellen en rapporteren runtimeduur en verwerkte records.
- Phase 07 analyseert echte markt snapshots en candledata met EMA, RSI, MACD, momentum, volume en volatiliteit. De AI Engine leest elk candle-interval afzonderlijk zodat een globale PostgREST-responslimiet geen intervallen uitsluit. Beslissingen en confidence worden server-side in de bestaande AI decision-tabel opgeslagen; ontbrekende of verouderde input levert veilige `WAIT`- of lagere-confidence `HOLD`-beslissingen op.
- De Three.js Agent Brain gebruikt de actuele `AI_Crypto_Bot_Status.status`-waarde en ververst deze via een geauthenticeerde status-API. Een front-facing, bilaterale contour met iets hogere hersenhelften (circa 16%), een duidelijke middenspleet en gebogen, vertakkende corticale paden vormt het brein uit neuronen, verbindingen, hotspots en bewegende energie. Alle 720 neuronen pulseren onafhankelijk; maximaal 48 signalen bewegen langs opeenvolgende verbindingen. Inactieve verbindingen blijven gedimd en lichten alleen op wanneer een signaal passeert. De visualisatie heeft geen volume, shell, fog, mesh of externe circuitsporen. Beide hersenhelften delen dezelfde statuskleur.
- Portfolio-, scanner-, history- en settings-pagina's blijven placeholders. De marktdata-ingestie is geen signalenscanner; paper-trade-uitvoering, scannerlogica en realtime-functionaliteit zijn niet geïmplementeerd. De AI Engine genereert uitsluitend analysebeslissingen en voert geen trades uit.
- Trading-gerelateerde pagina's tonen **PAPER ACTIVE**. Er worden geen echte orders uitgevoerd.
- `ENABLE_LIVE_TRADING=false` blijft de verplichte standaard; Phase 06 gebruikt geen private Bitvavo-endpoints, accountgegevens of orders.
- Phase 07 (deterministische AI Engine) is voltooid; Phase 08 is niet gestart.

## Pagina's en projectstructuur

```text
api/        Supabase-config, sessiecookie, beschermde routes, dashboard-, marktdata- en AI-analyse-APIs
config/     Centrale standaardmarktconfiguratie voor database-seeding
css/        Gedeelde stijlen
docs/       Projectdocumentatie en faserapporten
js/         Browsercode, Supabase Auth-service, dashboard rendering en Three.js Agent Brain
lib/        Server-side sessie-, marktdata- en AI Engine-services
prompts/    Faseprompts
scripts/    Statische projectvalidatie
supabase/   Supabase-configuratie en versioned SQL migrations
tests/      Node.js unit- en routetests
```

Publieke accountpagina's: `login.html`, `register.html` en `reset-password.html`. Beschermde pagina's: `dashboard.html`, `portfolio.html`, `scanner.html`, `history.html` en `settings.html`. De Supabase anon key wordt vanuit serveromgeving beschikbaar gemaakt voor de browser; gebruik nooit een service-role key.

## Configuratie en checks

- Node.js 18 of hoger voor tests en validatie.
- De database-integratietests voeren de Supabase migrations uit in PGlite; er zijn geen Supabase-credentials nodig.
- Voor lokaal Supabase draaien zijn de Supabase CLI en Docker vereist. De SQL is niet automatisch toegepast op een externe database.
- Configureer `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` en `CRON_SECRET` in een lokaal genegeerd `.env`-bestand en als Vercel Environment Variables. De service-role sleutel en cron secret zijn uitsluitend server-side; geef `CRON_SECRET` aan een externe scheduler mee als `Authorization: Bearer <CRON_SECRET>`.
- Voeg in Supabase Auth de productie-URL voor e-mailbevestiging en wachtwoordherstel toe aan de toegestane redirect-URL's.
- Supabase JS, Chart.js en Three.js worden via vastgepinde CDN-modules geladen; Three.js wordt alleen voor de Agent Brain geladen. PGlite is alleen een development dependency voor database tests.

```powershell
npm.cmd test
npm.cmd run build
```

`npm.cmd run build` valideert de pagina's, lokale verwijzingen, auth-, marktdata- en AI-endpoints, beschermde rewrites, database-table/RLS-contract en behoud van de initiële marktseeds; het vereist geen schedulerconfiguratie in Vercel. `npm.cmd test` bevat ook indicator-, confidence-, besluitlogica-, AI API-, dashboard-, marktdata-, database- en authenticatietests.

Database migrations staan in `supabase/migrations/`. Gebruik lokaal `supabase start` en `supabase db reset`. Link een project en inspecteer bestaande prefixed objecten vóór `supabase db push`; migrations mogen niet zonder review op productie worden toegepast.

## Deployen

Importeer de repository in Vercel met de projectroot als root directory en configureer de Supabase- en server-side secret-variabelen. Op Vercel Hobby kan een externe scheduler, zoals cron-job.org, `GET /api/market-refresh`, `GET /api/candle-refresh?interval=1m&batch=0` en `POST /api/ai-analysis` aanroepen met de `CRON_SECRET`-autorisatieheader. Plan alle candle-intervallen en batches afzonderlijk; zie [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) en [docs/SCHEDULING.md](./docs/SCHEDULING.md). De anon key is bedoeld voor clientgebruik en is geen service secret; plaats nooit `SUPABASE_SERVICE_ROLE_KEY` of andere private credentials in clientconfiguratie.

## Documentatie

- [Roadmap](./ROADMAP.md)
- [Database](./docs/DATABASE.md)
- [Architectuur](./docs/ARCHITECTURE.md)
- [Authentication API](./docs/API.md)
- [Teststrategie](./docs/TESTING.MD)
- [Phase 02 completion report](./docs/PHASE_02_COMPLETION_REPORT.md)
- [Phase 03 completion report](./docs/PHASE_03_COMPLETION_REPORT.md)
- [Phase 04 completion report](./docs/PHASE_04_COMPLETION_REPORT.md)
- [Phase 05 completion report](./docs/PHASE_05_COMPLETION_REPORT.md)
- [Phase 05 Brain Improvement Report](./docs/PHASE_05_BRAIN_IMPROVEMENT_REPORT.md)
- [Phase 05 Final Fix Report](./docs/PHASE_05_FINAL_FIX_REPORT.md)
- [Phase 05 Visual Redesign Report](./docs/PHASE_05_VISUAL_REDESIGN_REPORT.md)
- [Phase 05 Final Visual Redesign Report](./docs/PHASE_05_FINAL_VISUAL_REDESIGN_REPORT.md)
- [Phase 05 Final Visual Refinement Report](./docs/PHASE_05_FINAL_VISUAL_REFINEMENT_REPORT.md)
- [Phase 05 Final Redesign Report](./docs/PHASE_05_FINAL_REDESIGN_REPORT.md)
- [Phase 05 Neural Activity Refinement Report](./docs/PHASE_05_NEURAL_ACTIVITY_REFINEMENT_REPORT.md)
- [Phase 06 completion report](./docs/PHASE_06_COMPLETION_REPORT.md)
- [Phase 06 candle refresh optimization report](./docs/PHASE_06_CANDLE_OPTIMIZATION_REPORT.md)
- [Phase 06 candle batching report](./docs/PHASE_06_CANDLE_BATCHING_REPORT.md)
- [Phase 06 deployment fix report](./docs/PHASE_06_DEPLOYMENT_FIX_REPORT.md)
- [Phase 07 completion report](./docs/PHASE_07_COMPLETION_REPORT.md)
- [Phase 07 candle query fix report](./docs/PHASE_07_CANDLE_QUERY_FIX_REPORT.md)