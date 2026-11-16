# Forensic RCA: `MAX_POSITION_LOSS_EXIT` trades

**Onderzoeksdatum:** 2026-11-16  
**Bron:** rechtstreekse, read-only queries op de productie-PostgreSQL-database  
**Tijdzone:** alle timestamps hieronder zijn UTC  
**Scope:** alle trades met `execution_reason = 'MAX_POSITION_LOSS_EXIT'`

## Conclusie in het kort

De database bevat **3** gesloten verliestrades met deze exitreden, samen **-€30,2983 gerealiseerde P&L**. De stop voerde de exit uit, maar verklaart de verliezen niet:

- De twee CAP-EUR entries werden geopend terwijl de 5m- en 15m-trend al bearish waren en het 1h-volume zwak of afnemend was. De entryvalidatie controleerde wel dagelijkse/uurtrend-alignment, maar niet deze kortere trends.
- De BEAM-EUR entry had bullish daily/1h-labels en dus `directionalAlignment=true`, maar de 4h-trend was bearish, daily momentum verzwakte en het daily volume was zeer laag.
- De opgeslagen V2 market-strength/confidence bleven hoog door de langzamere trendinput. De stopdata tonen hoge volatiliteit; alle drie entrybeslissingen hadden de maximale, gereconstrueerde 5-punts volatiliteitsaftrek.
- Bij de tweede CAP-EUR positie werden hourly trend/alignment verlies en daarna confidence <70 ruim vóór de stop opgeslagen. De beslissingen bleven desondanks `BUY`; er was geen opgeslagen SELL-signaal.

De sterkste enkele, data-onderbouwde kandidaat om in een volledige replay te testen is: **vereis dat de 15m-trend de entryrichting bevestigt voordat een BUY wordt uitgevoerd**. Dit had op de geregistreerde entrydata beide CAP-EUR verliesentries afgewezen: **€20,2829 (66,9% van deze verliezen)**. Het had BEAM-EUR niet afgewezen. Dit is een hypothese uit drie trades, geen bewezen rendementsverbetering; valideer ook tegen alle winnaars en niet-uitgevoerde BUY-signalen voordat dit wordt ingevoerd.

## Methode en databeperkingen

De trade-, entrybeslissing-, positie-, portfolio-snapshot-, audit-, marktdata- en candle-tabellen zijn rechtstreeks in PostgreSQL geraadpleegd. De selectie leverde drie MAX_POSITION_LOSS-exits op. De gerealiseerde P&L komt uit de SELL-trades en bevat de geregistreerde uitvoeringskosten.

De MFE/MAE en entry-window-bewegingen zijn berekend met de opgeslagen 5m-candles en entry-kostbasis (inclusief entry fee/slippage). Candle-high/low-excursies zijn brutoprijsbewegingen, vóór hypothetische exitkosten. Candledekking is onvolledig voor de CAP-posities: respectievelijk 42/65 (65%) en 247/348 (71%) verwachte 5m-intervallen; BEAM heeft 54/56 (97%). De uiterste intrabar-prijs en het exacte moment binnen een 5m-candle zijn daarom niet reconstrueerbaar. 1m-dekking is nog dunner.

`AI_Crypto_Bot_Market_Data` bevatte alleen de actuele marktregel per markt, geen historische snapshots rond de exits. De portfolio-snapshots en opgeslagen AI-beslissingen zijn wel historisch. De execution-audit registreert geëvalueerde BUY/SELL-beslissingen, niet elke stopbeoordeling. De historische positierijen bewaren high-water/stopvelden, maar geen volledige stop-update-eventlog. Daarom zijn de eerste candle-breach en AI-signaalmomenten exacte opgeslagen tijdstempels, maar geen tick-exacte triggerdata.

De volatiliteitsaftrek stond niet als veld in de opgeslagen AI-beslissing. De 5 punten hieronder zijn gereconstrueerd uit de opgeslagen ATR-levels met de V2-regel in de lokale Raspberry Pi-broncode: gemiddelde aftrek 12 punten per high-, 4 per medium- en 0 per low-volatilityinterval, begrensd op 5. De entrybeslissingen identificeren strategieversie 2.0.0; deze reconstructie is geen afzonderlijke verificatie van de destijds gedeployde binary.

## Trades en entrykwaliteit

