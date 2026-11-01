# PHASE 15 - AI RECOMMENDATIONS

Goal:

Allow CryptoPulse to evaluate its own performance and generate recommendations.

The system may analyze results but may not automatically change strategy parameters.

Recommendations are advisory only.

---

Analyze

Use:

- AI_Crypto_Bot_AI_Decisions
- AI_Crypto_Bot_Trades
- AI_Crypto_Bot_Positions
- AI_Crypto_Bot_Portfolios
- AI_Crypto_Bot_Portfolio_Snapshots

---

Generate Recommendations

Examples:

- Increase confidence threshold
- Decrease confidence threshold
- Remove underperforming symbols
- Increase priority of profitable symbols
- Reduce exposure to losing symbols
- Increase momentum weighting
- Reduce weak-performing strategies

---

Evaluate

Calculate:

- Confidence bucket performance
- Symbol performance
- Strategy performance
- Win rate contribution
- PnL contribution
- Drawdown contribution

---

Recommendation Output

For every recommendation show:

- Recommendation
- Reason
- Supporting metrics
- Estimated impact
- Confidence level

Example:

Recommendation:
Increase minimum confidence threshold from 70 to 80

Reason:
Trades below 80 confidence produce lower win rates.

Estimated Impact:
+8% win rate

Confidence:
High

---

Dashboard Integration

Create:

AI Recommendations

Separate from:

- Analytics
- Scanner
- Portfolio

---

Approval Model

Recommendations are informational only.

No automatic strategy changes.

No automatic trading changes.

---

Exports

Support CSV export of recommendations.

Reuse existing exports infrastructure.

---

Testing

Validate:

- Recommendation generation
- Confidence analysis
- Symbol analysis
- Empty datasets
- Large datasets

---

Documentation

Update:

- README.md
- CHANGELOG.md
- TESTING.md

Generate:

PHASE_15_AI_RECOMMENDATIONS_REPORT.md

---

Constraints

Vercel Hobby:

Maximum:
12 Serverless Functions

Do not add API endpoints unless absolutely necessary.

Reuse existing Analytics infrastructure.

Do not start Phase 16.