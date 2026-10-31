# CryptoPulse AI Agent

CryptoPulse is een crypto-analyse- en paper-tradingplatform in ontwikkeling. Phase 02 levert Supabase Authentication; **Phase 03 voegt de gemigreerde PostgreSQL-database, seed data en Row Level Security toe** aan de statische HTML/CSS/JavaScript-basis.

## Huidige status

- Accountacties worden afgehandeld door Supabase Authentication; sessies blijven bestaan via de Supabase JS client.
- Dashboard, portfolio, scanner, trade history en instellingen zijn beschermd door server-side Vercel rewrites en een aanvullende browserguard.
- Het Phase 03-schema bestaat uit 16 `AI_Crypto_Bot_`-tabellen met migrations, foreign keys, indexes, seed data en RLS. Gebruikers hebben alleen geautoriseerde leesrechten; schrijfoperaties zijn server-side.
- De pagina's blijven placeholders en er is nog geen runtime database/API-integratie, marktdata-ingestie, Bitvavo, AI, paper trading, scannerlogica of realtime-functionaliteit.
- Trading-gerelateerde pagina's tonen **PAPER ACTIVE**. Er worden geen echte orders uitgevoerd.
- `ENABLE_LIVE_TRADING=false` blijft de verplichte standaard.
- Phase 03 (Database) is voltooid; Phase 04 is niet gestart.

## Pagina's en projectstructuur

```text
api/        Supabase-config, sessiecookie en beschermde Vercel route
config/     Centrale standaardmarktconfiguratie voor database-seeding
css/        Gedeelde stijlen
docs/       Projectdocumentatie en faserapporten
js/         Browsercode en Supabase Auth-service
lib/        Server-side sessievalidatie
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
- Configureer `SUPABASE_URL` en `SUPABASE_ANON_KEY` in een lokaal genegeerd `.env`-bestand en als Vercel Environment Variables.
- Voeg in Supabase Auth de productie-URL voor e-mailbevestiging en wachtwoordherstel toe aan de toegestane redirect-URL's.
- De Supabase JS SDK is via een vastgepinde CDN-module geladen; PGlite is alleen een development dependency voor database tests.

```powershell
npm.cmd test
npm.cmd run build
```

`npm.cmd run build` valideert de pagina's, lokale verwijzingen, auth-endpoints, beschermde rewrites, Vercel-configuratie, database-table/RLS-contract en gelijkheid tussen de seed migration en `config/markets.js`; het maakt geen build-output aan.

Database migrations staan in `supabase/migrations/`. Gebruik lokaal `supabase start` en `supabase db reset`. Link een project en inspecteer bestaande prefixed objecten vóór `supabase db push`; migrations mogen niet zonder review op productie worden toegepast.

## Deployen

Importeer de repository in Vercel met de projectroot als root directory en configureer de twee Supabase-variabelen. Zie [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). De anon key is bedoeld voor clientgebruik en is geen service secret; plaats nooit `SUPABASE_SERVICE_ROLE_KEY` of andere private credentials in clientconfiguratie.

## Documentatie

- [Roadmap](./ROADMAP.md)
- [Database](./docs/DATABASE.md)
- [Architectuur](./docs/ARCHITECTURE.md)
- [Authentication API](./docs/API.md)
- [Teststrategie](./docs/TESTING.MD)
- [Phase 02 completion report](./docs/PHASE_02_COMPLETION_REPORT.md)
- [Phase 03 completion report](./docs/PHASE_03_COMPLETION_REPORT.md)