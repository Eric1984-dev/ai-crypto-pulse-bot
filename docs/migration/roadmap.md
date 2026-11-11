# Migratieroadmap

> **Historisch voorstel:** De onderstaande fasering en statustabel zijn vóór de Pi-cutover geschreven en geven niet de actuele implementatiestatus weer. De gebruiker rapporteert dat fasen 2–9 operationeel zijn; Phase 10 cleanup-validatie is beschreven in de [actuele rapportage](../post-migration-cleanup-report.md). Gebruik [docs/SCHEDULING.md](../SCHEDULING.md) en [docs/DEPLOYMENT.md](../DEPLOYMENT.md) voor de huidige bedieningsgrenzen.

Dit is een voorstel voor de uitvoeringsvolgorde, geen toestemming om volgende fasen alvast uit te voeren. Elke fase begint pas na een expliciete gebruikersprompt en eindigt na tests, documentatie, Git-review en commit. Daarna stopt het werk tot toestemming voor de volgende fase.

## Status

| Fase | Doel | Status |
|---|---|---|
| 1 — Audit en migratieplan | Afhankelijkheden, bestaande werking, doelarchitectuur en gates vastleggen. | Documentatie afgerond. |
| 1.7 — Runtime Execution Specification | Pi lifecycle, interne uitvoering, herstel, resources en acceptatie definiëren. | Documentatie afgerond; niet geïmplementeerd. |
| 1.8 — Target API Architecture | Definitief browser-naar-Pi API-, auth-, polling- en foutcontract definiëren. | Documentatie afgerond; providerkeuze en profielmapping blijven implementatiegates. |
| 2 — Pi runtime foundation | Read-only PostgreSQL-pool, startupcontracten, bestaande watched-market-validatie en lokale health-API. | Geïmplementeerd en lokaal getest; live Pi-DB-verbinding/schema/marktvalidatie niet uitgevoerd wegens ontbrekende lokale connection-configuratie. Faseacceptatie geblokkeerd tot read-only Pi-validatie volgens de [deployment- en validatiehandleiding](../../raspberry-pi/docs/phase-2-deployment-validation.md). |

## Voorgestelde fasering en afhankelijkheden

| Fase | Werkpakket | Afhankelijk van | Acceptatie / stopcriteria |
|---|---|---|---|
| 1. Audit en plan | Inventarisatie van Vercel/Supabase-paden, Pi-aannames, scannerbron, scheduler en migratierisico's. | Geen | Documenten onder `docs/migration/` bijgewerkt; geen schema-/datamutaties; tests en beperkingen eerlijk gerapporteerd. |
| 2. Pi Node/PG runtime foundation | Bestaande Node-architectuur onderzoeken; read-only `pg`-pool; bestaande DB identity, schema contracts, function signatures, grants en markets valideren. Geen DDL. | Fase 1, veilige lokale Pi connection configuration | Lokale contracttests slagen; echte read-only Pi-smoketest blijft vereist en blokkeert acceptatie zolang de Pi niet bereikbaar is. Geen writes of schema-installatie. |
| 3. Pi API en dashboardcontract | Implementeer alleen een expliciet goedgekeurde API-scope en behoud de bestaande dashboardcontracten. Authenticatie-implementatie valt buiten scope; OIDC is uitgesloten. | Fase 2 geaccepteerd; afzonderlijke scopebeslissing voor netwerkblootstelling en toegangsbeveiliging | Geen PostgreSQL-toegang in browser; API blijft niet publiek bereikbaar totdat een toegestane beveiligingsaanpak afzonderlijk is goedgekeurd. |
| 4. Read-only data API en markt-universe | Port bestaande dashboard/market/scanner reads; scanner haalt `enabled`/`priority`/`symbol` uitsluitend uit bestaande Pi `AI_Crypto_Bot_Watched_Markets`. Geen market seed. | Fase 2, API/auth contract fase 3 | Bekende symbol set blijft ongewijzigd; API response/UI parity; tests bewijzen geen Watched Markets writes. |
| 5. Bitvavo marktdata-ingestie | Verplaats publieke ticker/candle fetch, validatie, cache, checkpoint/overlap/upsert en scanner-event logging naar Pi worker. | Fase 2 + market reader fase 4 | Alleen reeds bestaande enabled Pi-markten worden verwerkt; geen auto-market insertion; volledige gewenste interval/batch dekking en stale/failure gedrag getest. |
| 6. AI Engine | Verplaats huidige deterministische berekening, status, decision persistence en bounded candle reads. Behoud huidige V2 score/confidence/freshness exact. | Fase 2, verse Pi data fase 5 | Golden-fixture/decision-parity tests; stale/partial input blijft fail-safe; geen verandering aan signal/strategy rules. |
| 7. Paper trading en shadow scenarios | Vervang Supabase RPC transport door gecontroleerde directe functieaanroep of gelijkwaardige parameterized DB-transactie; behoud locks, idempotency, fees, slippage en risk behavior. | Fase 2 + AI phase 6 + auth/DB role model | Paper-only tests voor BUY/SELL/HOLD/WAIT, limits, retries, drawdown, emergency stop en duplicate runs; geen private Bitvavo/API order calls. |
| 8. Dashboard volledige cutover | Laat alle dashboard-, portfolio-, scanner-, history-, analytics-, recommendations-, exports- en adminpagina's naar Pi API gaan; verwijder browser Supabase Auth/Realtime usage. | Fase 3 en stabiele Pi data API's fase 4–7 | Response/UI/permission parity; polling of goedgekeurd push-alternatief; alle beschermde pagina's/admin flows getest. |
| 9. Scheduler- en runtime cutover | Start één langlopend Pi Node-proces met interne scheduler; `systemd` alleen voor boot/restart/procesbewaking. Geen externe scheduler, Vercel-execution of aparte `systemd`-timer. Verwerk snapshots/candles/AI/paper in de vastgelegde volgorde. | Fasen 5–8 | Voldoet aan [runtime execution specification](./runtime-execution-spec.md), 100-markt-soak en crash/recovery/idempotency-tests; nooit twee actieve trading-executors. |
| 10. Supabase application-removal | Verwijder ongebruikte Supabase client/config/env/callers/docs/test helpers uit applicatie nadat alle parity-gates slagen. Geen remote database deletion. | Fasen 2–9 volledig geaccepteerd | Zoek-/buildcontrole bevestigt geen resterende app runtime afhankelijkheden; Supabase database blijft onaangeroerd tenzij later apart opgedragen. |

