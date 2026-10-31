# PHASE 06 - BITVAVO MARKET DATA

## Doel

Integreer publieke Bitvavo marktdata.

Gebruik uitsluitend publieke endpoints.

Geen trading endpoints.

Geen private API-acties.

Geen orderplaatsing.

Geen API keys vereist.

---

## Belangrijk

Gebruik bestaande database-structuur.

Maak GEEN nieuwe Agent_* tabellen aan.

Gebruik uitsluitend de bestaande tabellen:

- AI_Crypto_Bot_Watched_Markets
- AI_Crypto_Bot_Market_Data
- AI_Crypto_Bot_Candles
- AI_Crypto_Bot_Scanner_Events

Respecteer alle bestaande migraties, relaties en RLS-configuratie.

---

## Markets Config

Werk bestaande file bij:

```text
config/markets.js
```

Breid de lijst uit met onderstaande markten.

De markten in deze file vormen de initiële scanner-universe.

If markets already exist in:

AI_Crypto_Bot_Watched_Markets

synchronization must be non-destructive.

Do not remove existing user-configured markets automatically.
---

## Ondersteunde markten

BTC-EUR  
ETH-EUR  
LTC-EUR  
XRP-EUR  
BCH-EUR  
XLM-EUR  
SOL-EUR  
ADA-EUR  
AVAX-EUR  
DOT-EUR  
ATOM-EUR  
ALGO-EUR  
HBAR-EUR  
NEAR-EUR  
XTZ-EUR  
ICP-EUR  
POL-EUR  
ARB-EUR  
OP-EUR  
IMX-EUR  
STRK-EUR  
LINK-EUR  
GRT-EUR  
FIL-EUR  
ENS-EUR  
RENDER-EUR  
UNI-EUR  
AAVE-EUR  
LDO-EUR  
CRV-EUR  
COMP-EUR  
SNX-EUR  
MORPHO-EUR  
QNT-EUR  
HNT-EUR  
INJ-EUR  
TIA-EUR  
SEI-EUR  
SUI-EUR  
PHA-EUR  
SYN-EUR  
GRASS-EUR  
LSK-EUR  
COTI-EUR  
CNPY-EUR  
STRAX-EUR  
IQ-EUR  
SWEAT-EUR  
MOVR-EUR  
CAP-EUR  
SKY-EUR  
XPL-EUR  
DRIFT-EUR  
LRC-EUR  
ENSO-EUR  
GLMR-EUR  
XYO-EUR  
ACU-EUR  
CHR-EUR  
ZIG-EUR  
SLX-EUR  
BEAM-EUR  
ORCA-EUR  
AZTEC-EUR  
TRAC-EUR  
TOWNS-EUR  
RON-EUR  
SAND-EUR  
ARX-EUR  
XAI-EUR  
MLN-EUR  
OGN-EUR  
JTO-EUR  
SXT-EUR  
PIXEL-EUR  
AUDIO-EUR  
FUN-EUR  
ENJ-EUR  
MIOTA-EUR  
PTB-EUR  
1INCH-EUR  
CTC-EUR  
CRO-EUR  
BNT-EUR  
LMWR-EUR  
BILL-EUR  
MASK-EUR  
ADX-EUR  
XDC-EUR  
GALA-EUR  
IKA-EUR  
AXS-EUR  
MEGA-EUR  
ALICE-EUR  
MON-EUR  
NOM-EUR  
VELO-EUR  
JASMY-EUR  
MAGIC-EUR  
WIN-EUR  
HEI-EUR  
USDC-EUR  
EURC-EUR

---

## Marktvalidatie

Controleer eerst of elke markt daadwerkelijk beschikbaar is op Bitvavo.

Gebruik alleen geldige Bitvavo markten.

Ongeldige markten:

- mogen niet crashen
- mogen geen fouten veroorzaken
- moeten gelogd worden
- mogen niet opgeslagen worden

---

## Gebruik bestaande tabel

### AI_Crypto_Bot_Watched_Markets

Gebruik voor:

- actieve markten
- scanner-universe
- favorites
- toekomstige filtering

Synchroniseer deze tabel met config/markets.js.

---

## Gebruik bestaande tabel

### AI_Crypto_Bot_Market_Data

Bewaar:

- symbol
- price
- volume
- daily_change
- high_24h
- low_24h
- captured_at

Database moet automatisch bijgewerkt worden.

---

## Gebruik bestaande tabel

### AI_Crypto_Bot_Candles

Voorzie ondersteuning voor:

- 1m
- 5m
- 15m
- 1h
- 4h
- 1d

Gebruik bestaande database-structuur.

Geen nieuwe candle-tabellen.

---

## Gebruik bestaande tabel

### AI_Crypto_Bot_Scanner_Events

Registreer:

- scanner detecties
- marktproblemen
- ontbrekende data
- uitzonderingen

Zodat deze later zichtbaar kunnen worden op het dashboard.

---

## Endpoints

Maak:

```text
GET /api/market
```

Doel:

Ophalen van marktinformatie.

---

Maak:

```text
GET /api/market-summary
```

Doel:

Dashboard samenvatting.

---

## Dashboard

Gebruik bestaande dashboard-implementatie.

Nieuwe KPI:

```text
Tracked Markets
```

Toon:

- aantal actieve markten
- aantal markten met data

Gebruik echte database-data.

Geen mock data.

---

## Scanner

Scanner moet:

1. Markten ophalen uit:

```text
AI_Crypto_Bot_Watched_Markets
```

2. Publieke Bitvavo data ophalen.

3. Opslaan in:

```text
AI_Crypto_Bot_Market_Data
```

4. Scanner events registreren in:

```text
AI_Crypto_Bot_Scanner_Events
```

---

## Caching

Gebruik caching.

TTL:

```text
60 seconden
```

Voorkom overmatige Bitvavo requests.

---

## Error Handling

Ondersteun:

- lege respons
- timeout
- rate limit
- ongeldige markt
- Bitvavo offline
- netwerkfouten

Nooit applicatiecrashes veroorzaken.

Gebruik veilige fallback states.

---

## Tests

Voeg tests toe voor:

- lege respons
- timeout
- rate limit
- foutsymbolen
- Bitvavo offline
- database opslag
- scanner events
- cache gedrag
- dashboard integratie

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

- API.md
- DATABASE.md
- README.md
- TESTING.md
- ARCHITECTURE.md
- CHANGELOG.md

---

## Oplevering

Genereer:

```text
PHASE_06_COMPLETION_REPORT.md
```

Rapporteer:

- gewijzigde bestanden
- scanner architectuur
- Bitvavo integratie
- database gebruik
- caching strategie
- testresultaten
- validatieresultaten
- gekende beperkingen

---

## Beperkingen

Implementeer uitsluitend Phase 06.

Start GEEN Phase 07.

Geen trading.

Geen orders.

Gebruik uitsluitend publieke Bitvavo API endpoints.

Verboden:

- order placement
- account access
- portfolio access
- balance access
- private API usage

Toegestaan:

- markets
- market summaries
- ticker data
- candles
- OHLCV
- public market information