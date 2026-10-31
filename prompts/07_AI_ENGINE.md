# PHASE 07 - AI ENGINE

## Doel

Bouw de AI-analysemotor.

De AI Engine analyseert:

- marktdata
- candles
- trends
- momentum
- volume
- volatiliteit

en genereert intelligente beslissingen.

---

## Belangrijk

Gebruik uitsluitend bestaande database-tabellen.

Maak GEEN nieuwe AI-tabellen aan.

Gebruik:

- AI_Crypto_Bot_Market_Data
- AI_Crypto_Bot_Candles
- AI_Crypto_Bot_AI_Decisions
- AI_Crypto_Bot_Status

Respecteer bestaande migraties, relaties en RLS-configuratie.

---

## Geen Trading

Deze fase mag:

- analyseren
- beslissingen genereren
- beslissingen opslaan
- dashboard voeden

Deze fase mag NIET:

- trades openen
- trades sluiten
- portfolio wijzigen
- orders uitvoeren
- balances wijzigen

Dat gebeurt pas in Phase 08.

---

## Input

Gebruik uitsluitend:

### AI_Crypto_Bot_Market_Data

Voor:

- actuele prijs
- volume
- 24h verandering
- high/low analyse

---

### AI_Crypto_Bot_Candles

Gebruik:

- 1m
- 5m
- 15m
- 1h
- 4h
- 1d

Voor:

- trendanalyse
- momentumanalyse
- volatiliteitsanalyse

---

## Output

Gebruik bestaande tabel:

### AI_Crypto_Bot_AI_Decisions

Voor iedere analyse moet een beslissing worden opgeslagen.

---

## Beslissingen

Ondersteunde waarden:

```text
BUY
SELL
HOLD
WAIT
```

---

## Confidence Score

Voor iedere beslissing:

```text
0 - 100
```

Voorbeelden:

```text
BUY
confidence: 82

SELL
confidence: 77

WAIT
confidence: 31
```

---

## Analysefactoren

### Trend Analyse

Detecteer:

- bullish
- bearish
- sideways

Gebruik candle-data.

---

### Momentum Analyse

Detecteer:

- accelerating momentum
- weakening momentum

Gebruik:

- candle sluitingen
- prijsverandering

---

### Volume Analyse

Detecteer:

- volume stijging
- volume daling
- volume anomalieën

---

### Volatiliteit Analyse

Detecteer:

- lage volatiliteit
- gemiddelde volatiliteit
- hoge volatiliteit

---

### Marktsterkte

Combineer:

- trend
- momentum
- volume
- volatiliteit

tot één score.

---

## AI Engine Service

Maak een AI Engine service volgens de projectarchitectuur.

Bijvoorbeeld:

```text
services/ai-engine.js
```

of een vergelijkbare structuur volgens AGENTS.md.

---

## Analyseflow

```text
AI_Crypto_Bot_Watched_Markets
            ↓
AI_Crypto_Bot_Market_Data
            ↓
AI_Crypto_Bot_Candles
            ↓
AI Engine
            ↓
AI_Crypto_Bot_AI_Decisions
```

---

## Opslag

Sla op:

- symbol
- decision
- confidence
- reason
- strategy_name
- strategy_version
- created_at

Gebruik de bestaande AI_Crypto_Bot_AI_Decisions tabel.

---

## Dashboard

Gebruik bestaande dashboard-implementatie.

Werk sectie:

```text
Recent AI Decisions
```

bij.

Toon:

- markt
- beslissing
- confidence
- tijdstip

Gebruik uitsluitend echte database-data.

Geen mock data.

---

## Agent Brain Integratie

Gebruik bestaande tabel:

```text
AI_Crypto_Bot_Status
```

Statusverloop:

Tijdens analyse:

```text
ANALYZING
```

Na succesvolle analyse:

```text
ACTIVE
```

Geen lopende processen:

```text
IDLE
```

Bij fouten:

```text
ERROR
```

---

## Foutafhandeling

Ondersteun:

- ontbrekende candles
- ontbrekende marktdata
- corrupte records
- lege datasets
- databaseproblemen

Nooit de applicatie laten crashen.

Gebruik veilige fallback states.

---

## Logging

Log:

- gestart analyseproces
- geanalyseerde markt
- gegenereerde beslissing
- confidence score
- fouten

Gebruik bestaande projectstandaarden.

---

## Tests

Voeg tests toe voor:

- trendanalyse
- momentumanalyse
- volumeanalyse
- volatiliteitsanalyse
- confidenceberekening
- decision generation
- database opslag
- dashboard integratie
- foutafhandeling

---

## Validatie

Verplicht:

```bash
npm test
npm run build
```

Alle tests moeten slagen.

---

## Documentatie

Update:

- README.md
- DATABASE.md
- ARCHITECTURE.md
- TESTING.md
- CHANGELOG.md

---

## Oplevering

Genereer:

```text
PHASE_07_COMPLETION_REPORT.md
```

Rapporteer:

- AI architectuur
- analyseflow
- decision logica
- confidence model
- databronnen
- testresultaten
- validatieresultaten
- gekende beperkingen

---

## Beperkingen

Implementeer uitsluitend Phase 07.

Start GEEN Phase 08.

Geen trading.

Geen orders.

Geen portfolio mutaties.

Geen paper trading.

Alleen analyse en AI-beslissingen.