# Migratiearchitectuur

## Uitgangssituatie

De projectinstructie bevestigt dat de PostgreSQL-database op de Raspberry Pi operationeel is, het volledige schema bevat en de benodigde Supabase-data al heeft ontvangen. Deze status is voor dit document gebruikersinformatie; er is geen live Pi-connectie of query uitgevoerd. De migratie herhaalt geen schema- of datawerk.

### Huidige runtime

```text
Browser
  ├─ Supabase JS CDN: Auth + Realtime invalidaties
  └─ Same-origin HTTP ──> Vercel Functions (12 routes)
                           ├─ Supabase Auth REST
                           ├─ Supabase PostgREST reads/writes/RPC
                           ├─ Bitvavo public API
                           └─ Pi health proxy (alleen health)

Vercel scheduler-trigger endpoints <── externe scheduler
  ├─ market refresh
  ├─ candle refresh batches
  ├─ AI analysis
  └─ paper trading na succesvolle AI analysis

Pi archive-server
  └─ Node.js health service + pg pool (max 1; uitsluitend monitoring)
```

De root Node.js-code is geschreven als Vercel Function handlers en gedeelde ESM-modules, niet als zelfstandige HTTP-server. De root `package.json` heeft geen `pg` runtime dependency. Het afzonderlijke `archive-server/` heeft Node.js `>=20.6`, `pg` en een Node HTTP-server, maar verzorgt momenteel alleen healthmonitoring en handmatige archieffuncties. De health pool is op één verbinding en korte health-timeouts ingesteld; dit is geen geschikte trading-/dashboardpool zonder afzonderlijke ontwerpkeuze.

### Beoogde runtime

```text
Browser
  └─ HTTPS/authenticated API ──> Raspberry Pi Node.js service
                                  ├─ dashboard/API handlers
                                  ├─ market-data service + scanner
                                  ├─ deterministic AI engine
                                  ├─ risk-managed paper executor
                                  └─ scheduler / worker lifecycle
                                           │
                                           └─ pg ──> bestaande Pi PostgreSQL
                                                      └─ bestaande tabellen/functies

Bitvavo public market API ────────> Pi market-data service
Vercel ──────────────────────────> statische HTML/CSS/JS/dashboard assets
Windows ─────────────────────────> ontwikkel- en testomgeving uitsluitend
```

Vercel-hosted browsercode mag geen directe PostgreSQL-verbinding, databasewachtwoord of gedeeld backend-token krijgen. De Pi API moet TLS, server-side sessievalidatie/autorisatie, inputvalidatie en bounded responses afdwingen. Als de Pi API op een andere origin staat, moeten origin/CORS en cookie-/sessiegedrag expliciet worden ontworpen. Een cross-origin browserrequest met een gedeeld bearer-secret is geen acceptabele authenticatieoplossing.

## Component- en datatoewijzing

| Component | Huidige plek en afhankelijkheid | Doelplek |
|---|---|---|
| Statische UI (`*.html`, `css/`, `js/`) | Vercel; auth/data vanuit Supabase en same-origin `/api/*`. | Blijft op Vercel. API-base/auth-configuratie wordt gericht omgezet naar de beveiligde Pi API; pagina's, response-shapes en UI-functionaliteit blijven behouden. |
| API-handlers (`api/`) | 12 Vercel Functions; auth, dashboardviews, marktdata, analyse, paper trading en admin actions. | Backendgedrag verhuist naar Pi Node runtime; geen extra Vercel API-route. Houd bestaande endpoint-/responsecontracten als migratiegrens aan. |
| Gedeelde services (`lib/`) | Businesslogica is gescheiden van diverse transportcode, maar gebruikt `fetch` voor Supabase REST/RPC. | Hergebruik pure berekeningen/ranking/formattering; vervang opslagtransport door expliciete `pg`-repositories. Houd Bitvavo-adapter geïsoleerd. |
| PostgreSQL bewerkingen | PostgREST table routes, HTTP-methodes en RPC's met service-role- of user-JWT headers. | Parameterized SQL via bestaande DB-verbinding; behoud transactie-, sorteer-, filter-, paging-, UTC- en countsemantiek. Geen generieke willekeurige table/query-proxy. |
| Supabase Auth / Admin | Supabase JS client plus Vercel tokenvalidatie en `ADMIN_USER_IDS`. | Auth-/sessievoorziening op de Pi API moet de huidige gebruiker/admin- en beschermde-paginafunctionaliteit vervangen. Keuze van identity/sessionmechanisme is een ontwerpbeslissing vóór implementatie. |
| Supabase Realtime | Browserkanalen voor status/portfolio/trades/markets/candles/decisions; events invalidaten alleen; polling is fallback. | Behoud polling/API-refresh als basis. Als dezelfde live-ervaring vereist is, kan de Pi API een eigen server-pushmechanisme aanbieden; geen browserdatabaseverbinding. |
| Scheduled jobs | Externe scheduler roept Vercel endpoints aan; Vercel zelf heeft geen Cron-entry. | Eén langlopend Pi Node.js-proces met interne scheduler. `systemd` start/bewaakt/herstart alleen de service; geen externe scheduler, Vercel-executor of aparte `systemd`-timer. |
| Bitvavo | Publieke HTTP-markt-, ticker- en candle-routes. | Blijft uitsluitend als publieke data-provider in Pi backend. Geen private exchange keys/endpoints nodig voor huidige paper mode. |
| Pi health | Loopback Node HTTP-service rapporteert PostgreSQL reachability/database size en disk. | Blijft gescheiden van botdata-endpoints; geen trading- of marktmutaties via health. |

