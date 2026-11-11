# Portfolio Valuation Observability Plan

**Status:** Design only
**Scope:** Capture enough provenance alongside future portfolio snapshots to explain which market-data mark was used, its age, and whether a previous position mark was reused. No code, schema, database, or scheduler changes are included in this plan.

## Recommendation

Use the existing `AI_Crypto_Bot_Portfolio_Snapshots` row as the durable audit record:

1. Add a nullable `valuation_trace` JSONB column containing one compact trace entry per open position at that snapshot.
2. Add a nullable `current_price_source_captured_at` timestamp to `AI_Crypto_Bot_Positions`. Set it only when the existing eligible market-data row is actually copied into `current_price`; preserve it when the previous mark is carried forward.

The source timestamp on the position is necessary: `Market_Data` retains only its latest row, so after that row is overwritten, a later snapshot cannot otherwise know when the currently stored position mark was originally applied. Keep the new field nullable for existing positions whose source time cannot be reconstructed; do not backfill it from `updated_at`.

This reuses the existing snapshot cadence, transaction, ownership/RLS boundary, and scheduler. It adds no endpoint, API function, scheduler task, provider request, audit table, or index.

## Proposed trace contract

The snapshot's `valuation_trace` should have a versioned envelope and an array keyed by `position_id`, not just symbol, so multiple positions in one market remain distinguishable. Use UTC timestamps and serialize exact decimal prices as strings.

| Per-position field | Meaning |
|---|---|
| `position_id`, `symbol` | Identifies the open position valued by this snapshot. |
| `applied_price` | Exact `current_price` used in the portfolio-value sum. |
| `mark_source_captured_at` | Capture time of the market-data row that last set this applied mark; null when unknown for a legacy position. |
| `applied_price_age_ms` | Snapshot time minus `mark_source_captured_at`; null when the source time is unknown. |
| `market_data_price`, `market_data_captured_at` | Latest row observed for the symbol during this valuation, even if it is now stale; null if no row exists. |
| `market_data_age_ms` | Snapshot time minus the observed row's `captured_at`; null if no row exists. |
| `fresh_market_data_found` | Whether the observed row met the existing paper-refresh eligibility window (15 minutes old through 1 minute in the future). |
| `reused_previous_mark` | True when no eligible row was applied and the existing position mark was used. |

`applied_price_age_ms` and `market_data_age_ms` are deliberately separate. The first is the age of the source for the price actually valued; the second describes the latest row currently visible in `Market_Data`. A row can exist and be stale while the applied mark came from an older row. A negative age should be preserved rather than clamped, since the current eligibility window permits a timestamp up to one minute in the future.

These ages measure time since the application's `captured_at`, not necessarily time since the underlying last trade. The current ticker parser does not preserve a provider event timestamp. If a trustworthy provider timestamp is available in a later review, it can be added as a distinct optional field; it must not be inferred from local capture time.

Example shape (illustrative, not code):

```json
{
  "schema_version": 1,
  "positions": [{
    "position_id": "position-uuid",
    "symbol": "WIN-EUR",
    "applied_price": "0.000059401000",
    "mark_source_captured_at": "2026-11-04T01:48:00Z",
    "applied_price_age_ms": 9012000,
    "market_data_price": "0.000060599000",
    "market_data_captured_at": "2026-11-04T04:16:00Z",
    "market_data_age_ms": 127000,
    "fresh_market_data_found": false,
    "reused_previous_mark": true
  }]
}
```

In this example, the observed market-data row is too old for the current eligibility rule, so it was not applied; the previous position mark remains the valuation input.

## Capture semantics

- Determine quote eligibility with the same symbol and timestamp predicates already used by the paper-portfolio refresh. Do not change the thresholds or use candles as a substitute.
- Capture the candidate market-data row and prior position mark in the same database operation/transaction as the existing mark update. Build the trace from that same decision, rather than issuing a later independent lookup that could see a different row.
- When a row is eligible, retain its price and `captured_at` in the position's source timestamp and trace. Set `fresh_market_data_found=true` and `reused_previous_mark=false`, even if the numeric price happens to equal the prior mark.
- When no row is eligible, leave `current_price` and its source timestamp unchanged, record the applied prior price and its source age, and set `fresh_market_data_found=false` and `reused_previous_mark=true`. If a stale row exists, also record its price, capture time, and age.
- On the first eligible refresh for an already-open position after rollout, initialize its source timestamp. Until then, report source age as unknown instead of guessing from the generic position `updated_at`.
- For new positions, initialize the source timestamp from the same market-data row already used for the opening mark.
- Include a trace envelope with an empty `positions` array when there are no open positions. Leave pre-migration snapshots null; historical source data cannot be recovered.

The valuation formula, rounded portfolio value, mark eligibility, trade checks, snapshot cadence, and paper-trading outcomes remain unchanged. The added source timestamp is provenance only. Trace construction should be bounded by the existing maximum of five open positions and must not trigger extra market/provider requests.

## Option comparison