Fasen 3–8 kunnen later per fase worden opgesplitst of samengevoegd na code-inspectie, maar verander de uitvoeringsvolgorde niet stilzwijgend. Elke volgende fase vereist afzonderlijke goedkeuring.

## Paper-trading-continuïteit en single-writer cutover

Paper mode blijft de enige actieve handelsmodus. Tijdens analyse/parity draaien nieuwe Pi-processen hoogstens read-only/shadow zolang de bestaande executor nog actief is. De Vercel- en Pi-paper-executors mogen niet tegelijk besluiten verwerken: zij kunnen verschillende databases/portfolios lezen en hun idempotency keys delen geen lock wanneer de stores gescheiden zijn.

Vóór scheduler-cutover moet de eigenaar van scheduled AI/paper uitvoering expliciet worden bepaald. Gebruik een gecontroleerde handoff met één actieve writer en bevestigde latest decision/portfolio state. Definieer vooraf een veilige failback naar de vorige scheduler zonder dubbele paper orders. Live orders blijven buiten scope en `ENABLE_LIVE_TRADING=false`.

## Algemene fasegates

- Geen nieuwe database, schema, Supabase-to-Pi kopie of mutatie van de bestaande market-universe.
- Alle databasewrites uitsluitend in een expliciet goedgekeurde uitvoeringsfase en via de bestaande schema-objecten; deze fase 1 bevat geen writes.
- Elke wijziging heeft bestaande tests plus gerichte regressietests. Voer geen test uit die productie/remote schema of data aanraakt.
- Documenteer API, environment-configuratie, installatie, databaseoperaties, resource-/schedulerinstellingen en changelog waar de fase die raakt. Auth/OIDC implementeren is niet impliciet toegestaan.
- Rapporteer pass/fail/skipped; nooit tests, production validatie of deployment verzinnen.
- Vercel-deployments voert de gebruiker zelf uit. Geen zelfstandige volgende fase, package/service install op de Pi of scheduler activeren.

## Niet binnen deze roadmap

Geen nieuwe strategie, indicator, confidence-drempel, entry/exitregel, SL/TP, risk-parameter, exchange of live-tradingmogelijkheid. Geen UI-redesign. Geen schema-installatie/data-import. Geen Vercel deployment. Wijzigingen daaraan vereisen een afzonderlijke scopebeslissing.