## Databaseverzoeken en huidige RPC-grens

De lifecycle, exacte cycle-volgorde, singleton-lock, 100-markt-resourcegrenzen en cutovercriteria van de doelruntime zijn normatief beschreven in [runtime-execution-spec.md](./runtime-execution-spec.md).

De directe PostgREST read/write-vervanging moet per geval expliciete SQL krijgen:

- **Marktdata:** watched-market-, ticker-, candle- en scanner-event reads/writes in `lib/market-data.mjs`. De huidige service kan nieuwe markten uit `config/markets.js` toevoegen. Die auto-seed/synchronisatie moet niet naar de Pi-runtime worden overgenomen; lees en behoud alleen de bestaande Pi-market rows.
- **AI:** status/market/snapshot reads, bounded candle history, statusupdates en beslissingsinserties in `lib/ai-engine.mjs`.
- **Paper trading:** `AI_Crypto_Bot_Run_Paper_Trading()` via PostgREST RPC in `lib/paper-trading.mjs`.
- **Shadow exits:** `AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios()` via RPC; best-effort, hypothetisch, nooit uitvoerbaar.
- **Dashboard:** meerdere PostgREST table reads/counts en `AI_Crypto_Bot_Trade_History_Stats()` in `api/dashboard-data.mjs`; daarnaast analytics, exports en recommendations.
- **Status/market routes:** `api/agent-status.mjs` en `lib/market-handler.mjs` lezen geauthenticeerde databasegegevens.

Actieve transportgebonden RPC-callers in de huidige applicatie:

1. `AI_Crypto_Bot_Get_Latest_Candle_Checkpoints(text[], text)`
2. `AI_Crypto_Bot_Get_Latest_AI_Candles_Compact(text[], text)`
3. Optioneel `AI_Crypto_Bot_Run_Database_AI_Analysis(timestamptz)`
4. `AI_Crypto_Bot_Run_Paper_Trading()`
5. `AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios()`
6. `AI_Crypto_Bot_Trade_History_Stats()`

`AI_Crypto_Bot_Get_Latest_AI_Candles(text[], text)` is een legacy/compatibiliteitsfunctie; de huidige JavaScript-engine gebruikt de compact RPC. Databasefuncties voor provisioning, portfolio refresh, besluituitvoering, triggers en interne database-AI helpers zijn onderliggende functies, geen HTTP-RPC routes die blind opnieuw moeten worden geïmplementeerd.

De gebruiker meldt dat het volledige schema al op de Pi staat. Voordat code direct `SELECT public."AI_Crypto_Bot_..."(...)` uitvoert, moet read-only worden gecontroleerd dat de betreffende functie bestaat met de juiste signature, dat dependencies aanwezig zijn en dat de gekozen runtime-role de bedoelde EXECUTE-rechten heeft. Supabase service-role/`auth.uid()`/JWT-claims gedragen zich niet vanzelf hetzelfde in een directe `pg`-sessie. Houd gebruikersautorisatie in de Pi API en gebruik least-privilege DB-rollen.

## Dashboard- en beveiligingscontract

Het doelcontract voor browser-naar-Pi verkeer, doel-endpoints, sessies, polling, CORS/CSRF, rate limits en fouten staat in [api-architecture.md](./api-architecture.md). Dat document beschrijft de doelarchitectuur; de huidige Vercel/Supabase-contracten hieronder blijven gelden totdat de afzonderlijke migratiefasen zijn uitgevoerd.

