# PHASE 18 - AUTONOMOUS OPTIMIZATION

Goal:

Enable CryptoPulse to autonomously optimize selected strategy parameters.

All optimizations must remain bounded and reversible.

---

Requirements

Minimum:

- 250 closed trades
- 90 days history
- Positive optimizer performance track record

---

Allowed Automated Changes

- Confidence threshold
- Symbol prioritization
- Risk allocation

---

Forbidden

- Live exchange account changes
- Unlimited parameter changes
- Removal of safety controls
- Disabling risk management

---

Safety Controls

- Automatic rollback
- Performance monitoring
- Weekly optimization limit
- Drawdown protection

---

Monitoring

Track:

- Optimization history
- Before/after metrics
- Rollback events

---

Dashboard

Create:

Optimization Center

Show:

- Active optimizations
- Pending optimizations
- Previous optimizations
- Rollbacks

---

Testing

Validate:

- Autonomous changes
- Rollbacks
- Drawdown protection
- Failure recovery

---

Documentation

Generate:

PHASE_18_AUTONOMOUS_OPTIMIZATION_REPORT.md

---

Constraints

Maximum:
12 Vercel Functions

Reuse existing infrastructure.

Do not create unnecessary API endpoints.

Optimization Audit Trail

Do not store recommendation history.

Instead store only:

- Optimization changes
- Previous parameter values
- New parameter values
- Change timestamps
- Rollback information
- Before/after performance

Recommendation persistence remains disabled unless explicitly enabled in a future phase.

Recommendation History Policy

Phase 15 recommendations are generated on demand.

Recommendations are not persisted by default.

Current recommendation exports reflect the generated recommendations for the selected analysis period:

- 30 days
- 90 days
- 365 days

Do not introduce recommendation-history storage unless a later phase explicitly requires auditability or optimization tracking.

Reuse the existing generated recommendation model whenever possible.

Optimization Audit Trail

Do not store recommendation history.

Instead store only:

- Optimization changes
- Previous parameter values
- New parameter values
- Change timestamps
- Rollback information
- Before/after performance

Recommendation persistence remains disabled unless explicitly enabled in a future phase.