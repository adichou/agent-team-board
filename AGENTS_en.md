# AGENTS.md — Repository Rules for Developing This Product

This file is for Agents and humans who develop the agent-team-board product itself in this repository. When using this product to manage tasks in **other projects**, the authoritative entry point is [skills/agent-team-board/SKILL.md](./skills/agent-team-board/SKILL.md) (this file does not duplicate its contents); see "Dual-Entry Boundary" at the end of this document for the detailed boundary between the two scenarios.

This document is organized under release plan BLD-20260921-001 (version 20260921-001, the full-feature baseline release); what follows are the repository collaboration rules, and release documentation does not replace the task-management skill.

## Development Must Go Through the Board

1. **Register before changing**: Before changing any source code in this repository (scripts/, commands/, skills/, hooks/, the plugin manifest, root documents), you must first register an item with `/req` or `/bug` → a human accepts it on the board → a human moves it into the plan → claim it with `node scripts/atb.mjs claim <ID>` (claiming creates the claim lock). **Exception: first-level release documents at the plugin root** (REQ-20260918-002 root README.md; extended by REQ-20260923-001) — the four standard release documents at the root, `README.md` / `CHANGELOG.md` / `FEATURES.md` / `AGENTS.md`, plus custom documents added on the release board's document authoring page (those in the version record's `v.customDocs` list, such as `MIGRATION.md`; language variants `<KEY>_<lang>.md` and `LICENSE.md` are not included for now), are all pure documents: users and Agents may update them directly without a claim lock, and may commit via Bash changes containing only these files whose subject conforms to the "type: description ticket-number" commit convention (with the item ID).
2. **Source code is hard-protected**: Without a valid claim lock, the PreToolUse hook (hooks/hooks.json → scripts/state-guard.mjs) deterministically blocks writes to source code (REQ-20260901-003). Do not attempt to bypass it; editing the board's user-data directory (item markdown under agent-team-board/data/) is not restricted.
3. **Status iron rule**: Never write any item status file directly (`agent-team-board/runtime/status/*.json`); never set an item to accepted / planned / done (humans only); the Agent's routine status operations are only claim and report.

## TDD and Close-Out

1. **Tests first**: Add `<前缀>-<单号小写>.test.mjs` under scripts/tests/ (red first), then make it green after implementing; the full `npm test` run must pass before delivery.
2. **Close out with report**: When done, run `node scripts/atb.mjs report <ID> --summary "…"` — the system attributes changes against the workspace snapshot taken at claim time and automatically commits this ticket's source, test, and item-document changes to dev (commit only, no push); item documents (README/design/test-cases/test-report.md etc. inside the item directory — engineering tickets, user data) are committed with the close-out doc group (`doc: <标题> <单号>`), and board-level shared paths (migration relocations, trace-recorded outbound moves, etc.) are still gathered in at close-out; **first-level root documents** (root-directory `.md` files, including README/AGENTS/CHANGELOG/FEATURES/DESIGN and language variants, LICENSE.md, etc.) are not committed at close-out and do not trigger the hold-back (REQ-20260923-002) — their diffs remain in the working tree, to be handled by humans / the release-documentation process. **Do not hand-run git commit for development close-out** (the close-out commit is made automatically by the system, not through Agent Bash), **do not auto-push**, and **do not set the item to done**; after report, use `atb show <ID> --json` and `atb commit log <ID>` to verify the to-be-tested status and the commit hashes (commit hashes of source, tests, and item documents; root-document diffs stay in the working tree and go through the release-documentation process). The pass-through criteria for item-document commits in documentation discussion rounds are given in the table below (REQ-20260917-002).
3. **Blocked goes through hold**: When implementation requires a human decision (scope / approach trade-offs / account or real-device operations, etc.), declare the issue list with `atb hold declare` and hand over the blocked receipt; do not answer on the human's behalf or resume work yourself.

## Quality Baseline

