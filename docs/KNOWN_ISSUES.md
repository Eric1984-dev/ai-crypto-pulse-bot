# Known Issues

Dit document bevat gekende beperkingen en openstaande problemen.

---

## Open Issues

No known blocking implementation issues.

## Scope Limitations

Only the dashboard is database-backed. Portfolio, scanner, history, and settings remain placeholders; market-data ingestion, Bitvavo, AI execution, paper-trade execution, scanner logic, realtime functionality, and live trading are not implemented.

The dashboard requires the Supabase environment variables and the Phase 03 schema to be available in the target environment. Live provider/database smoke testing and physical mobile-device testing must be performed separately. Chart.js and Three.js are loaded from pinned CDNs. If either library is unavailable, its visualization falls back to a visible unavailable state while database status and other dashboard data remain available.

---

## Template

### Issue

Beschrijving:

Impact:

Workaround:

Status:

Open | In Progress | Resolved

Date:

YYYY-MM-DD