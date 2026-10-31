Read completely before making changes:

- AGENTS.md
- README.md
- ROADMAP.md
- ARCHITECTURE.md
- DATABASE.md
- docs/PHASE_03_COMPLETION_REPORT.md
- docs/PHASE_04_COMPLETION_REPORT.md
- prompts/05_AGENT_BRAIN.md
- .github/copilot-instructions.md

Current status:

- Phase 01 completed
- Phase 02 completed
- Phase 03 completed
- Phase 04 completed
- Supabase database is live
- Dashboard reads live data from Supabase
- AI_Crypto_Bot_Status is already displayed in the Dashboard
- A placeholder section already exists:

"Agent Brain visualization · Phase 05"

Execute Phase 05 only.

Do not start Phase 06.

Goal:

Implement the Three.js Agent Brain.

Dashboard Integration:

Replace the existing:

"Agent Brain visualization · Phase 05"

placeholder with the live Three.js Agent Brain.

Do not move dashboard sections.

Do not redesign the Phase 04 layout.

The Brain must remain in its current dashboard location directly below:

Backend status
Agent Status

and above:

Risk control
Emergency State

Data Source:

AI_Crypto_Bot_Status.status

Never use hardcoded demo states.

Supported states:

ACTIVE
ANALYZING
IDLE
STOPPED
ERROR

Visualization Rules:

ACTIVE:
- Blue pulse effects
- Moderate neural activity
- Continuous movement

ANALYZING:
- Bright intense blue
- Faster pulse rate
- Increased neural activity

IDLE:
- Slow breathing animation
- Soft blue glow
- Low activity state

STOPPED:
- Static grey brain
- No pulse activity

ERROR:
- Red warning glow
- Intermittent pulse effect

Fallback Requirements:

If no valid status exists:

- Display UNKNOWN
- Use a neutral safe visualization
- Never throw runtime errors

Performance Requirements:

- Three.js
- Responsive
- Mobile friendly
- No horizontal overflow
- No memory leaks
- Pause animation when page/tab becomes hidden
- Efficient rendering

Testing:

Add tests for:

- Status mapping
- Supabase data loading
- Dashboard integration
- Fallback handling
- Rendering initialization
- Performance safeguards

Validation:

Run:

- npm test
- npm run build

Documentation:

Update:

- README.md
- ARCHITECTURE.md
- TESTING.md
- CHANGELOG.md

Generate:

PHASE_05_COMPLETION_REPORT.md

Report:

- Files changed
- Tests added
- Validation results
- Performance checks
- Dashboard integration details

Implement only Phase 05.

Do not start Phase 06.