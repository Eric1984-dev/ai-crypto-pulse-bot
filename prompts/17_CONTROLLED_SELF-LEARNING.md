# PHASE 17 - CONTROLLED SELF-LEARNING

Goal:

Allow CryptoPulse to propose strategy modifications based on historical performance.

Changes must remain controlled and reversible.

---

Inputs

Use:

- Analytics
- Recommendations
- Strategy Simulations

---

Rules

Before any change:

- Minimum 100 closed trades
- Minimum 30 days history
- Positive statistical significance
- Positive simulation result

---

Allowed Changes

- Confidence threshold
- Symbol priority
- Symbol exclusion
- Risk weighting

---

Limits

Maximum:

- One change per week
- 5% parameter movement
- One active optimization at a time

---

Safety

Change must include:

- Previous value
- New value
- Reason
- Expected impact
- Rollback version

---

Monitoring

Track:

- Performance before change
- Performance after change

---

Approval Modes

Support:

- Manual Approval
- Semi-Automatic Approval

Default:

Manual Approval

---

Dashboard Integration

Create:

Strategy Optimization

---

Testing

Validate:

- Change proposals
- Rollback generation
- Approval flow

---

Documentation

Generate:

PHASE_17_SELF_LEARNING_REPORT.md

---

Constraints

Maximum:
12 Vercel Functions

Do not introduce new trading endpoints.

Do not start Phase 18.