| Option | Advantages | Costs and limitations | Assessment |
|---|---|---|---|
| Scalar fields on each portfolio snapshot | Simple to query and low implementation overhead when a portfolio has exactly one position. | A snapshot can contain multiple open positions (up to five); one set of price/age fields would be ambiguous or incomplete. Repeating fixed columns per position is brittle. | Do not use alone. A JSONB trace in the existing snapshot is the compact multi-position form. |
| JSONB trace on the existing snapshot | One atomic record per existing snapshot; naturally represents 0–5 positions; no separate join, table, endpoint, or index. RLS and retention follow the existing snapshot. | Less convenient than normalized columns for ad hoc SQL; adds repeated per-snapshot payload and requires a versioned shape. | **Recommended.** |
| Normalized audit table, one row per position per snapshot | Strong relational constraints and straightforward filtering/aggregation by symbol, freshness, or age. | New prefixed table, migration, grants/RLS policy, indexes, foreign keys, extra insert per position, more WAL and operational maintenance. | Consider only if routine cross-snapshot SQL analytics is a confirmed requirement. |
| Separate execution-log table | Can represent run-level outcomes and skipped/failed executions separately from valuation snapshots. | Duplicates run/snapshot metadata and still needs per-position detail; if written in the same transaction, it rolls back with a failed transaction. Capturing failures independently requires a separate logging path. | Not justified for this snapshot-provenance requirement. |
| Function/runtime telemetry only | Lowest database storage; useful for immediate operational alerting. | Retention and search depend on the logging platform; does not provide a durable, transaction-correlated history, and repeated position-level financial data in logs is less desirable. | Optional supplement for aggregate counts/errors, not the audit source of truth. |

## Estimated impact

Assumptions: one portfolio snapshot every five minutes (288/day; 105,120/year), one to five open positions, and an estimated **0.25–0.45 KB per position trace** plus **0.05–0.10 KB per snapshot** for the JSONB envelope. These are planning estimates, not measured PostgreSQL row sizes; actual storage depends on JSONB compression, tuple/WAL overhead, and retention.

| Open positions | Estimated added trace payload per snapshot | Estimated raw payload per portfolio/year |
|---:|---:|---:|
| 1 | 0.30–0.55 KB | 32–58 MB |
| 5 | 1.30–2.35 KB | 137–247 MB |

The position source timestamp is one nullable value per position row, not a new row on every snapshot; its storage is negligible relative to the append-only trace. No JSONB index is recommended. Multiply the annual estimate by the number of portfolios and adjust for the actual snapshot cadence and retention.

**Performance:** Expect a small, bounded increase in database work: one timestamp assignment on the existing position update and JSON construction for at most five positions in the existing snapshot transaction. There is no additional network round-trip or provider call. Snapshot row size and WAL volume increase with the trace. Benchmark transaction duration and storage growth before broad production rollout; no measured latency claim is made here.

**Operational value:** High for the incident class in scope. Each snapshot can distinguish a new eligible row (including a same-price refresh) from reuse of a prior mark, show the currently observed row's age, and show how old the applied mark's source was. This resolves the specific evidence gap found in the [valuation mark lag root-cause analysis](./VALUATION_MARK_LAG_ROOT_CAUSE.md).

## Implementation guardrails for a future change

1. Add the two nullable columns through a new append-only migration under `PostgreSQL/migrations/`; do not edit an applied migration. Keep the existing table's RLS and grants unchanged.
2. Update the existing position-mark path and snapshot insertion only. Preserve all existing eligibility predicates and portfolio arithmetic exactly; do not modify a scheduler, route, cadence, decision, or trade rule.
3. Keep telemetry nullable and versioned. A legacy position's unknown source time must remain null until a known eligible source row is applied; never fabricate historical provenance.
4. Ensure trace generation cannot cause a different price to be selected or block the established valuation path. If trace-only construction fails, preserve the normal valuation/snapshot path, leave the trace null, and surface a diagnostic warning. Avoid indexes and external logging calls in the valuation transaction.
5. Add focused tests for: fresh quote; fresh quote with unchanged numeric price; stale row; no row; future-dated row inside the existing allowance; legacy null source time; multiple positions; empty positions; exact decimal serialization; and trace-capture failure without a valuation behavior change.
6. Document the field contract and retention/storage implications in `docs/DATABASE.md`. Verify snapshot reads and exports tolerate the additional nullable JSONB column without changing existing response shapes.

## Decision

Adopt **one nullable `valuation_trace` JSONB field on each new portfolio snapshot plus one nullable source-timestamp field on each position**. This is the smallest durable design that answers all four audit questions for multiple open positions, including the age of a mark after the current market-data row has been overwritten. Do not add a new audit or execution-log table unless future analytics require indexed, normalized position-level history.

## References

- [Root-cause analysis](./VALUATION_MARK_LAG_ROOT_CAUSE.md)
- [Portfolio mark update and snapshot calculation](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L81)
- [Position and market-data schema](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L36)
- [Database design and migration rules](../DATABASE.md)
- [Market and paper-trading cadence](../SCHEDULING.md)