| Markt | Entry UTC | Exit UTC | Holding time | Entry → exit uitvoeringsprijs | Gerealiseerde P&L | Entry confidence / strength |
|---|---|---|---:|---:|---:|---:|
| CAP-EUR | 2026-11-15 00:02:28.817 | 2026-11-15 05:25:23.163 | 5u 22m 54s | 0.0996405410 → 0.0950804244 | -€10.1303 | 76.42 / 88.09 |
| CAP-EUR | 2026-11-15 05:40:27.788 | 2026-11-16 10:40:25.937 | 29u 00m 00s | 0.0987797811 → 0.0942223833 | -€10.1526 | 75.09 / 88.09 |
| BEAM-EUR | 2026-11-16 10:01:34.755 | 2026-11-16 14:40:26.495 | 4u 38m 52s | 0.0038356318 → 0.0036609354 | -€10.0154 | 75.60 / 83.44 |

Uitvoeringsprijzen zijn de in `AI_Crypto_Bot_Trades` geregistreerde prijzen, inclusief de toegepaste 0,10% adverse slippage. Entry-kostbasis gebruikt daarnaast de 0,25% entry fee.

| Entry | Daily trend / RSI | Hourly trend / RSI | Alignment (daily–hourly) | 4h / 15m / 5m | Hourly volume | Volatility penalty |
|---|---|---|---|---|---|---:|
| CAP 1 | bullish / 80.91 | bullish / 52.15 | true | 4h bullish; 15m bearish; 5m bearish | ratio 0.04, decreasing; geen volume-confirmatieterm | 5/5 |
| CAP 2 | bullish / 80.91 | bullish / 38.94 | true | 4h bullish; 15m bearish; 5m bearish | ratio 0.29, decreasing; geen volume-confirmatieterm | 5/5 |
| BEAM | bullish / 28.44 | bullish / 56.06 | true | 4h bearish; 15m bullish; 5m bullish | ratio 0.56, normal; slechts 0.06 van de mogelijke 1.0-volume-confirmatiewaarde | 5/5 |

**Wat deze data zeggen over de entries**

Koersverandering is berekend van de dichtstbijzijnde beschikbare 5m-close op of vóór het begin van het window tot de marktprijs in de gekoppelde entrybeslissing. “Onder high” vergelijkt die marktprijs met de hoogste candle-high binnen het window.

| Entry | 1u vóór entry | 4u vóór entry | 12u vóór entry | Entry t.o.v. window-high |
|---|---:|---:|---:|---|
| CAP 1 | -0.03% | -0.04% | +1.80% | 1.15% onder 4u-high; 15.66% onder 12u-high |
| CAP 2 | +2.21% | -1.95% | -1.54% | 2.26% onder 1u/4u-high; 2.54% onder 12u-high |
| BEAM | -1.46% | +5.25% | +2.75% | 1.85% onder 1u-high; 3.60% onder 4u/12u-high |

- **Kocht de bot na een sterke stijging?** Niet bij CAP 1 op basis van de korte windows. CAP 2 kocht een circa 2.2% hersteluur in na negatieve 4u- en 12u-verandering. BEAM kocht na +5.25% over 4u, terwijl de daily momentum-indicator al -6.15% en weakening aangaf.
- **Dicht bij een lokale top?** Geen van de drie entries lag op of vlak bij de vastgelegde 4u/12u-high; de afstand was minimaal 1.15%. CAP 2 lag wel 2.26% onder de 1u-high. Dit bewijst dus geen top-entry, maar wel twee entries tegen bearish kortetermijnstructuur en één entry met bearish 4h-structuur.
- **Trenduitputting?** Het sterkste teken is CAP 1/2: daily RSI 80.91, maar CAP 1/2 hadden zwak hourly volume en bearish 5m/15m. Bij BEAM waren daily volume ratio 0.13 (decreasing), daily momentum -6.15% (weakening) en 4h-trend bearish. Dit zijn conflicterende signalen, geen bewijs van een zekere trendomslag.

## Post-entry pad, excursies en waarschuwingen

MFE/MAE gebruiken de beschikbare 5m-highs/lows, relatief aan de fee/slippage-inclusieve entry-kostbasis. De euro-excursies zijn bruto koersverschil × hoeveelheid, vóór exitkosten.

