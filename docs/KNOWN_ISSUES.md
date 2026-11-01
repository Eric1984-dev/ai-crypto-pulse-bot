# Known Issues

Dit document bevat gekende beperkingen en openstaande problemen.

---

## Open Issues

No known blocking implementation issues.

## Scope Limitations

The dashboard and portfolio are database-backed. Scanner, history, and settings remain placeholders. Signal-generating scanner logic, strategy optimization, backtesting, realtime functionality, and live trading are not implemented. Paper-trading requires the Phase 08 migration and an external scheduler configured to invoke AI analysis before paper execution.

Dashboard and portfolio requests require valid Supabase configuration and applied migrations. Realized/unrealized P&L summaries are shown as unavailable when their bounded source queries exceed supported limits rather than returning partial sums. Live Supabase, deployed Vercel, external scheduler, and physical mobile-device smoke testing must be performed separately. Chart.js and Three.js are loaded from pinned CDNs. If either library is unavailable, its visualization falls back to a visible unavailable state while database status and other data remain available.

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