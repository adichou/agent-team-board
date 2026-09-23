[中文](./FEATURES.md) | English

# Features

The current agent-team-board version: **20260920-001 Full-Feature Baseline** (version plan BLD-20260920-001, 2026-09-20). This page lists the user capabilities shipped in this version and how to reach them; for version-by-version history see [CHANGELOG.en.md](./CHANGELOG.en.md).

## Overview: the three-board collaboration system

| Board | Carrier | How to enter |
| ----- | ------- | ------------ |
| Project Board | ZCode built-in project / session list | Nothing to install; files are the source of truth |
| Discussion Board | Chat window + commands | `/req` `/bug` `/dev` `/board` |
| Status Board | Local web board (default port 8888) | `node scripts/server.mjs`; the desktop shell `npm run app` starts it automatically |

## Requirements and bug management

- Create requirements / bugs (with screenshots; discussion tickets too) via `/req` `/bug` or the board form; the list navigates to the new item after creation.
- Item states follow a human/Agent split: Agents can only create, claim, and report; **accept, plan, and confirm-done are human-only** (board buttons or terminal `atb status`), with Agent overreach deterministically blocked by the state guard.
- Pending-accept / accepted lists support bulk accept, bulk move-to-plan, reject, delete, and editing title and description; actions drop confirmation dialogs and offer undo.
- Tabbed detail page (spec / design / test cases, etc.) with previous/next quick navigation.
- List sorting, global search (requirements / bugs / discussions and docs), and a latest-100 default for the done list.
- One-click ID copy; item screenshots render in details with double-click zoom.

## AI Analysis and AI Development (tasks module)

- **AI Analysis**: bulk-refine accepted items with a spec doc and an interactive UI demo (single-file html, opens directly in a browser); optional auto move-to-plan after refinement (manual by default, configurable).
- **AI Development**: picks items from the planned queue in real time and implements them TDD-style; two channels — Zcode (lightweight main dispatcher + one sub-agent per item) and Codex (background dedicated sessions) — with agent-agnostic prompts.
- Each item reaching pending-test is auto-committed to the dev branch by the system, with the commit hash visible on the item; execution records support viewing, resuming, and aborting.
- The global task board aggregates the batch tasks currently running.

## Human in the loop

- **Pending human decision (hold)**: when an Agent is blocked it declares a question list; the item stays in the board's "pending human confirmation" area. The human answers each question (drafts supported) and resumes in one click, returning the item to the queue.
- **Pending confirmation**: when an auto-commit is incomplete the item is held and the queue paused; the human reviews commit attribution and file diffs in the panel, then confirms to resume the queue.

## Open discussions

- Create discussion tickets (rich text + screenshots); dispatch bulk or single replies to zcode or codex.
- Discussions persist round by round, continue across sessions, and expose document assets; minutes can generate a requirement or bug in one click.
- Right-click "Discuss" on a requirement / bug doc (spec, design, test cases) generates a prompt with the doc's context, ready to paste into a new Agent session.

## Builds and version release

- **Builds module** (between the requirements and tasks modules): BLD version-plan management — associate completed items and commits, AI-refine the version name and description (editable before saving), delete versions, merge into main (per-item `--no-ff`, `--first-parent` view).
- **Branch browsing**: local / remote branch list, "sync with remote" (fetch then push), commit search within the current branch; master fallback when main is missing.
- **Product release (PREL)**: launch a cross-repo product release from a merged version plan (source sync → site build → verify → materials → deploy → re-verify) and track results; the website target supports Vite + Vue sites.
- Version prompt and answer backfill: items / commits support select-all; prompts can be copied or sent to a new Agent session in one click.

## Status Board

- Zero-dependency Node service, default port 8888 (`ATB_PORT` override); one service for multiple projects, `?project=<absolute project root>` switches the data source.
- 2-second polling refresh; light/dark themes; board shortcuts; project management (multi-project registration, detect and remove dead directories in one click).
- The API validates Origin / Host to prevent cross-site abuse of human-only actions (CSRF).

## Desktop (Electron)

- `npm run app` starts the desktop shell (which starts the Status Board service); `npm run dist` packages macOS dmg / Windows nsis.
- Title-bar dragging, Cmd+R returns to the pre-refresh view, traffic-light avoidance.

## CLI (atb)

- `node scripts/atb.mjs <subcommand>`; after `atb cli install`, just run `atb …` in the terminal.
- Common ones: `init` project setup, `new req|bug` create, `list / show` query, `claim / report` claim and report, `batch / refine` batch tasks, `hold` pending human decisions, `commit log|which` commit index, `migrate` legacy-layout migration, `rebuild` reconstruct state from git history, `pack` plugin distribution packaging.

## Engineering and quality

- Zero npm runtime dependencies (desktop packaging chain excluded); `npm test` runs the full regression (aggregated from scripts/tests/, non-zero exit on any failure).
- User data (`agent-team-board/data/`, in git) and app data (`agent-team-board/runtime/`, local only) are physically separated; single-device usage.
- Chinese/English UI resources are maintained in pairs; open-source intake follows the friendly-license whitelist and is logged in the item's licenses.md.

## Currently hidden capabilities (not shipped capabilities of this version)

- The file board (File Board), marketing module, and old release views: hidden in the UI; release capabilities were restructured into the builds module.
- The CI board and bulk Commit were rolled back (commit-hash display for completed items is kept).
