# PHASE 06 - BITVAVO MARKET DATA

Doel:

Integreer publieke Bitvavo marktdata.

Gebruik uitsluitend publieke endpoints.

Geen trading endpoints.

Geen private API-acties.

---

Maak:

config/markets.js

Voorbeeld:

export const DEFAULT_MARKETS = [...];

---

Ondersteunde markten

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

Nieuwe tabel

Agent_Watched_Markets

gebruik voor:

- active markets
- favorites
- future filtering

---

Nieuwe tabel

Agent_Market_Data

Bewaar:

symbol
price
volume
daily_change
high_24h
low_24h
captured_at

---

Endpoints

GET /api/market

GET /api/market-summary

---

Dashboard

Nieuwe KPI:

Tracked Markets

Toon aantal actieve markten.

---

Caching

60 seconden

---

Tests

- lege respons
- timeout
- rate limit
- foutsymbolen
- Bitvavo offline

---

Documentatie

Update:

API.md
DATABASE.md
README.md
CHANGELOG.md