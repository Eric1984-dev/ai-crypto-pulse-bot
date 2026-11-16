# Analyse waarschuwingen en alternatieve exits

**Onderzoeksdatum:** 2026-11-16  
**Bron:** read-only queries op de productie-PostgreSQL-database  
**Tijdzone:** UTC  
**Datacutoff:** laatste opgeslagen AI-beslissing op 2026-11-16 21:25:15.597 UTC

## Samenvatting

In de database staan vijf positielevenscycli: **drie gesloten posities** en **twee nog open posities**. De drie gesloten posities sloten alle met verlies via `MAX_POSITION_LOSS_EXIT`; geen enkele sloot met winst. Twee van de vijf posities kregen tijdens hun leven geen van de onderzochte waarschuwingen. De waarschuwing-cohort bestaat dus uit **drie** posities:

- CAP-EUR, entry 2026-11-15 05:40 UTC: eerste waarschuwing was alignment=false/hourly bearish; sloot uiteindelijk **28u39m** later met MAX_POSITION_LOSS_EXIT.
- MEGA-EUR, entry 2026-11-16 00:02 UTC: confidence<70 na 58m45s; nog open op datacutoff.
- BEAM-EUR, entry 2026-11-16 14:55 UTC: confidence<70, alignment=false en hourly bearish tegelijk na 5m51s; nog open op datacutoff.

Van deze drie gewaarschuwde posities is er dus **één gerealiseerd gesloten**: een verlies via de 5%-stop. De andere twee zijn rechts-gecensureerd (nog open); hun uiteindelijke winst/verlies en exitduur zijn onbekend.

## Posities en eerste waarschuwingen

Een waarschuwing is de eerste opgeslagen AI-beslissing na entry waarbij minstens één voorwaarde waar was: confidence <70, alignment=false, of hourly trend bearish. Cycles zijn opeenvolgende AI-beslissingsrijen voor dezelfde markt; de mediane afstand in deze database was circa 298 seconden. Een waarschuwing is niet automatisch een SELL-beslissing.

| Markt en entry (UTC) | Uitkomst op datacutoff | Eerste waarschuwing | Exit / observatie vanaf waarschuwing | P&L vanaf waarschuwing tot exit/huidige mark | Maximale drawdown na waarschuwing |
|---|---|---|---:|---:|---:|
| CAP-EUR, 2026-11-15 00:02:28.817 | Gesloten: MAX_POSITION_LOSS_EXIT, -€10.1303 | Geen van de drie waarschuwingen vóór exit | — | — | — |
| CAP-EUR, 2026-11-15 05:40:27.788 | Gesloten: MAX_POSITION_LOSS_EXIT, -€10.1526 | 2026-11-15 06:01:01.190; alignment=false en hourly bearish | 28u39m24.7s tot exit | -€2.9782 ná het eerste waarschuwingsmoment; hypothetical exit-P&L op waarschuwing was -€7.1744, uiteindelijke realized P&L -€10.1526 | -1.631% / -€3.1484 |
| MEGA-EUR, 2026-11-16 00:02:10.053 | Open; actuele modelmatige liquidatiewaarde circa -€2.2153 | 2026-11-16 01:00:54.470; alleen confidence<70 (69.74) | 20u24m21.1s waargenomen; nog open | +€2.8365 herstel vanaf hypothetical exit-P&L -€5.0519 bij waarschuwing tot circa -€2.2153 bij cutoff | -0.631% / -€1.2262 |
| BEAM-EUR, 2026-11-16 10:01:34.755 | Gesloten: MAX_POSITION_LOSS_EXIT, -€10.0154 | Geen van de drie waarschuwingen vóór exit | — | — | — |
| BEAM-EUR, 2026-11-16 14:55:27.388 | Open; actuele modelmatige liquidatiewaarde circa -€4.8210 | 2026-11-16 15:01:18.383; confidence 45, alignment=false en hourly bearish | 6u23m57.2s waargenomen; nog open | -€3.2210 verslechtering vanaf hypothetical exit-P&L -€1.6000 bij waarschuwing tot circa -€4.8210 bij cutoff | -3.288% / -€6.4700 |

De gemiddelde verandering in gemodelleerde close-P&L vanaf de eerste waarschuwing tot exit/huidige mark is **-€1.1209 per gewaarschuwde positie** over deze drie posities. Dit gemiddelde mengt één gerealiseerde exit met twee open, gemarkeerde posities; het is daarom voorlopig en geen gerealiseerd gemiddeld resultaat. Alleen bij de gesloten CAP-EUR-positie was de gerealiseerde verslechtering ná waarschuwing **-€2.9782**.