| Entry | MFE: grootste tussentijdse winst | MAE: grootste tussentijdse drawdown | Piek → dal (bruto) | Eerste 5m-candle-low onder berekende max-loss-mark |
|---|---:|---:|---:|---|
| CAP 1 | +1.131% / +€2.27, piek 00:15 | -5.596% / -€11.22, laagste low 05:25 | -6.652% / -€13.49 | 05:20, low 0.0945900; exit 05:25:23 |
| CAP 2 | +2.162% / +€4.31, piek 2026-11-15 16:05 | -4.857% / -€9.69, laagste low 2026-11-16 10:40 | -6.870% / -€14.00 | 2026-11-16 10:35, low 0.0942373; exit 10:40:25 |
| BEAM | +0.403% / +€0.80, piek 11:10 | -5.295% / -€10.54, laagste low 14:40 | -5.675% / -€11.34 | 14:35, low 0.0036646; exit 14:40:26 |

### Wanneer werd verslechtering zichtbaar?

| Entry | Hourly trend draaide / alignment verloren | Confidence <70 | Market strength daalde ≥10 punten | Vroegste waarschuwingslead tot exit | Opgeslagen SELL vóór stop? |
|---|---|---|---|---|
| CAP 1 | Geen opgeslagen bearish hourly/alignment-wijziging vóór exit | Geen; minimum 74.29 | Geen; strength bleef 88.09–88.59 | Entryconditie (bearish 5m/15m, zwak volume) was al zichtbaar **5u 22m 54s** vóór exit. | Nee |
| CAP 2 | **2026-11-15 06:01:01.190**, 20m 33s na entry; hourly bearish, alignment false. Beslissing bleef BUY, confidence 74.19, strength 87.19. | **2026-11-15 07:00:59.612**, 1u 20m 32s na entry; confidence 65.76, strength 78.09, hourly RSI 34.95 en volume ratio 0.01/decreasing. Beslissing bleef BUY. | Zelfde timestamp als eerste <70: strength 88.09 → 78.09. Dit was 27u 39m vóór exit. | Entryconditie was zichtbaar **29u 00m** vóór exit; alignment-loss **28u 39m 25s** en confidence/strength-waarschuwing **27u 39m 26s** vóór exit. | Nee |
| BEAM | Geen opgeslagen hourly bearish/alignment-loss vóór exit | Geen; minimum 75.00 | Geen; strength daalde maximaal 0.60 punt vanaf entry | Entryconditie (bearish 4h, zwak daily volume/momentum) was al zichtbaar **4u 38m 52s** vóór exit. | Nee |

De eerste stopbreuk in de candledata was bij alle drie in de 5m-bucket direct vóór de exitbucket; de candle-open is niet het exacte tijdstip van de intrabar-low. Voor CAP 1 en CAP 2 was de indicatorwaarschuwing vóór entry al zichtbaar in respectievelijk bearish 5m/15m en afnemend hourly volume. Voor CAP 2 ontstond daarna ook een duidelijke, opgeslagen hourly/alignment-waarschuwing ruim 28 uur vóór exit. Voor BEAM was de 4h/daily-conflict zichtbaar bij entry, niet als latere confidence-daling.

### Tijdelijk herstel na exit

Dit is geen bewijs dat de exits fout waren, maar relevant voor “te strak?”:

- CAP 1: de beschikbare 5m-close één uur na exit was 2.81% boven de opgeslagen exit-mark; de 4u-close was 2.23% erboven. De candle-high in dat eerste uur reikte tot 0.1009606, boven de oorspronkelijke entry-kostbasis.
- CAP 2: de 1u-close na exit lag 2.22% boven exit-mark; 4u-close 0.99% erboven.
- BEAM: de 1u-close na exit lag 2.90% onder exit-mark; de positie daalde dus verder na de stop.

De 5% net-loss-stop lijkt voor de CAP-posities mogelijk krap tegenover deze volatiliteit en de daaropvolgende herstelbewegingen; voor BEAM voorkwam hij verdere daling. Een bredere stop zou CAP mogelijk hebben laten herstellen, maar had ook grotere verliezen kunnen opleveren. Deze drie waarnemingen onderbouwen geen wijziging van de verlieslimiet.

## Portfolio- en auditcontrole

De portfolio-snapshots met dezelfde exit-timestamp bevatten vóór en na de sluiting afzonderlijke rijen, geordend met `snapshot_order`:

| Exit | Voor sluiting | Na sluiting |
|---|---|---|
| CAP 1 | €1,990.5379, 1 open positie | €1,989.8697, 0 open posities |
| CAP 2 | €1,980.7254, 3 open posities | €1,980.0609, 2 open posities |
| BEAM | €1,973.3503, 2 open posities | €1,972.6867, 1 open positie |

