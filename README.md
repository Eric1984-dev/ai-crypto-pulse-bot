# CryptoPulse AI Agent

CryptoPulse is een crypto-analyse- en paper-tradingplatform in ontwikkeling. **Phase 02 (Authentication)** voegt Supabase Registration, Login, Logout en Password Reset toe aan de statische HTML/CSS/JavaScript-basis uit Phase 01.

## Huidige status

- Accountacties worden afgehandeld door Supabase Authentication; sessies blijven bestaan via de Supabase JS client.
- Dashboard, portfolio, scanner, trade history en instellingen zijn beschermd door server-side Vercel rewrites en een aanvullende browserguard.
- De huidige pagina's blijven placeholders. Database-schema's, marktdata, Bitvavo, AI, paper trading, scannerlogica en realtime-functionaliteit zijn niet geïmplementeerd.
- Trading-gerelateerde pagina's tonen **PAPER ACTIVE**. Er worden geen echte orders uitgevoerd.
- `ENABLE_LIVE_TRADING=false` blijft de verplichte standaard.
- Phase 03 (Database) is niet gestart.

## Pagina's en projectstructuur

```text
api/        Supabase-config, sessiecookie en beschermde Vercel route
css/        Gedeelde stijlen
docs/       Projectdocumentatie en faserapporten
js/         Browsercode en Supabase Auth-service
lib/        Server-side sessievalidatie
prompts/    Faseprompts
scripts/    Statische projectvalidatie
tests/      Node.js unit- en routetests
```

Publieke accountpagina's: `login.html`, `register.html` en `reset-password.html`. Beschermde pagina's: `dashboard.html`, `portfolio.html`, `scanner.html`, `history.html` en `settings.html`. De Supabase anon key wordt vanuit serveromgeving beschikbaar gemaakt voor de browser; gebruik nooit een service-role key.

## Configuratie en checks

- Node.js 18 of hoger voor tests en validatie.
- Configureer `SUPABASE_URL` en `SUPABASE_ANON_KEY` in een lokaal genegeerd `.env`-bestand en als Vercel Environment Variables.
- Voeg in Supabase Auth de productie-URL voor e-mailbevestiging en wachtwoordherstel toe aan de toegestane redirect-URL's.
- Geen npm-installatie nodig; de Supabase JS SDK is via een vastgepinde CDN-module geladen.

```powershell
npm.cmd test
npm.cmd run build
```

`npm.cmd run build` valideert de pagina's, lokale verwijzingen, auth-endpoints, beschermde rewrites en Vercel-configuratie; het maakt geen build-output aan.

## Deployen

Importeer de repository in Vercel met de projectroot als root directory en configureer de twee Supabase-variabelen. Zie [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). De anon key is bedoeld voor clientgebruik en is geen service secret; plaats nooit `SUPABASE_SERVICE_ROLE_KEY` of andere private credentials in clientconfiguratie.

## Documentatie

- [Roadmap](./ROADMAP.md)
- [Architectuur](./docs/ARCHITECTURE.md)
- [Authentication API](./docs/API.md)
- [Teststrategie](./docs/TESTING.MD)
- [Phase 02 completion report](./docs/PHASE_02_COMPLETION_REPORT.md)