# ChatGPT Project Memory

This file stores context and collaboration preferences for ChatGPT when helping in this repository. It is not project implementation documentation or an instruction source for GitHub Copilot. `AGENTS.md` remains the project's source of truth for development requirements.

## How to help

- The user wants ChatGPT to help write ready-to-paste GitHub Copilot prompts tailored to CryptoPulse.
- For analysis prompts, default to read-only investigation unless the user asks for edits.
- Ask Copilot to inspect relevant code, tests, and documentation; cite concrete file paths and line numbers; separate verified facts from assumptions; and report unrun or blocked checks honestly.
- Prompts should respect the current phase, paper-trading-only mode, risk controls, security and database rules, and the 12 Vercel Function limit in `AGENTS.md`.
- Before relying on this snapshot, inspect the current roadmap, working tree, source, and newest relevant Markdown reports. A plan or audit is not an implementation; local checks do not prove production deployment or behavior.

## Project status snapshot (2026-11-04)

- Phase 15 AI Recommendations is documented as locally implemented; hosted deployment and Supabase/Realtime verification remain outstanding. See `docs/reports/PHASE_15_AI_RECOMMENDATIONS_REPORT.md`.
- AI analysis candle history was changed locally to retain the newest 150 candles per market/interval while keeping the PostgREST page size at 1,000. The implementation report records 267 passing tests and a passing build. This does not establish deployment or measured production CPU savings. See `docs/reports/HISTORY_CAP_IMPLEMENTATION_REPORT.md` and `docs/reports/FULL_1000_VS_150_DECISION_REPLAY.md`.
- The 150-candle behavior replay covered one complete 102-market batch and preserved decision types in that sample; the reports describe the multi-period and historical-data limitations.
- A 10-minute AI-analysis cadence was evaluated read-only and received a “more validation required” verdict. No scheduler change was made. See `docs/reports/AI_ANALYSIS_10MIN_CADENCE_VALIDATION.md`.
- Expanding candle refresh batches from five to ten markets was evaluated read-only and needs more validation; no scheduler or production setting was changed. See `docs/reports/BATCH_SIZE_10_VALIDATION.md`.
- AI-analysis profiling has a design plan; stage-level profiling instrumentation is not documented as implemented. See `docs/reports/AI_ANALYSIS_PROFILING_PLAN.md`.
- Phase 16 Strategy Simulation has a prompt/specification in `prompts/16_STRATEGY_OPTIMIZATION_SIMULATOR.md`; the roadmap marks the phase planned, not implemented.

This is a dated starting point, not authoritative current state. Refresh it when project status materially changes.
