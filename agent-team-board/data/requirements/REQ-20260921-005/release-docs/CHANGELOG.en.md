[中文](./CHANGELOG.md) | English

# Changelog

Records what each agent-team-board release ships. Item-level details (requirement / bug tickets, designs, test reports) live in the board user data `agent-team-board/data/` and are committed with the version; this file only summarizes at the version level. See [FEATURES.en.md](./FEATURES.en.md) for the feature list.

## [20260920-001] Full-Feature Baseline: Requirements Board · AI Analysis & Development · Version Release (2026-09-20)

The first full-feature baseline version: integrates 339 delivered items from 2026-08-29 to 2026-09-20 (164 requirements, 175 bugs, 90 commits), version plan BLD-20260920-001.

### Requirements Board (item management)

- Final item status columns: pending-accept / accepted / planned / in-development / pending-test / done; human-only transitions (accept, plan, confirm done) are deterministically blocked for Agents by the state guard.
- Added bulk accept, bulk move-to-plan, reject back to pending-accept, delete pending items, edit title and description, create-and-accept; actions drop confirmation dialogs and offer undo.
- Detail page upgraded to a tabbed layout with previous/next quick navigation; list and detail panes at a 1:2 ratio.
- Added list sorting, global search (requirements / bugs / discussions and docs), and a latest-100 default for the done list (older items via search).
- Screenshots in item descriptions and discussions (shown in details, double-click to zoom); one-click ID copy button.
- Adaptive full-window layout and landscape redesign of the board; added project management (multi-project, detect and remove dead directories in one click), board shortcuts, and automatic board switching to the session's project.

### Tasks module (AI Analysis / AI Development)

- "Batch refine / batch development" evolved into **AI Analysis / AI Development**: the batch concept was removed — each run executes the current queue in real time from start to finish; newly accepted / newly planned items join the queue automatically.
- Execution channels: a lightweight Zcode main dispatcher (one sub-agent per item, file-based receipts) and Codex background auto-dispatch (one session per item, log tracking and process reaping); prompts unified into agent-agnostic wording, model config kept identical to the main dispatcher session.
- Added the pending-human-decision (hold) loop: blocked items stay visible, the human answers decisions, then the item resumes in the queue; added the pending-confirmation loop: when an auto-commit is incomplete the item is held and the queue paused until the human confirms and resumes.
- Each item is auto-committed to dev by the system upon reaching pending-test (same rule for manual /dev and batch runs); execution records, resume runs, abort semantics, and the global task board.
- AI Analysis (requirement refinement) produces the spec doc plus an interactive UI demo (single-file html), with optional auto move-to-plan after refinement (manual by default, configurable).

### Discussions module

- The Oncall board evolved into **open discussions**: discussion tickets, rich text and screenshots, bulk / single-ticket replies dispatched to zcode or codex.
- Discussions persist round by round, expose document assets, and continue across sessions; minutes can generate a requirement or bug in one click.
- Right-click "Discuss" on requirement / bug docs (spec, design, test cases) generates a context-rich prompt; discuss a single requirement with an Agent.

### Builds and releases

- Added the **builds module** (between the requirements and tasks modules): BLD version-plan management, association with completed items and commits (dedupe, select-all, already-included items excluded elsewhere), AI-refined version info (editable before saving), version deletion, and merge into main.
- Merge strategy settled: no rebase; per-item `--no-ff` merges, with `--first-parent` for a clean main view; management files auto-commit after human confirm-done and after a successful version merge, with clear failure prompts and retry.
- Added branch browsing: branch list, "sync with remote" (fetch then push), commit search within the current branch, and master fallback when main is missing.
- Product release pipeline (PREL, six stages): launch a cross-repo release from a merged version plan and track results; website target adapted to the new Vite + Vue site architecture; added the repo-root `index.html` web-app landing page.
- Build publishing decoupled from the old release modules (independent executor and source of truth); overall build-and-release process overhaul.

### Desktop (Electron)

- Added the Electron desktop shell (embedding the Status Board service): traffic-light avoidance, title-bar dragging, Cmd+R returns to the pre-refresh view, app layout tuning.
- electron-builder packaging for macOS dmg / Windows nsis.

### Internationalization

- Added English UI resources: a centralized copy dictionary plus a runtime DOM translation layer; keeping Chinese and English in sync is a hard quality baseline, and the AI development prompt embeds a bilingual-resource check requirement.

### Security and state guard

- The board API validates Origin / Host, blocking cross-site abuse of human-only "accept / confirm done" actions (CSRF).
- The state guard closed multiple bypass routes: quote-splitting, inline interpreter writes (node -e etc.), find -delete, symlinked paths, and new files in file mode; several false positives on read-only commands were also removed.
- Claim-lock hygiene: stale-lock cleanup, tightened claim / report lifecycle; the root README.md pure-doc file is exempt from the claim lock; doc-round git commits of item-directory user data are allowed (with pathspec and an ID in the subject).

### Data architecture and engineering

- Physical separation of user data and app data: `agent-team-board/data/` (in git) and `agent-team-board/runtime/` (local only); confirmation records moved into runtime.
- Added `atb rebuild`: reconstruct board state from git history after a clone; one-shot migration for the legacy layout (`atb migrate` and a settings-page entry).
- Bilingual README (README.en.md mirrors the Chinese sections one-to-one); source-repo entry docs reorganized per the four-repo layout (root AGENTS.md).
- Service stability: SIGTERM exit and port-occupation handling; eliminated index.lock contention between serve-polling git scans and terminal git.

### Tests and stability

- Fixed multiple classes of flaky failures (port probing, time boundaries, timeouts under load, order sensitivity in full runs) and integration-test process leaks; closed the recurring detail-close-btn contract regressions.
- Fixed the hard-coded timeout of the confirmation full-test loop so long suites can pass confirmation.

### Removed / hidden (not shipped capabilities of this version)

- Rolled back the CI board and bulk Commit (kept commit-hash display for completed items).
- Hidden: the file board (File Board), marketing, and the old release views; release capabilities were restructured into the builds module.
