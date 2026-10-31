# Changelog

All notable project changes should be documented here.

---

## [Unreleased]

### Added

- Phase 01 static project structure and six placeholder pages
- Shared responsive CSS and small browser navigation script
- Node.js built-in test setup and static project validation command
- Vercel static hosting configuration and Phase 01 completion report
- Supabase registration, login, logout, and password recovery flows
- Persistent client sessions and HttpOnly session cookie verification
- Server-protected page rewrites and authentication route tests
- Phase 02 completion report
- Initial project documentation
- AGENTS.md
- README.md
- ROADMAP.md
- Architecture documentation
- Database documentation
- API documentation
- Risk management documentation
- Deployment documentation
- Testing documentation

### Fixed

- Prevent anonymous auth pages from sending an empty session to `/api/auth-session` by unwrapping Supabase `getSession()` results and checking for an access token before cookie synchronization
- Bind logout controls during auth initialization on protected pages so logout signs out, clears the server cookie, and redirects to login
- Keep password-change fields hidden until a recovery session is detected; preserve the hidden state against auth-card form styling
- Always pass `/reset-password.html` as the password reset email redirect target

---

## Future Releases

Each completed phase should add:

### Added
### Changed
### Fixed
### Removed
### Security