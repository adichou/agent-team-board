# AGENTS.en.md — Repo Rules for Developing This Product

This file is for Agents and humans **developing agent-team-board itself in this repository** (Chinese original: [AGENTS.md](./AGENTS.md)). When **managing tasks of other projects** with this product, the authoritative entry is skills/agent-team-board/SKILL.md (this file does not duplicate it); the boundary between the two scenarios is at the end ("Dual-Entry Boundary").

## Development Must Go Through the Board

1. **Register before changing**: before changing any source in this repository (scripts/, commands/, skills/, hooks/, plugin manifests, root docs), first register an item via `/req` or `/bug` → a human "Accepts" it on the board → a human "Moves it to plan" → `node scripts/atb.mjs claim <ID>` (claiming creates the claim lock). **Exception: the root `README.md`** (REQ-20260918-002) — it is pure documentation; users and Agents may update it directly without a claim lock and may commit changes containing only that file via Bash, with an item ID in a subject conforming to the "type: description ID" convention.
2. **Source is hard-protected**: without a valid claim lock, the PreToolUse hook (hooks/hooks.json → scripts/state-guard.mjs) deterministically blocks writes to source (REQ-20260901-003). Do not attempt to bypass it; editing markdown in the board user-data directory (agent-team-board/data/) is unrestricted.
3. **State iron rules**: never write any item status file directly (`agent-team-board/runtime/status/*.json`); never set an item to accepted / planned / done (human-only); the only routine state operations for Agents are claim and report.

## TDD and Closeout

1. **Tests first**: add `<prefix>-<item-id-lowercase>.test.mjs` under scripts/tests/ (run it red first), then implement to green; before delivery the full `npm test` must pass.
2. **Closeout via report**: when done, run `node scripts/atb.mjs report <ID> --summary "…"` — the system attributes changes against the workspace snapshot taken at claim time and auto-commits this item's changes to dev (commit only, no push). **Do not git commit manually at development closeout** (the closeout commit is made automatically by the system, not via Agent Bash), **do not push automatically**, and **do not set the item to done**; after reporting, verify the pending-test state and commit hash with `atb show <ID> --json` and `atb commit log <ID>`. The allowance for item-doc commits during doc discussion rounds is in the table below (REQ-20260917-002).
3. **Blocked? Use hold**: when a human decision is required mid-implementation (scope / trade-offs / account or real-device operations), declare the question list with `atb hold declare` and submit a blocked receipt; never answer or resume on the human's behalf.

## Quality Baselines

- **Chinese/English sync**: UI copy is centralized in scripts/web/i18n.js (Chinese source strings as keys: static exact EN / dynamic EN_DYNAMIC interpolation); any copy change must update both languages and run the i18n-related tests (BUG-20260912-001).
- **Release-doc bilingual sync**: the root README / CHANGELOG / FEATURES / AGENTS are Chinese/English document pairs (.en.md mirrors with one-to-one sections); changing one requires syncing the other (same rule as the bilingual README, REQ-20260918-001).
- **Open-source selection**: follow REQ-20260909-015 — prefer reusing mature open-source libraries introduced as dependencies (npm); never copy library source into the repository; licenses are limited to the MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense whitelist; when introducing one, maintain licenses.md in that item's directory (library / version / how introduced / license / repo URL).
- **Commit subjects**: include the item ID; validation lives in scripts/lib/commit-store.mjs (automatic closeout commits are already generated accordingly).

## Tests and Interception Quick Reference

| Scenario | Command / handling |
| -------- | ------------------ |
| Full test run | `npm test` (= `node scripts/tests/run-all.mjs`) |
| Single test | `node scripts/tests/<name>.test.mjs` |
| Blocked writing item status files / setting human-only states | Use atb subcommands instead; accept / plan / confirm-done are human operations |
| Blocked editing source without a claim lock | Register first → human accepts and moves to plan → `atb claim`, then change |
| git commit blocked in Bash | Development closeout: after `atb report` the system auto-commits; no manual commit needed. Doc-discussion-round allowance (REQ-20260917-002): allowed only when all three hold — the commit contains only item-directory user data (`agent-team-board/data/{requirements,bugs}/<item ID>/`), the command carries a pathspec, and the subject contains the item ID (`doc: … REQ-/BUG-…`); bare commits without pathspec, scopes containing source / runtime app data / status.json, subjects without an ID, and non-statically-verifiable forms such as `--amend` remain blocked |

## Document Map

- Project positioning, directory and module map, environment and run commands: README.md (Chinese) / README.en.md (English), sections one-to-one
- Version changes: CHANGELOG.md / CHANGELOG.en.md; feature list: FEATURES.md / FEATURES.en.md (version scope follows the builds module version plans, BLD)
- Developing this product: this file (English) / AGENTS.md (Chinese) + README.md
- Managing tasks of any project with this product: skills/agent-team-board/SKILL.md (sole authority)
- Engineering tickets (user data, in git): agent-team-board/data/; runtime app data (local only): agent-team-board/runtime/; batch-task details: skills/agent-team-board/batch-execution.md

## Dual-Entry Boundary

- This file only contains action rules for **developing this product**; SKILL.md only contains data norms and process iron rules for **managing tasks with this product**. Each governs its own domain and neither duplicates the other.
- When both scenarios apply at once (developing this product in this repository with the product itself): read this file first for hard workflow constraints and closeout rules, then consult skills/agent-team-board/SKILL.md for concrete commands and state-machine details.
