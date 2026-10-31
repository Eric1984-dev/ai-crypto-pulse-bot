# Password Reset Redirect Fix Report

**Issue:** Recovery emails redirected to the site root instead of the password reset page.

**Fix:** The auth service now constructs the redirect from the current origin with the fixed `/reset-password.html` path before calling Supabase `resetPasswordForEmail()`. Supabase Auth must also allow the exact deployed reset URL; otherwise it can fall back to the configured Site URL.

**Validation:** `npm.cmd test` passed (27 tests); `npm.cmd run build` and syntax checks for the auth scripts and tests passed.

**Scope:** Phase 02 password-reset redirect only. No Phase 03 work.