De grootste gemeten drawdown na een waarschuwing was **-€6.47 (-3.288%)** bij de nog open BEAM-EUR-positie. Dit is mark-to-market excursion vanaf de waarschuwingsprijs, berekend uit de beschikbare, volledig afgesloten 5m-candles; geen portfolio-drawdown.

## Scenario-definities en prijsmethode

- Scenario A: eerste beslissingsrij met confidence <70.
- Scenario B: derde opeenvolgende beslissingsrij met confidence <70.
- Scenario C: eerste beslissingsrij met `directionalAlignment=false`.
- Scenario D: eerste rij waarop alignment=false én confidence<70 tegelijk gelden.
- Scenario E: eerste rij waarop hourly trend bearish én confidence<70 tegelijk gelden.
- Als er geen scenario-trigger was vóór een echte exit, is de echte exit gebruikt. Als de positie nog open was, blijft die open tenzij het scenario vóór cutoff triggert.
- Hypothetische exits gebruiken de marktprijs die in de triggerbeslissing is opgeslagen, daarna de bestaande 0.10% adverse slippage en 0.25% exit fee. De entry-kostbasis bevat de entry fee en slippage. Er is geen spread gemodelleerd.
- Scenario's veranderen niet de latere entrygroottes of andere posities. Dit is een trade-by-trade replay met vaste historische entries, geen volledige portfolio-simulatie of compounding-replay.
- Winrate en gemiddelde win/loss zijn berekend over gesloten/hypothetisch gesloten posities; open posities zijn niet als winst/verlies geteld. `Max drawdown` in de scenario-tabellen is de slechtste individuele positie-excursie vanaf entry tot exit/cutoff, gemeten met volledig afgesloten 5m-candles; het is nadrukkelijk geen standaard portefeuille-equity drawdown.

## Scenario-triggers in de productiehistorie

| Positie | A: conf<70 | B: drie cycles | C: alignment false | D: alignment false + conf<70 | E: hourly bearish + conf<70 |
|---|---|---|---|---|---|
| CAP 1 (gesloten) | Geen | Geen | Geen | Geen | Geen |
| CAP 2 (gesloten) | 2026-11-15 07:00:59.612 | 07:10:14.594 | 06:01:01.190 | 07:00:59.612 | 07:00:59.612 |
| MEGA (open) | 2026-11-16 01:00:54.470 | 01:10:11.510 | Geen | Geen | Geen |
| BEAM 1 (gesloten) | Geen | Geen | Geen | Geen | Geen |
| BEAM 2 (open) | 2026-11-16 15:01:18.383 | 15:10:14.544 | 15:01:18.383 | 15:01:18.383 | 15:01:18.383 |

De eerste CAP 2 waarschuwing (alignment/hourly) was ruim vóór de confidence-waarschuwing. In die eerste rij was confidence nog 74.19 en de AI-beslissing bleef `BUY`. MEGA's eerste confidence-waarschuwing had alignment=true en hourly trend bullish. De BEAM 2 waarschuwing viel samen met een `HOLD`-beslissing, confidence 45 en beide trendvoorwaarden. Deze triggers zouden dus een nieuwe expliciete exitregel vereisen; de opgeslagen `BUY`/`HOLD`-beslissingen sloten de posities niet.

## Vergelijking op dezelfde drie reeds gesloten posities

Dit is de zuiverste vergelijking: alle regels worden op dezelfde drie voltooide trades toegepast; de twee momenteel open posities tellen hier niet mee.

| Regel | Gesloten trades | Winrate | Netto P&L (actueel + gesimuleerd) | Max individuele MAE vanaf entry | Gemiddeld verlies | Gemiddelde winst | Echte stop-exits / signaal-exits |
|---|---:|---:|---:|---:|---:|---:|---:|
| Huidige 5%-stop | 3 | 0% | -€30.2983 | -5.305% / -€10.6375 | -€10.0994 | — (geen winnaars) | 3 / 0 |
| A: confidence<70 | 3 | 0% | -€23.3446 | -5.305% / -€10.6375 | -€7.7815 | — | 2 / 1 |
| B: 3 opeenvolgende confidence<70 | 3 | 0% | -€23.8804 | -5.305% / -€10.6375 | -€7.9601 | — | 2 / 1 |
| C: alignment=false | 3 | 0% | -€27.3201 | -5.305% / -€10.6375 | -€9.1067 | — | 2 / 1 |
| D: alignment=false én confidence<70 | 3 | 0% | -€23.3446 | -5.305% / -€10.6375 | -€7.7815 | — | 2 / 1 |
| E: hourly bearish én confidence<70 | 3 | 0% | -€23.3446 | -5.305% / -€10.6375 | -€7.7815 | — | 2 / 1 |

