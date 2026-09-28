# AGENTS.md — Repository Rules for Developing This Product

[中文](./AGENTS.md) | [English](./AGENTS_en.md)

This file is aimed at the Agents and humans who develop the agent-team-board product itself in this repository. When using this product to manage tasks for **other projects**, the authoritative entry point is [skills/agent-team-board/SKILL.md](./skills/agent-team-board/SKILL.md) (this file does not duplicate its content); for the detailed boundary between the two scenarios, see "Dual Entry-Point Boundary" at the end of this file.

This document was consolidated under release plan BLD-20260927-001 (version 1.0.0, the first baseline version); what follows are the repository collaboration rules — release documents do not replace the task-management skill.

## Development Must Go Through the Board

1. **Register before changing**: Before changing any source code in this repository (scripts/, commands/, skills/, hooks/, plugin manifests, root documents), you must first register an entry via `/req` or `/bug` → a human "Accepts" it on the board → a human "Moves it into a plan" → claim it with `node scripts/atb.mjs claim <ID>` (claiming creates the claim lock). **Exception: first-level release documents at the plugin root** (REQ-20260918-002 root README.md; REQ-20260923-001 extension) — the four standard release documents at the root — `README.md` / `CHANGELOG.md` / `FEATURES.md` / `AGENTS.md` — and custom documents added from the release board's document-writing page (those listed in the version record `v.customDocs`, e.g. `MIGRATION.md`; language variants `<KEY>_<lang>.md` and `LICENSE.md` are not yet included) are pure documentation: users and Agents may update them directly without a claim lock and may commit, via Bash, changes that contain only these files and whose subject follows the "type: description ID" commit convention (carrying the entry ID).
2. **Source code is strictly protected**: Without a valid claim lock, the PreToolUse hook (hooks/hooks.json → scripts/state-guard.mjs) will deterministically block writes to source code (REQ-20260901-003). Do not attempt to bypass it; editing the board's user-data directory (entry markdown under agent-team-board/data/) is not restricted.
3. **Ironclad status rules**: Never write any entry status file directly (`agent-team-board/runtime/status/*.json`); never set an entry to accepted / planned / done (human-only); an Agent's routine status operations are only claim and report.

## TDD and Wrap-up

1. **Tests first**: Add `<prefix>-<lowercase-id>.test.mjs` under scripts/tests/ (run it red first), then implement until it goes green; before delivery, the full `npm test` run must pass.
2. **Wrap up with report**: When done, run `node scripts/atb.mjs report <ID> --summary "…"` — the system attributes changes against the workspace snapshot taken at claim time and automatically commits this entry's source-code, test, and entry-document changes to dev (commit only, no push); entry documents (README/design/test-cases/test-report.md etc. inside the entry directory — engineering records, user data) are committed with the wrap-up as a doc commit (`doc: <title> <ID>`), and board-level shared paths (migration moves, audit-trail check-outs, etc.) are still gathered in by the wrap-up; **first-level root documents** (root-directory `.md` files, including README/AGENTS/CHANGELOG/FEATURES/DESIGN and their language variants, LICENSE.md, etc.) are not committed by the wrap-up and do not trigger withholding (REQ-20260923-002) — their diffs stay in the working tree, to be handled by humans / the release-document workflow. **Do not git commit by hand for a development wrap-up** (wrap-up commits are made automatically by the system, not through Agent Bash), **do not push automatically**, **do not set the entry to done**; after reporting, use `atb show <ID> --json` and `atb commit log <ID>` to verify the pending-test status and the commit hashes (the commit hashes for source code, tests, and entry documents; root-directory document diffs stay in the working tree and follow the release-document workflow). The pass criteria for entry-document commits during document-discussion rounds are given in the table below (REQ-20260917-002).
3. **Use hold when blocked**: When implementation needs a human decision (scope / approach trade-offs / account or real-device operations, etc.), declare the list of questions with `atb hold declare` and hand over a blocked receipt; do not answer for the human or resume work on your own.

## Quality Baseline

