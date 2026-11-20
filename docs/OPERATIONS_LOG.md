# Operations Log

Belangrijke operationele gebeurtenissen worden hier geregistreerd.

---

## Template

### Date

YYYY-MM-DD HH:mm

### Event Type

Deployment
Database Migration
Strategy Change
Incident
Maintenance

### Description

Omschrijving van wat gebeurde.

### Result

Success
Failure
Partial Success

### Notes

Extra informatie.

### Date

2026-11-02

### Event Type

Incident Investigation

### Description

Investigation into unexpectedly low Paper Trading activity.

Live Supabase analysis showed:

- 156 BUY decisions with confidence >= 70
- 1 executed BUY trade
- 1 active BEAM-EUR position

BEAM-EUR generated 142 qualified BUY decisions. Most subsequent BEAM-EUR BUY signals are likely explained by the one-position-per-symbol rule while the original position remains open.

WIN-EUR generated 14 qualified BUY decisions with confidence >= 70 but produced no executed trade.

The platform supports multiple simultaneous positions and currently has available balance, no active cooldown, no emergency stop, and only 1 of 5 position slots in use.

### Result

Partial Success

### Notes

BEAM-EUR behavior is currently consistent with the implemented Paper Trading rules.

WIN-EUR remains unexplained.

At least one WIN-EUR trade would reasonably have been expected if the Paper Trading executor ran during a valid execution window.

Current leading hypotheses:

- Scheduler timing issue
- Decision superseded before execution
- Runtime execution gate not currently observable

The database does not retain per-decision execution outcomes or rejection reasons.

Future roadmap items created:

- Future Enhancement - Paper Trading Execution Audit
- Future Enhancement - Position Management & Exit Strategy

Status:

Monitoring. Further investigation may require execution-level audit data or scheduler history.

### Date

2026-11-02

### Event Type

Strategy Experiment

### Description

Approved Paper Trading experiment to lower the BUY-entry confidence threshold from 70 to 67. The implementation is in migration `20261102140000_paper_trading_confidence_experiment.sql`; it changes only the server-side paper-trading gate.

Reason:

Analysis showed:

- BUY 65-70: 625
- BUY 70-75: 156

Approximately 80% of BUY signals were being filtered out by the existing entry threshold.

The change is intended to increase paper-trading activity and collect more Analytics data.

### Result

Pending Evaluation. The migration and local validation are recorded in the experiment report. Production migration and deployment have not been verified.

### Notes

Paper Trading only.

No Live Trading impact.

Review at 25 closed trades and, if continued, make the final evaluation at 50 closed trades.

Metrics:

- Win Rate
- Profit Factor
- Drawdown
- Portfolio Growth
- Trade Count

---

### Date

2026-11-20

### Event Type

Strategy Documentation / Runtime Status Reconciliation

### Description

The V2.1.0 paper-only BUY filter is reported by the operator as deployed to the
Raspberry Pi. Production AI decision rows tagged `strategy_version = '2.1.0'`
were observed during read-only analysis. This confirms that version-tagged
decisions were persisted; it does not independently identify the running Pi
binary/build.

The active Raspberry Pi code has an AI directional-signal confidence floor of
65 and a separate paper executor BUY confidence gate of 70. The 67 value in the
2026-11-02 entry above records the earlier SQL-executor experiment and is not
the current Pi executor setting. AI BUY generation uses the signed Market
Strength threshold and confidence floor; daily/hourly alignment affects score
and confidence, while the executor separately requires alignment before
opening a position. V2.1.0 additionally filters AI BUY candidates on positive
1d momentum and hourly volume score >= 0.25.

### Result

No code, configuration, database, deployment, or strategy changes were made by
this documentation reconciliation. The recorded analysis remains descriptive;
V2.1.0 performance is not established by the small closed-trade sample.