Alle vijf regels triggerden alleen vóór de stop bij CAP 2 in deze afgesloten cohort. A, D en E triggerden daar op hetzelfde moment; C eerder, op alignment-loss; B later dan A. Geen van de regels veranderde de uitkomst van CAP 1 of BEAM 1, omdat bij die posities geen van de waarschuwingen optrad vóór de stop. Geen scenario maakte een historische trade winstgevend. Op basis van deze drie trades verminderde A/D/E het nettoverlies met circa €6.95, B met €6.42 en C met €2.98, maar de winrate bleef 0%.

## Huidige twee open posities: hypothetische triggers

Deze cijfers zijn niet gerealiseerde transacties. De hypothetische P&L is berekend op de marktprijs van het eerste triggersignaal.

| Positie | Regel(s) die vóór cutoff triggerden | Hypothetische exit-P&L | Indien niet getriggerd |
|---|---|---:|---|
| MEGA-EUR | A: 01:00:54.470; B: 01:10:11.510 | A -€5.0519; B -€3.7864 | C/D/E: blijft open; circa -€2.2153 gemodelleerde liquidatiewaarde op cutoff |
| BEAM-EUR (entry 14:55) | A/C/D/E: 15:01:18.383; B: 15:10:14.544 | A/C/D/E -€1.6000; B -€4.2437 | Alle vijf regels triggerden; positie staat nog open in productie |

Wanneer ook deze huidige posities als hypothetische scenario-exits worden meegeteld, ontstaat het volgende gecombineerde beeld. De baseline toont echte gerealiseerde P&L apart van de open posities; scenarioresultaten zijn statische, counterfactual exits met historische entrygroottes.

| Regel | Gesloten of hypothetisch gesloten | Nog open | Winrate | P&L gesloten/gesimuleerde exits | Open posities: net-liquidatiewaarde | Gecombineerd op cutoff | Gemiddeld verlies / gemiddelde winst |
|---|---:|---:|---:|---:|---:|---:|---:|
| Huidige 5%-stop (baseline) | 3 echt | 2 | 0% van gesloten | -€30.2983 gerealiseerd | -€7.0364 | -€37.3347 | -€10.0994 / — |
| A | 5 (3 historisch + 2 hypothetisch) | 0 | 0% | -€29.9965 | €0 | -€29.9965 | -€5.9993 / — |
| B | 5 (3 historisch + 2 hypothetisch) | 0 | 0% | -€31.9105 | €0 | -€31.9105 | -€6.3821 / — |
| C | 4 (3 historisch + 1 hypothetisch) | 1 | 0% | -€28.9201 | -€2.2153 (MEGA) | -€31.1354 | -€7.2300 / — |
| D | 4 (3 historisch + 1 hypothetisch) | 1 | 0% | -€24.9446 | -€2.2153 (MEGA) | -€27.1599 | -€6.2362 / — |
| E | 4 (3 historisch + 1 hypothetisch) | 1 | 0% | -€24.9446 | -€2.2153 (MEGA) | -€27.1599 | -€6.2362 / — |

De gecombineerde cutoff-totalen zijn geen zuivere gerealiseerde-P&L-vergelijking: A en B sluiten twee posities die in productie nog open zijn; C/D/E laten MEGA open en waarderen die positie alleen op de cutoff-mark. Daarom zijn de drie afgesloten trades de primaire vergelijkingsbasis. Er waren geen winnaars, zodat gemiddelde winst niet van toepassing is.

## Beperkingen en interpretatie

- De database bevat maar drie voltooide trades; alle drie zijn verlieslatend en alle drie eindigden via `MAX_POSITION_LOSS_EXIT`. De winratevergelijking is daardoor niet informatief over wat de filters met winnaars zouden doen.
- De huidige MEGA- en BEAM-posities zijn gecensureerd. Hun scenario-exits zijn hypothetisch en hun uiteindelijke productie-exits kunnen niet worden gerapporteerd.
- De berekening fixeert historische entrymomenten en -groottes. Een echte vroegere exit kan portfolio-balance, latere sizing, cooldowns of toekomstige entries veranderen; deze effecten zijn niet opnieuw afgespeeld.
- 5m-candles zijn onvolledig en de waarschuwing-mark komt uit de opgeslagen AI market snapshot. Drawdowns zijn daarom gemeten over beschikbare, volledig afgesloten candle-intervallen; intrabar-orde en spread ontbreken.
- Er zijn geen productiegegevens gewijzigd. Dit rapport is analyse, geen wijziging van de automatische paper-trading exitregels.
