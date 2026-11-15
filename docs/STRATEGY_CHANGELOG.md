# Strategy Changelog

Alle wijzigingen aan strategieën moeten hier worden geregistreerd.

---

### Strategy

V2 Daily-EMA-led paper strategy — misalignment and volatility research adjustment

### Version

Engine identifier remains `2.0.0`; this is a paper-only research adjustment.

### Change Date

2026-11-16

### Changes

- Subtract 20 points from Market Strength and confidence when the 1h and 1d trends do not establish the same non-sideways direction.
- Preserve the existing ATR-based volatility classification and average calculation, capped at five confidence points.
- Keep the AI signal floor at 65, paper executor BUY threshold at 70, and all execution/risk rules unchanged.

### Reason

The preceding signal analysis found frequent timeframe-disagreement noise and a volatility penalty that could disproportionately suppress some markets. A user-provided ~24-hour stateful replay indicated more paper trades and traded markets with lower realized loss and drawdown under the proposed settings. That replay is limited historical evidence, not a profitability claim.

### Expected Impact

- Reduce the directional strength and confidence of misaligned signals.
- Limit the maximum average volatility deduction to five points while retaining ATR-based classification.
- Keep the executor's explicit alignment gate and all position, cooldown, sizing, drawdown, emergency, and exit protections.

### Results

The reported replay comparison was 2 BUY / 1 SELL across one market (CAP-EUR), realized P&L -€10.48 and max drawdown 1.017% for the prior configuration, versus 5 BUY / 3 SELL across two markets (CAP-EUR and MEGA-EUR), realized P&L -€2.65 and max drawdown 0.887% for the proposed configuration. These user-provided figures have not been independently reproduced against this implementation. Re-evaluate with a fresh stateful replay; track executed trades, unique markets, realized P&L, maximum drawdown, rejected-signal reasons, and volatility/misalignment distributions.

---

## Template

### Strategy

Naam strategie

### Version

v1.0

### Change Date

YYYY-MM-DD

### Changes

- wijziging 1
- wijziging 2

### Reason

Waarom werd de wijziging gedaan.

### Expected Impact

Verwachte verbetering.

### Results

Wordt na evaluatie ingevuld.