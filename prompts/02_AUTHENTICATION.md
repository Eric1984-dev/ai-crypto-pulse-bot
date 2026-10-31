Read:

- AGENTS.md
- README.md
- ROADMAP.md
- .github/copilot-instructions.md
- all files in docs/
- prompts/02_AUTHENTICATION.md

Execute Phase 02 exactly as defined.

Requirements:

Implement Supabase Authentication only.

Features:

- Registration
- Login
- Logout
- Password Reset

Protected Pages:

- dashboard.html
- portfolio.html
- scanner.html
- history.html
- settings.html

If a user is not authenticated:

- redirect to login page
- prevent access to protected pages

Use:

- Supabase Authentication
- Supabase Session Management

Do not implement:

- Database schema changes
- Market Data
- Bitvavo Integration
- AI Engine
- Paper Trading
- Market Scanner Logic
- Realtime Features

Testing:

- Registration
- Login
- Logout
- Password Reset
- Protected Route Access
- Unauthorized Access Redirection
- Session Persistence

Documentation:

Update:

- README.md
- API.md
- ARCHITECTURE.md
- TESTING.md
- CHANGELOG.md

After implementation:

- Run all applicable tests
- Report test results
- Report files changed
- Report documentation updates
- Produce a complete Phase 02 Completion Report

Do not start Phase 03.