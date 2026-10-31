# Authentication Bug-Fix Report

**Issue:** Opening a public auth page without signing in triggered `POST /api/auth-session` and returned `INVALID_SESSION`.

**Cause:** Supabase `getSession()` returns `{ session: null }` for anonymous users. The auth service returned that wrapper as though it were the session, and the truthy wrapper caused the page bootstrap to request server verification with no access token.

**Fix:** The auth service now returns the actual session or `null`. Session-cookie synchronization also requires a non-empty access token, and auth page session checks use that guard. The server continues rejecting invalid session requests.

**Validation:** `npm.cmd test` passed (21 tests); `npm.cmd run build` passed; `node --check js\auth.js` and `node --check js\auth-service.js` passed.

**Scope:** Phase 02 authentication regression only. No Phase 03 work.
