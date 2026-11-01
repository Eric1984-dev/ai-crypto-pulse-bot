# UI Language Standardization Report

## Scope audited

- Dashboard
- Market Scanner
- Portfolio and paper-trading summaries
- Trade History
- AI decisions and Agent Brain
- Watched Markets
- Settings and Admin
- Login, registration, and password recovery
- Shared navigation, page footers, accessibility labels, loading/error/realtime states, and dynamic status messages

## Text and terminology updated

- Replaced Dutch headings, descriptions, labels, buttons, empty states, loading states, retry controls, footers, and accessible navigation labels with English copy.
- Standardized navigation terms to **Market Scanner**, **Trade History**, **Settings**, and **Sign out**.
- Standardized paper-trading and execution language, including the trade status **Executed · paper**.
- Translated dynamic portfolio and Realtime status messages, and standardized Admin action results to **Completed** and **Failed**.
- Changed number, currency, quantity, and date formatting from Dutch `nl-NL` conventions to English `en-GB`. Timestamps remain localized to `Europe/Brussels`; stored and API timestamps remain UTC.

## Dashboard cleanup

- Removed the **Markets with Data** scanner-derived KPI.
- Removed the Dashboard's `/api/market-summary` request and its market-price / 24-hour-change details.
- Retained the required **Tracked Markets** KPI and **Watched Markets** list, limited to watched-market symbols and priorities.
- No scanner ranking, preview, teaser, or duplicate scanner section is rendered on the Dashboard.

## Scanner relocation verification

- The dedicated [scanner.html](./scanner.html) page remains the only UI location for **Top Gainers**, **Top Losers**, **Highest Volume**, **Strongest Momentum**, and **AI Opportunities**.
- Regression tests assert that the Dashboard contains none of those rankings and does not request `/api/market-summary`.
- Scanner data continues to use the existing `/api/market-summary` endpoint. No API endpoint or Vercel Function was added.

## Files changed

- Pages: `admin.html`, `dashboard.html`, `history.html`, `index.html`, `login.html`, `portfolio.html`, `register.html`, `reset-password.html`, `scanner.html`, `settings.html`
- Shared UI scripts: `js/admin.js`, `js/dashboard.js`, `js/formatters.js`, `js/history.js`, `js/portfolio.js`, `js/realtime.js`, `js/scanner.js`
- Regression tests: `tests/admin.test.js`, `tests/dashboard.test.js`, `tests/portfolio.test.js`, `tests/price-formatting.test.js`, `tests/realtime.test.js`, `tests/trade-history.test.js`
- Documentation: `README.md`, `docs/CHANGELOG.md`, `UI_LANGUAGE_STANDARDIZATION_REPORT.md`

## Phase and validation

- No Phase 11 work was started.
- `npm.cmd test -- --test-reporter=dot` — passed.
- `npm.cmd run build` — passed; static project and database migration validation succeeded.
