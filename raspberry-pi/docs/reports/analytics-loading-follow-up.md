# Analytics Loading Follow-up

## Reported symptom

Both dashboard tabs, Analytics and AI Recommendations, returned the same `ANALYTICS_UNAVAILABLE` response. Both use `DashboardRepository.getAnalytics()` on the Raspberry Pi API.

## Code-level cause and fix

The analytics repository fetched every AI decision in the selected period and rejected the entire response if that result exceeded 10,000 rows. AI analysis runs across enabled markets on the five-minute runtime cycle, making this cap unsuitable for normal long-running operation.

The repository now aggregates decision counts in PostgreSQL for total decisions, actions, confidence bands, strategies, and symbols. For trade outcome scoring it fetches only decisions referenced by the bounded set of trades, instead of loading all historical decisions. The endpoint response shape and recommendation logic remain unchanged.

Analytics repository errors are also logged with the API request ID, view, and a safe data reason or PostgreSQL error code. This allows operators to correlate future generic `ANALYTICS_UNAVAILABLE` responses with the Pi runtime logs without exposing database messages or credentials.

## Validation and limitations

- The analytics/recommendation tests passed after the aggregation change, including a repository test with 10,001 additional AI decisions.
- A later test rerun covering the newly added request-ID diagnostic test was denied; the final diagnostic changes are therefore unverified.
- Full repository and Raspberry Pi suites were not run for this follow-up.
- The production Pi database was not queried, so the supplied request IDs and live decision count could not be matched to the code-level cap. Other stored-data or database failures remain possible; the new request-correlated logs can identify them after the Pi receives this change.
- No Pi update, service restart, or deployment was performed.

## Production verification

After updating and restarting the Pi runtime, verify both authenticated requests return `200`:

- `/api/v1/dashboard-data?view=analytics&period=30d`
- `/api/v1/dashboard-data?view=recommendations&period=30d`

If either still fails, find the `dashboard_repository_failed` log entry by its response `requestId`; it records the failing view and a safe diagnostic.