- **Chinese–English sync**: UI copy is centralized in scripts/web/i18n.js (the Chinese source text serves as the key: static exact EN / dynamic EN_DYNAMIC interpolation); any copy change must be synced across both languages and must run the i18n-related tests (BUG-20260912-001).
- **Open-source selection**: Follow REQ-20260909-015 — prefer reusing mature open-source libraries and bringing them in as dependencies (npm); copying library source into the repository is forbidden. Licenses are limited to the MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense whitelist. When introducing a library, maintain licenses.md in that item's directory (library name / version / how it is introduced / License / repository URL).
- **Commit subjects**: Include the item ID; convention validation lives in scripts/lib/commit-store.mjs (automatic close-out commits are already generated this way).

## Tests and Interception Quick Reference

| Scenario | Command / Handling |
| ---- | ---- |
| Full test run | `npm test` (= `node scripts/tests/run-all.mjs`) |
| Single test | `node scripts/tests/<name>.test.mjs` |
| Writing item status files directly / setting human-only statuses gets blocked | Use atb subcommands instead; accepting / moving into plan / confirming completion must be done by a human |
| Editing source code without a claim lock gets blocked | Register first → human accepts and moves it into the plan → claim with `atb claim`, then edit; first-level root release documents (README / CHANGELOG / FEATURES / AGENTS and custom documents in the `v.customDocs` list) can be edited directly without a lock (REQ-20260918-002 / REQ-20260923-001) |
| git commit in Bash gets blocked | Development close-out: after `atb report`, the system makes the close-out commit automatically (it commits source, tests, and item documents; root-directory documents are not committed at close-out and do not trigger the hold-back — REQ-20260923-002 — and remain in the working tree under the release-documentation criteria below), so no manual commit is needed. Documentation-discussion-round pass-through criteria (REQ-20260917-002): a commit is let through only when all three conditions hold at once — it contains only `agent-team-board/data/{requirements,bugs}/<条目ID>/` item-directory user data, the command carries a pathspec, and the commit subject contains the item ID (`doc: … REQ-/BUG-…`). Release-documentation pass-through criteria (REQ-20260918-002 / REQ-20260923-001): the pathspec consists entirely of exempt first-level root release documents, and the subject line conforms to "type: description ticket-number". Bare commits without a pathspec, scopes containing source code / runtime application data / status.json, subjects without a ticket number, `--amend`, and other forms that cannot be statically verified are still blocked. |

## Data and Release Collaboration

- Item descriptions, designs, test cases, and reports are stored in `agent-team-board/data/` and managed with Git; statuses, locks, settings, confirmation traces, and the execution ledger are stored in `agent-team-board/runtime/`, kept locally only, and are not committed as release documentation.
- When writing release material, base statements on the commits associated with the version plan and their actual code. Requirement wording, features on the current dev branch, and the documentation commits themselves do not by themselves prove that a feature has entered that version; capabilities that have been reverted or whose entry points are hidden must be described according to their actual state.
- The release README links to the same-language CHANGELOG and FEATURES; AGENTS covers only the applicable collaboration rules. Completing the documentation does not mean the work has been accepted, merged, or released; do not push or deploy on your own initiative.
- Release documentation proceeds in two stages (REQ-20260921-012; starting from BUG-20260926-002, no overall review-completion confirmation is set): the default-language release documents (the four document types plus the version design document DESIGN.md) are first AI-summarized and then human-reviewed file by file; the other languages are AI-translated and then reviewed file by file; only after all files within the language set pass review does the documentation-authoring step conclude and the commit unlock.

## Document Map

- Product and operation entry point: [README.md](./README_en.md); changes in this version: [CHANGELOG.md](./CHANGELOG_en.md); feature descriptions: [FEATURES.md](./FEATURES_en.md); design notes: [DESIGN.md](./DESIGN_en.md)
- Developing this product: this file + README.md
- Using this product to manage tasks (any project): skills/agent-team-board/SKILL.md (the sole authority)
- Engineering tickets (user data, tracked in git): agent-team-board/data/; runtime application data (kept locally): agent-team-board/runtime/; batch task details: skills/agent-team-board/batch-execution.md

## Dual-Entry Boundary

- This file covers only the rules of action for "**developing this product**"; SKILL.md covers only the data conventions and process iron rules for "**using this product to manage tasks**". Each governs its own domain; neither duplicates the other's content.
- When both scenarios apply at once (using this product, in this repository, to develop this product): read this file first to learn the hard process constraints and close-out rules; for concrete commands and state-machine details, consult skills/agent-team-board/SKILL.md.