- **Keep Chinese and English in sync**: UI copy is centralized in scripts/web/i18n.js (Chinese source text as keys: exact static EN / dynamic EN_DYNAMIC interpolation); any copy change must keep both languages in sync and run the i18n-related tests (BUG-20260912-001).
- **Open-source selection**: Follow REQ-20260909-015 — prefer reusing mature open-source libraries and bringing them in as dependencies (npm); copying library source code into this repository is forbidden; only licenses on the MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense whitelist may be used; when introducing one, maintain licenses.md in that entry's directory (library name / version / how introduced / License / repository URL).
- **Commit subjects**: Carry the entry ID; convention validation lives in scripts/lib/commit-store.mjs (automatic wrap-up commits are already generated accordingly).

## Testing and Interception Quick Reference

| Scenario | Command / Handling |
| ---- | ---- |
| Full test run | `npm test` (= `node scripts/tests/run-all.mjs`) |
| Single test | `node scripts/tests/<name>.test.mjs` |
| Blocked when writing an entry status file directly / setting a human-only status | Use atb subcommands instead; accepting / moving into a plan / confirming completion must be done by a human |
| Blocked when changing source code without a claim lock | Register first → a human accepts and moves it into a plan → claim with `atb claim` before changing anything; first-level root release documents (README / CHANGELOG / FEATURES / AGENTS and custom documents listed in `v.customDocs`) can be changed directly without a lock (REQ-20260918-002 / REQ-20260923-001) |
| git commit blocked in Bash | Development wrap-up: after `atb report` the system makes the wrap-up commit automatically (committing source code, tests, and entry documents; root-directory documents are not committed by the wrap-up and do not trigger withholding — REQ-20260923-002, they stay in the working tree under the release-document criteria below), so no manual commit is needed. Pass criteria for document-discussion rounds (REQ-20260917-002): a commit is allowed only when all three conditions hold at once — it contains only entry-directory user data under `agent-team-board/data/{requirements,bugs}/<entry-ID>/`, the command carries a pathspec, and the commit subject includes the entry ID (`doc: … REQ-/BUG-…`). Pass criteria for release documents (REQ-20260918-002 / REQ-20260923-001): every pathspec entry is an exempted first-level root release document and the subject line follows the "type: description ID" convention; bare commits without a pathspec, scopes covering source code / runtime application data / status.json, subjects without an entry ID, and forms that cannot be statically verified such as `--amend` are still blocked |

## Data and Release Collaboration

- Entry descriptions, designs, test cases, and reports are kept in `agent-team-board/data/` and managed with Git (entry creation and deletion are committed synchronously by the system to leave an audit trail — REQ-20260927-001 / REQ-20260923-004); status, locks, settings, confirmation records, and execution ledgers are kept in `agent-team-board/runtime/`, remain local only, and are not committed as release documents.
- When writing release materials, base them on the commits linked to the version plan and the actual code behind them. Requirement wording, features currently on the dev branch, or documentation commits alone cannot prove that a capability made it into the version; capabilities that were rolled back or whose entry points are hidden must be described according to their actual state.
- The release README links to the same-language CHANGELOG and FEATURES; AGENTS carries only the applicable collaboration rules. Completing the documents does not mean accepted, merged, or released; do not run pushes or deployments on your own initiative.
- Release documents proceed in two phases (REQ-20260921-012; as of BUG-20260926-002 there is no longer an overall review-completion confirmation): the default-language release documents (the four document types plus the version design document DESIGN.md) are first summarized by AI and then reviewed by a human file by file; the remaining languages are AI-translated and then reviewed file by file; the document-writing step is complete — and commits unlocked — only after every file in the language set has passed review.

## Document Map

- Product and runtime entry point: [README.md](./README_en.md); changes in this version: [CHANGELOG.md](./CHANGELOG_en.md); feature descriptions: [FEATURES.md](./FEATURES_en.md); design notes: [DESIGN.md](./DESIGN_en.md)
- Developing this product: this file + README.md
- Using this product to manage tasks (any project): skills/agent-team-board/SKILL.md (the single authority)
- Engineering records (user data, tracked in git): agent-team-board/data/; runtime application data (kept locally): agent-team-board/runtime/; batch-task details: skills/agent-team-board/batch-execution.md

## Dual Entry-Point Boundary

- This file contains only the action rules for "**developing this product**"; SKILL.md contains only the data conventions and ironclad process rules for "**using this product to manage tasks**". The two sides each govern their own domain and do not copy each other's content.
- When both scenarios apply at once (using this product in this repository to develop this product itself): read this file first for the hard process constraints and wrap-up rules, then consult skills/agent-team-board/SKILL.md for the specific commands and state-machine details.
