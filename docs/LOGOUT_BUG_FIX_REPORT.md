# Logout Bug-Fix Report

**Issue:** Logout controls were visible on protected pages but clicking them did nothing.

**Cause:** The controls had `data-auth-logout` and the script ran after the DOM was parsed, but their click listeners were registered inside `bindForms()`. Protected-page initialization returned before calling `bindForms()`.

**Fix:** Logout listener registration now runs during shared auth initialization before the protected-page return. The listener calls Supabase sign-out, deletes the HttpOnly session cookie, and redirects to login.

**Validation:** `npm.cmd test` passed (23 tests); `npm.cmd run build`, `node --check js\auth.js`, and `node --check tests\auth.test.js` passed.

**Scope:** Phase 02 logout regression only. No Phase 03 work.
