# Scheduling

## Phase 01 status

The schedule below is the intended future design. No scheduled functions or background jobs are active in Phase 01.

CryptoPulse is planned to use scheduled execution.

---

## Market Scan

Frequency:

Every 5 minutes

---

## AI Analysis

Frequency:

Every 5 minutes

---

## Portfolio Refresh

Frequency:

Every 5 minutes

---

## Strategy Evaluation

Frequency:

Every 15 minutes

---

## Market Ranking

Frequency:

Every 5 minutes

---

## Technology

Use:

- Vercel Cron Jobs
- Scheduled Functions

---

## Reliability

All scheduled jobs must be:

- idempotent
- retry-safe
- duplicate-safe

A duplicate execution may never create duplicate trades.