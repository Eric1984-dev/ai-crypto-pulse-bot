# Password Reset Bug-Fix Report

**Issue:** The reset email and password-change forms appeared together, and submitting a password change without a recovery session could produce `Auth session missing!`.

**Cause:** The password form's HTML `hidden` attribute was overridden by the auth-card form styling. Recovery-mode UI also depended only on a URL marker, without requiring a session.

**Fix:** Hidden auth forms now remain `display: none`. The page shows password fields only when the recovery link's access token matches the loaded Supabase session, or a `PASSWORD_RECOVERY` event supplies a session token. Password updates verify that recovery session before calling Supabase.

**Validation:** `npm.cmd test` passed (26 tests); `npm.cmd run build`, `node --check js\auth.js`, and `node --check tests\auth.test.js` passed.

**Scope:** Phase 02 password-reset regression only. No Phase 03 work.
