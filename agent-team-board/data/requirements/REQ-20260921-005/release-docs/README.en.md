[中文](./README.md) | English

# Agent Team Board

A ZCode plugin: file-based requirement / bug management + an Agent TDD development workflow + a local web status board (Status Board).

This repository is the plugin source repo (development branch `dev`, release trunk `main`): the plugin is loaded by cloning it into the ZCode plugin cache (the remote of the cached copy is this repo's GitHub URL). End-user installation guides and usage docs are planned for the official website (see "Website / User Docs / Support"; not yet launched).

> Before developing this product, Agents must read the root [AGENTS.md](./AGENTS.md) (hard workflow constraints and closeout rules, in Chinese; English mirror at [AGENTS.en.md](./AGENTS.en.md)); to manage tasks of other projects with this product, read [skills/agent-team-board/SKILL.md](skills/agent-team-board/SKILL.md).

## Docs and Versions

- Current version: **20260920-001 Full-Feature Baseline: Requirements Board · AI Analysis & Development · Version Release** (version plan BLD-20260920-001, 2026-09-20).
- Version history: [CHANGELOG.en.md](./CHANGELOG.en.md); feature list: [FEATURES.en.md](./FEATURES.en.md); development collaboration rules: [AGENTS.en.md](./AGENTS.en.md).
- Chinese mirrors: [README.md](./README.md) / [CHANGELOG.md](./CHANGELOG.md) / [FEATURES.md](./FEATURES.md) / [AGENTS.md](./AGENTS.md).

## Three-Board Collaboration System

| Board | Carrier | This plugin's responsibility |
| ----- | ------- | ---------------------------- |
| Project Board | ZCode built-in project/session list | No UI changes; relies on "files as the source of truth" + skill dispatch rules |
| Discussion Board | Chat window + commands | Four commands `/req` `/bug` `/dev` `/board` (commands/) + skill behavior rules |
| Status Board | Local web page served by the plugin | Zero-dependency Node http service (scripts/server.mjs, default port 8888), one service for multiple projects |

### State Machine and Human/Agent Division of Labor

States flow one way; **accepted / planned / done are human-only**, enforced deterministically by a PreToolUse hook that blocks Agent overreach (scripts/state-guard.mjs):

```
submitted ──human──▶ accepted ──human──▶ planned ──Agent claim──▶ in-progress ──human──▶ done
   ▲                                    │                          │
   └──────────────── no such path ──────┼──────────────────────────┘
                                        │            done ──human reject──▶ in-progress
                                        └──human un-plan──▶ accepted (rollback edge)
```

After claiming, the development report (`atb report`) marks the item as "pending test"; when blocked, the Agent can declare "pending human decision" (the item stays in-progress and resumes after the human answers).

| Operation | Agent | Human |
| --------- | ----- | ----- |
| Create requirement / bug (→ submitted) | ✅ `/req` `/bug` | ✅ board form |
| Accept (→ accepted) | ⛔ blocked by hook | ✅ board / terminal |
| Plan / un-plan (accepted ↔ planned) | ⛔ blocked by hook | ✅ board |
| Claim (→ in-progress, atomic lock) | ✅ `atb claim` | — |
| Report test results (shows "pending test") | ✅ `atb report` | view |
| Closeout commit (auto commit to dev after report) | system | — |
| Confirm done (→ done) / reject done | ⛔ blocked by hook | ✅ board / terminal |
| Answer pending-human-decision / resume | ⛔ blocked by hook | ✅ board "pending human confirmation" |

Human entry points: Status Board buttons, or the terminal `node scripts/atb.mjs status <ID> accepted|done`; `node scripts/atb.mjs cli install` installs the `atb` short command (bin/atb).

## Directory and Module Responsibilities

```
agent-team-board/
├── .zcode-plugin/plugin.json     # ZCode manifest (displayName: Agent Team Board)
├── .codex-plugin/plugin.json     # Codex-compatible manifest (skills only; Codex has no commands/hooks)
├── AGENTS.md                     # Repo rules for developing this product (required reading for Agents, in Chinese)
├── AGENTS.en.md                  # English mirror of the repo rules
├── README.md                     # Project entry and module map (Chinese; switch to English at the top)
├── README.en.md                  # English mirror of the README (sections map one-to-one to the Chinese version)
├── CHANGELOG.md / CHANGELOG.en.md   # Release changelog (Chinese/English pair, version-level summary)
├── FEATURES.md / FEATURES.en.md     # Version feature list (Chinese/English pair)
├── index.html                    # Repo-root product landing page: self-contained single-file intro (Status Board quick start and Electron notes, REQ-20260916-002); distinct from scripts/web/index.html (board frontend shell)
├── skills/agent-team-board/SKILL.md   # Behavior rules for "managing tasks with this product"
├── commands/{req,bug,dev,board}.md    # Four slash-command prompts
├── hooks/hooks.json              # PreToolUse state guard (Edit|Write / Bash → scripts/state-guard.mjs)
├── hooks/codex.json              # Codex-side hook config
├── bin/atb                       # Terminal command wrapper (cli install symlinks it into PATH)
├── electron/                     # Desktop shell: main.mjs main process / service.mjs server child process / shell-css.mjs shell styles
├── scripts/
│   ├── atb.mjs                   # CLI entry
│   ├── server.mjs                # Status Board service (default 8888, ATB_PORT override)
│   ├── state-guard.mjs           # Hook script (state guard + claim-lock source guard)
│   ├── lib/                      # Data layer and business modules (see table below)
│   ├── web/                      # Board frontend (single page, multiple views; see table below)
│   └── tests/                    # Tests: run-all.mjs aggregate entry + *.test.mjs cases
├── agent-team-board/
│   ├── data/                     # Board user data (in git): requirements/, bugs/ item docs (README/design/test-cases/test-report/licenses/ui-demo/attachments/decisions)
│   └── runtime/                  # Board app data (not in git, local only): status/ item states, config.json counters, .locks/, dispatch/, refine/, commits/, holds/, confirms/, builds/, releases/, tasks/, marketing/, oncall/, discussions/, etc.
└── output/                       # Brand assets (logo, etc.)
```

### scripts/lib Module Groups

| Group | Modules | Responsibility |
| ----- | ------- | -------------- |
| Core data layer | core.mjs | State machine, IDs, O_EXCL atomic claim locks; the shared source-of-truth access layer for CLI and server |
| | git-flow.mjs, manual-closeout.mjs, commit-store.mjs | dev branch workflow; automatic closeout commits per claim snapshot after report; commit subject validation and commit index (confirm-done no longer triggers management-record commits, dropped in BUG-20260918-002) |
| Batch and dispatch | batch.mjs, dispatch-store.mjs, dispatch.mjs, scheduler.mjs, execution-verifier.mjs | Batch development batches and execution ledger, run ledger, pure dispatch construction, Codex background auto-dispatch scheduling, completion evidence verification |
| | codex-adapter.mjs, codex-preflight.mjs, codex-model-config.mjs, task-settings.mjs | codex exec process adapter, pre-dispatch static checks, model/reasoning-tier config parsing, task-type × Agent four-way sub-agent config |
| | refine-store.mjs, refine-states.mjs, hold-store.mjs, hold-states.mjs, confirm-store.mjs, confirm-states.mjs | Batch refine three-state index; pending-human-decision three-phase loop; auto-commit incomplete / AI-analysis pending confirmation |
| Build modules | build-store.mjs, build-git.mjs | BLD version source of truth and version state machine (draft→merging→merged/failed); restricted git operations (branch browse / sync / merge into main) |
| | build-publish.mjs, build-publish-store.mjs, build-publish-api.mjs | Build publish executor and its independent source of truth (decoupled from the old release modules since BUG-20260916-001) |
| Release modules | release-store.mjs, release-git.mjs, release-apple.mjs, release-electron.mjs | REL release run source of truth; Git remote seven-stage / Apple App Store eight-stage / Electron desktop five-stage pipelines |
| | product-release-pipeline.mjs, product-release-store.mjs, product-release-git.mjs, site-materials.mjs, site-lang.mjs, webapp-profile.mjs | PREL product release six stages (source sync → site build → verify → materials → deploy → re-verify); site bilingual materials, language selection, web app detection and local deployment |
| Other business | marketing-store.mjs, growth-store.mjs, oncall-store.mjs, req-disc-store.mjs, legacy-recovery.mjs | Marketing profiles and pricing versions, growth workflows, open discussions, requirement-doc referenced discussions, historical run evidence archive |
| | migrate-layout.mjs, plugin-pack.mjs | One-shot legacy data layout migration (`atb migrate`: docs/agent-team-board/ → agent-team-board/{data,runtime}, CLI and board settings page entries); plugin distribution packaging (`atb pack`: whole-repo copy excluding board data / desktop build chain, with output self-verification, REQ-20260916-007) |

### scripts/web UI

| File | Responsibility |
| ---- | -------------- |
| index.html, app.js | Board shell: 2-second polling of /api/board; top tabs Requirements (status) / Builds (build) / Tasks (runs) / Settings (settings); Releases (release) / Marketing (marketing) / Discussions (oncall) / Files (files) are deep-link views |
| build.js, release.js, marketing.js, oncall.js, req-disc.js | UI modules for builds, releases, marketing, open discussions, requirement-doc referenced discussions |
| i18n.js | Chinese/English i18n: centralized dictionary (Chinese source strings as keys) + runtime DOM translation layer |
| banner.js, splitter.js, diff-view.js | File Board banner layer-stack state machine (pure functions), pane splitter, file diff view |
| style.css, wunderbaum.css, highlight-github.min.css, highlight-github-dark.min.css, marked.min.js, highlight.min.js, wunderbaum.umd.min.js, etc. | UI styles, tree-grid and code-highlight assets + vendored third-party libraries (introduction and updates logged per REQ-20260909-015 in the licenses.md of the corresponding item) |

## Environment and How to Run

All commands below were verified in this repo (2026-09-19, Node v17.8.0):

- **Node**: zero npm runtime dependencies (dependencies empty; devDependencies only electron / electron-builder); the repo declares no engines floor, and the current verified development environment is Node v17.8.0.
- **Tests**: `npm test` (= `node scripts/tests/run-all.mjs`) runs every `*.test.mjs` under scripts/tests/ sequentially (currently 278 test files, verified 2026-09-19); any failure exits non-zero; run a single file via `node scripts/tests/<name>.test.mjs`.
- **Product landing page**: open the repo-root `index.html` directly in a browser — a self-contained single-file product intro (REQ-20260916-002, with Status Board quick start and Electron desktop notes); it is a different file from `scripts/web/index.html` (the board frontend shell served by server.mjs), do not confuse them.
- **Status Board**: `node scripts/server.mjs` (default port 8888, overridden by the ATB_PORT env var; one service for multiple projects, `?project=<absolute project root>` switches the data source). The desktop shell `npm run app` starts the same service automatically.
- **Desktop shell**: `npm run app` (`electron .`, main process electron/main.mjs starts the server as a child process and loads the board page); packaging via `npm run dist` (electron-builder, macOS dmg / Windows nsis, artifacts in dist/).
- **CLI**: `node scripts/atb.mjs <subcommand>`; `node scripts/atb.mjs cli install` symlinks bin/atb into PATH so you can run `atb …` directly in the terminal.
- **Plugin packaging**: `node scripts/atb.mjs pack <output dir>` produces the distribution artifact (excludes agent-team-board/ board data, root AGENTS.md, node_modules/, electron/, output/; skills ship in full, REQ-20260916-007).

## Key Mechanism Index

- **Claim locks and source guard**: core.mjs implements claiming with O_EXCL atomic locks (runtime/.locks/, 24-hour expiry) and per-project implementation mutual exclusion; two PreToolUse guards in hooks/hooks.json → state-guard.mjs: block direct writes to runtime/status item states, block human-only status transitions, and block edits to plugin source without a valid claim lock (REQ-20260901-003). The root `README.md` is exempt (REQ-20260918-002): users and Agents may update it without a claim lock and may commit changes containing only that file via Bash with an item ID in a conforming subject.
- **Automatic closeout commit after report**: after `atb report`, git-flow.mjs + manual-closeout.mjs attribute changes against the workspace snapshot taken at claim time and auto-commit this item's code / tests / docs to dev (commit only, no push); batch run receipts follow the same rule (REQ-20260911-009, BUG-20260915-007).
- **Batch tasks**: batch development (pick items from the planned queue, one sub-Agent per round dispatched by the main session; the worker spec lives at skills/agent-team-board/worker-spec.md and is snapshotted into agent-team-board/runtime/dispatch/ when a batch is created), batch refine (docs for accepted items), pending-human-decision (hold) and pending-confirmation (confirm) loops; overview at skills/agent-team-board/batch-execution.md.
- **Build versions and release pipelines**: the build module manages BLD versions (build-store.mjs version state machine, build-git.mjs merges into main); build publishing runs independently (build-publish.mjs et al., BUG-20260916-001), with the website target adapted to the new Vite + Vue architecture (REQ-20260916-004) — `src/data/apps.js` product registration and bilingual paired material precheck under `content/<product id>/` (productIds override mapping configurable in settings), site-deploy runs `npm install` + `npm run build` in the website repo (artifacts from dist/), site-verify serves the static output locally and checks SPA fallback and zh/en mirror routes, and the sub-path base is resolved from the website's vite config; release modules provide three REL pipelines (release-git.mjs / release-apple.mjs / release-electron.mjs); product release PREL has six stages connecting source and website (product-release-pipeline.mjs + site-materials.mjs / site-lang.mjs / webapp-profile.mjs).
- **Chinese/English resources**: UI copy is centralized in scripts/web/i18n.js (Chinese source strings as keys, static exact EN + dynamic EN_DYNAMIC interpolation); any copy change must update both languages (BUG-20260912-001).

## Website / User Docs / Support

Per the REQ-20260915-001 four-repo layout, the official website, installation and user docs, FAQ, public changelog and support entry are planned in the website repo app-homepage-repo (reusing the myblog site architecture: Vite + Vue, GitHub Pages sub-path deployment). The in-repo [CHANGELOG.en.md](./CHANGELOG.en.md) / [FEATURES.en.md](./FEATURES.en.md) are the version-level source of truth, to be synced by the public pages once the website launches.

**Not yet deployed as of 2026-09-16**: this section only registers the pending-launch status and provides no unverified links; after launch the website URL, user docs entry and support entry will be filled in and verified one by one. Private operations materials (positioning, research, promotion) live in a separate private repo and never enter this repo.

## Navigate by Task Type

| What to change | Where to look |
| -------------- | ------------- |
| CLI / state machine / data layer | scripts/atb.mjs, scripts/lib/core.mjs and the corresponding *-store.mjs; tests in scripts/tests/ |
| Board UI | scripts/web/ (shell app.js; module pages build.js / release.js / marketing.js / oncall.js; copy changes go to i18n.js and must update both languages) |
| Batch tasks and dispatch | scripts/lib/batch.mjs, dispatch-store.mjs, scheduler.mjs, codex-adapter.mjs, etc.; specs at skills/agent-team-board/batch-execution.md and worker-spec.md |
| Build and release | scripts/lib/build-*.mjs (builds), release-*.mjs (REL pipelines), product-release-*.mjs (product release); UI build.js / release.js |
| Desktop shell | electron/ |
| Hooks and guards | hooks/hooks.json, scripts/state-guard.mjs |
| Project entry docs (bilingual) | Root README.md (Chinese) and README.en.md (English), cross-linked at the top with one-to-one sections; changing one requires syncing the other |
| Release docs (Chinese/English pairs) | Root CHANGELOG.md / CHANGELOG.en.md (version changes) and FEATURES.md / FEATURES.en.md (feature list); version scope follows the builds module version plans (BLD); changing one requires syncing the other |
| Development process and rules | Root AGENTS.md (required before developing this product) → skills/agent-team-board/SKILL.md (managing tasks with the product) → commands/ |

## Usage and Initialization (Developer View)

To onboard a new project onto the board: run `node scripts/atb.mjs init` in any session of the project (or click "Initialize" on the board page), which generates the `agent-team-board/` source-of-truth directory (`data/` user data in git, `runtime/` app data kept local; structure documented in agent-team-board/runtime/README.md and the data spec section of skills/agent-team-board/SKILL.md). Projects on the legacy layout (docs/agent-team-board/) migrate in one shot via `atb migrate` or the board settings page "data layout migration". For daily `/req` `/bug` `/dev` `/board` usage and state machine details see skills/agent-team-board/SKILL.md; human operations (accept / plan / confirm done) are available from the Status Board or the `atb status` command.
