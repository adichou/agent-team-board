# Changelog

[中文](./CHANGELOG.md) | [English](./CHANGELOG_en.md)

## 1.0.1 Release Module Patch

A patch release focused on simplifying the release flow and fixing defects, with 2 requirements and 4 bug fixes in total.

### Release Flow Simplified

- The release action is consolidated into "Check → Second Confirmation → Update Version Plan Status": main/dev are no longer pushed to the remote and the website repository is no longer built; after the second confirmation passes, the version plan is simply marked as "Released" (the release time is taken at the moment of confirmation; once released, the state is irreversible and the version plan becomes view-only). The release plan is reduced from 3 steps to 1, the release button is no longer disabled due to "website repository not configured", and projects in non-Web-App forms without package.json (such as Chrome extensions) can release normally; if source push and website updates are still needed, they are performed manually in the repository.
- Adapts to projects whose mainline is master: the main branch name is resolved from the project's actual state (main first, falling back to master when only master exists locally), and creating a release no longer fails with a `git rev-parse` error; behavior is unchanged for projects that have a main branch. Existing release run records (including old-phase data) are read and displayed as-is, without migration.

### Version Plans

- Completed entries with no linked commits can still be included in a version: such entries are no longer grayed out in the candidate panel, an inline hint reads "No linked commits (can still be included in the version)", and "Select All" no longer skips them; cherry-pick merge automatically skips their commit-merge step, and the version's linked-entry list and the release documents include the entry as usual, showing a "No linked commits" empty state.

### Bug Fixes

- After a version plan is released, both the list and the right-side detail consistently show a "Released" label instead of incorrectly showing "Merged"; modification entry points such as edit, delete, and merge for released versions are uniformly grayed out with the reason explained.
- Interface times are now displayed uniformly in the browser's local time zone instead of UTC.
- AI summarization prompts are generated according to the release plan's language set: single-language projects are no longer required to insert a language-switch line, while multi-language projects keep cross-linking across the language set.

## 1.0.0 First Baseline Release

The first official release, covering the complete pipeline from requirement registration to version release, with 199 requirements and 226 bug fixes merged in total.

### Requirements Board

Requirements and bugs are managed across their full lifecycle under six statuses: Pending Acceptance, Accepted, Planned, In Development, Pending Test, and Done. Creating an entry supports screenshot upload with double-click zoom and a one-step "Create and Accept"; both creation and deletion are synchronously committed to Git for the record. The list–detail split layout, tabbed detail views, and quick browsing between adjacent entries support search, sorting, pagination, bulk accept and move-to-plan, editing and deletion, and entry-ID copying; the Done list shows the most recent 100 entries by default, with older entries located via search. When an in-development entry hits a decision pending a human, the supplementary-decision entry point appears in the requirements list in real time; pending-test entries can be sent back to Planned by a human for re-queuing.

### AI Task Board

AI analysis automatically completes the description and acceptance criteria for accepted entries, producing an interactive demo when the UI is involved; up to 3 subagents can analyze in parallel, and once confirmed, entries can automatically move into the plan (manual by default).

AI development works through the planned queue entry by entry — claim, test-first, implement, report — and the system automatically commits each entry's changes to the dev branch for human acceptance. Blocked entries go to the pending manual confirmation area and resume once the human supplies the missing decision; when automatic commits have omissions or attribution questions, the entry is held pending confirmation, with a diff-comparison page to assist review. Project-level task management and a global task overview across projects are also provided.

### Release Board

The "Release" module advances in five steps: "Select Entries & Commits → Cherry-pick Merge → Documentation & Translation → Documentation Merge → Release". Checking an entry automatically links all commits that should be attributed to it; the selected commits are deduplicated by hash and merged into main in Git topology order, shared commits are merged only once, commits with no effect on the merge are clearly distinguished, and conflicts are reported with file-level detail. After features are merged, documentation is written based on the actually merged content: the default language is first summarized by AI and reviewed by a human file by file (optionally assisted by AI proofreading), other languages are reviewed file by file after AI translation, and commits are unlocked once all files pass; after documentation is separately merged into main, the results of the two manual actions — pushing to the remote and updating website materials — are each verified.

The "Overview" tab of a version plan supports AI refinement and in-place editing, and versions can be deleted; branch browsing provides a branch list, commit-tree visualization with search, plus remote sync and branch push.

### Command Board

The "Commands" tab: `atb` CLI commands are presented as buttons grouped by category — fill in parameters and run them right on the web page with the full output echoed back, a second confirmation for high-risk commands, and the whitelist delivered by the server; "Recent Runs" keeps the latest 10 entries deduplicated by command, and clicking one refills its parameters. Commands not covered by dedicated pages, such as `serve` and `rebuild`, can be used without a terminal.

[Back to README](./README_en.md) · [Features](./FEATURES_en.md) · [Design](./DESIGN_en.md)
