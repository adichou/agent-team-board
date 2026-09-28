# Changelog

[中文](./CHANGELOG.md) | [English](./CHANGELOG_en.md)

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