Deze portfoliowaarden omvatten andere open posities en zijn geen zelfstandige trade-P&L-attributie. De drie verkopen hebben geen `ai_decision_id`; de execution-audit bevat geen stop-close-event. Er was in de AI-beslissingen vóór deze exits geen SELL-beslissing. De exits kwamen dus uit de positierisicoregel, niet uit een geregistreerde AI-verkoop.

## Oorzaak en beoordeling

### Waarschijnlijke oorzaak

De best ondersteunde gemeenschappelijke oorzaak is **entry-validatie die te veel gewicht gaf aan de trage daily/hourly richting en onvoldoende rekening hield met conflicterende kortere trend- en volumecondities, onder hoge volatiliteit**.

- Dit patroon verklaart de twee CAP-verliezen het sterkst: beide entries waren daily/hourly bullish en `alignment=true`, maar 5m/15m bearish; het hourly volume was respectievelijk 0.04 en 0.29 van gemiddeld. De tweede entry volgde bovendien slechts 15 minuten na de eerste stop en kwam na een kort herstel in een nog negatieve 4u/12u-context.
- BEAM is een verwante maar niet identieke variant: de dagelijkse/uur-labels waren bullish, maar 4h bearish, met verzwakkende daily momentum en zeer laag daily volume. De huidige alignment-waarde toetste alleen daily tegenover hourly en maskeerde het 4h-conflict.
- “Confidence 75–76” en market strength 83–88 voorkwamen deze fouten niet; alle drie posities realiseerden circa -€10. De volatility penalty was al maximaal, maar met 5 punten was de aftrek klein tegenover de sterke daily trendcomponent.

Dit is geen aanwijzing dat één gemeenschappelijke trendomslag elk verlies veroorzaakte: CAP 1 en BEAM hadden vóór exit geen opgeslagen hourly/alignment-omslag of confidence<70. De database ondersteunt entry-/timeframeconflict sterker dan een later, universeel exit-signaal.

**Was de thesis al ongeldig vóór de stop?** Niet volgens de opgeslagen daily–hourly alignment-regel bij de drie entries; die stond telkens op `true`. Onder een bredere timeframe-check was CAP 1 en BEAM al bij entry conflicterend (respectievelijk bearish 15m en bearish 4h). Voor CAP 2 werd de bestaande daily–hourly-alignment-thesis aantoonbaar ongeldig op 06:01:01.190, 28u 39m vóór exit. Dit zijn meetbare regelconflicten, geen bewijs dat een prijsrichting met zekerheid was voorspeld.

### Kon de strategie het eerder zien?

**Ja, maar niet met hetzelfde waarschuwingsmoment voor alle trades.**

1. **CAP 1 en CAP 2: bij entry.** Bearish 5m/15m en dalend hourly volume waren aanwezig in de opgeslagen entry-indicatoren.
2. **CAP 2 aanvullend:** alignment/hourly bearish op 2026-11-15 06:01:01.190 en confidence/strength-waarschuwing op 07:00:59.612 — respectievelijk ongeveer **28u 39m** en **27u 39m** vóór de stop. Het systeem registreerde de signalen, maar maakte er geen SELL-beslissing van.
3. **BEAM: bij entry.** De bearish 4h-trend, zwakke daily volume en negatieve daily momentum waren zichtbaar. Na entry bleef opgeslagen confidence ≥75 en kwam geen SELL-signaal.

De confidencegrens 70 is een BUY-executiegrens, geen bestaande exitregel. Een daling onder 70 sluit een open positie dus niet automatisch; CAP 2 bleef in de database BUY-beslissingen produceren terwijl de positie open was.

### Meest impactvolle enkele wijziging om te replayen

**BUY alleen toestaan als de 15m-trend de daily/hourly entryrichting bevestigt.**

De historische entrydata tonen bearish 15m-trends voor beide CAP-EUR-verliesentries. Een 15m-confirmatie had die twee entries geweigerd, wat achteraf **€20.2829 / 66.9%** van de drie gerealiseerde verliezen had vermeden; de BEAM-entry met bullish 15m zou doorgaan. Dat is de grootste direct toetsbare enkele entryfilter in deze kleine steekproef.

Dit is nadrukkelijk een replayvoorstel, geen productiewijziging. Een correcte evaluatie moet alle BUY-signalen, winnaars, gemiste trades, transactiekosten en de bestaande risk controls meenemen. Het wijzigen of verruimen van de 5% stop is op basis van deze data niet gerechtvaardigd.