De huidige browser gebruikt:

- Supabase JS Auth SDK vanaf jsDelivr voor registratie, login, reset, logout en persistente sessie;
- een `cp_access_token` HttpOnly-cookie die Vercel Auth handlers valideren via Supabase Auth;
- Supabase Realtime als invalidatiekanaal voor dashboard, portfolio, history, scanner en recommendations;
- `/api/dashboard-data`, `/api/agent-status` en `/api/market-summary` voor de eigenlijke gegevens.

Supabase volledig uit de applicatie verwijderen betekent dus ook dat de API auth-config/session endpoints, cookie-validatie, beschermd-paginagedrag, admin user-ID check, Realtime-client, public Supabase config, PostgREST headers, RPC URLs, Supabase environment variables, migration-history tooling en Supabase-only response diagnostics moeten zijn afgedekt. Laat bestaande dashboard polling/lege states/filters/exports intact. Een eventuele verandering van event-latency moet expliciet worden getest en gedocumenteerd.

## Raspberry Pi 3 randvoorwaarden

- De bestaande Pi-service verwacht Node `>=20.6`; controleer exacte OS/ARM ABI en Node-build voordat een release wordt uitgerold.
- De Pi 3 heeft doorgaans circa 1 GB RAM en een beperkte CPU. De huidige AI-candle worker pool kan tot 24 RPC-calls tegelijk doen; de candle-refresh code kent concurrency tot vier en batches van maximaal vijf. Begin op de Pi met veel lagere begrenzingen en meet CPU, RSS, DB latency en volledige schedulercycli.
- Node indicatorberekeningen zijn deterministisch en vragen geen lokaal taalmodel. De huidige applicatie heeft geen externe AI-provider nodig.
- PostgreSQL candle- en portfolio-activiteit schrijft veelvuldig; meet disk/WAL gebruik en opslaggezondheid. Een SSD verdient de voorkeur boven langdurige databasewrites op microSD. Maak geen backup of datawijziging als onderdeel van deze architectuurfase; herstelbaarheid blijft wel een cutover-gate.
- Houd health queries apart van de operationele DB pool. De huidige `max: 1` health pool mag de botverbindingslimieten niet bepalen.

## Architectuurbesluiten vóór implementation

1. Exacte bestaande Pi database-identiteit/host/DB-role bevestigen met read-only metadata; repositorynaam `ai_crypto_bot_archive` is geen live bewijs van de operationele DB-naam.
2. Bepalen hoe de Vercel-origin veilig met de Pi API communiceert en hoe login/sessies/admin worden vervangen zonder browsersecrets.
3. Vaststellen of bestaande PostgreSQL-functies rechtstreeks aanroepbaar zijn of dat pure JS-enginelogica de bestaande tabellen met parameterized SQL gebruikt.
4. Afspreken hoe scheduler ownership wordt overgezet. Oude en nieuwe executors mogen niet gelijktijdig dezelfde paperportfolio/verantwoordelijkheid verwerken.
5. Acceptatiecriteria vastleggen voor logic parity, dashboard response parity, full scheduler cycle en Pi-resourcegebruik.

De concrete fasevolgorde staat in [roadmap.md](./roadmap.md); de feitelijke huidige code-/RPC-inventaris in [01-audit.md](./01-audit.md).

## Phase 2 runtime foundation

The isolated implementation is in [`raspberry-pi/`](../../raspberry-pi/). It currently provides strict runtime configuration, a `pg` pool capped at four connections, explicit read-only transactions, fail-closed database/schema/function/grant checks, validation of the existing enabled `AI_Crypto_Bot_Watched_Markets` rows, and loopback-only health endpoints. It does not implement any dashboard data API, authentication/OIDC, scheduler, market-data ingestion, AI logic, or trading.

The local tests use a PostgreSQL protocol mock. The Pi database identity, schema, function signatures, grants, network connectivity, and market rows have not been independently queried; production acceptance remains blocked until an operator-provisioned connection is validated read-only. The target database, schema, and market list are not modified by the foundation.

Authentication implementation is out of scope and OIDC is explicitly excluded. The earlier identity flow in [api-architecture.md](./api-architecture.md) is not approved for implementation. Until a future access-control scope is explicitly authorized, keep the Phase 2 API loopback-only and do not expose it to Vercel or the Internet.
