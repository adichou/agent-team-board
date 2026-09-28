# Features

[中文](./FEATURES.md) | [English](./FEATURES_en.md)

Applicable version: 1.0.0 (first baseline version)

## Requirements and Bugs

In the Requirements module, you register issues, fill in descriptions and acceptance criteria, and can attach screenshots; "Create and Accept" does it all in one step. Entry creation and deletion are both committed to Git for traceability. After a person accepts an entry and moves it into the plan, an Agent claims and implements it; once reported, the entry shows as pending test and is completed through manual acceptance, and a pending-test entry can also be sent back to planned to requeue. Lists support search, sorting, and batch operations where the status allows; the completed list shows the 100 most recent entries by default, and earlier entries can be located through search. When an in-development entry needs a human decision, a supplementary decision entry appears in real time as the board polls.

In the detail view, you can read the description, design, test cases, and reports, switch between adjacent entries, and copy the entry number. Bugs are registered separately; when fixing one, the introduction source is recorded in the description and design for easy traceability.

## AI Analysis and AI Development

AI Analysis completes the description and acceptance criteria for accepted entries and, when UI is involved, generates an interactive interface demo; up to 3 subagents can analyze in parallel. AI Development picks entries from the planned queue and performs claiming, testing, implementation, and reporting. On the requirements page, the "▶ AI Analysis" and "▶ AI Development" buttons copy the main orchestration prompt with one click—paste it directly into your project's Agent session to start; the board provides execution records and task control entries.

When a human decision is needed, questions enter the pending manual confirmation area, where a person supplies the decision and resumes the work; after the AI analysis confirmation, the run continues and the continuation prompt is copied automatically. If automatic commits have omissions or attribution doubts, you can review the differences and complete the confirmation. The global task view aggregates active tasks across projects; the task ledger is stored on this machine.

Automatic commits made after development completes go only to the local dev branch; they do not amount to manual acceptance, and nothing is pushed to the remote automatically. The standalone "Batch Commit" entry has been rolled back.

## Version Release

In the Release module, you create a version plan and select completed requirements or bugs; checking an entry automatically associates all commits that belong to it, with a many-to-many relationship between entries and commits. Version numbers follow the x.y.z format and are assigned by you. The detail Overview tab supports AI refinement of version information with in-place editing, and versions no longer in use can be deleted.

A release advances in five steps: select entries and commits → cherry-pick and merge → documentation and translation → documentation merge → release.

- Cherry-pick and merge: the selected commits are deduplicated by hash and merged into main in Git history order; a commit associated with multiple entries is merged only once. Commits that would have no effect on main are clearly marked; on conflicts, the specific files and reasons are shown, and you can continue once they are resolved.
- Documentation and translation: after the features are merged, documents are written based on what was actually merged into this version. The default-language documents (the four types README, CHANGELOG, FEATURES, and AGENTS, plus multiple custom documents added as needed) go through AI summarization → manual file-by-file review (optionally assisted by AI proofreading for typos and wording) → AI translation into the remaining languages of the language set → manual file-by-file review; when the default language is modified, the corresponding translations automatically return to pending translation. Commits are unlocked once every file has passed review.
- Documentation merge: the approved release documents are committed separately and merged into main, and the merge is recorded in the version plan.
- Release: pushing remote main and updating the website materials are two manual actions, each showing its result and failure reason; a local merge does not mean the remote has been released.

The "Branch Browse" tab shows branch lists and commit records; the commit history is visualized as a tree and supports search, and you can sync the remote and push branches.

## Command Execution

The Commands module presents `atb` CLI commands as buttons grouped by data & distribution, entry lifecycle, batch development, execution receipts, human decisions, and more: pick a command, fill in the parameters as prompted, preview the full command, and execute it—output, exit code, and duration are displayed right away. High-risk commands require a second confirmation before running; side-effect commands such as `serve` come with an impact note. Recent executions keeps 10 entries deduplicated by command; click one to refill the parameters and rerun quickly. Commands are delivered through a server-side whitelist and apply only to projects on this machine.

## Multi-Project Management

One local service manages multiple projects: you can add, switch, and remove projects, and nonexistent directories are detected. The board is used mainly through the browser (port 8888 by default); it supports Chinese and English interfaces, keyboard shortcuts, and view restoration after refresh.

## Files and Data

Entry documents live in `agent-team-board/data/` and are managed with the project's Git.

Status, configuration, and execution ledgers live in `agent-team-board/runtime/`. The data stays local.

[Back to README](./README_en.md) · [Changelog](./CHANGELOG_en.md) · [Design document](./DESIGN_en.md)
