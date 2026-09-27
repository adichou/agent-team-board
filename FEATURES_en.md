# Features

Applicable version: 1.0.0 (full-feature baseline version)

## Requirements and Bugs

Register issues in the "Requirements" module, fill in the description and acceptance criteria, and attach screenshots. After manual acceptance, items are scheduled into the plan and claimed by Agents for implementation; once reported, they show as pending testing and are completed through manual acceptance. The list supports search, sorting, and batch operations in applicable states; the completed list shows the most recent 100 items by default, and earlier entries can be located via search. When an item in development needs a manual decision, the decision-supplement entry appears in real time as the board polls.

In the details view, you can read the description, design, test cases, and report, switch between adjacent items, copy the item ID, and generate discussion prompts from document content. Bugs are registered independently; when fixing, the introducing source is recorded in the description and design for traceability.

## AI Analysis and AI Development

"AI Analysis" completes the description and acceptance criteria for accepted items, and generates an interactive UI demo when UI is involved. "AI Development" takes items from the planned queue and performs claiming, testing, implementation, and reporting. On the requirements page, the "▶ AI Analysis" and "▶ AI Development" buttons copy the main orchestration prompt on click; paste it directly into a project's Agent session to start, and the board provides execution records and task control entries.

When a manual decision is needed, the issue enters the pending-manual-confirmation area, a human supplements the decision and work resumes; once AI Analysis is confirmed, it enters a continuation run and the continuation prompt is copied automatically. When an automatic commit has omissions or attribution doubts, you can review the diff and complete the confirmation. A global task view aggregates active tasks across projects; the task ledger is kept on this machine.

The automatic commit after development goes only to the local dev branch; it is not manual acceptance, and nothing is pushed to the remote automatically. The standalone "Batch Commit" entry has been rolled back.

## Version Release

Create a release plan in the "Release" module, linking completed requirements or bugs and their commits. Version numbers are assigned by yourself in the x.y.z format. The "Overview" tab in the details supports refining version information with AI and editing it in place.

A release proceeds through five steps: version plan → link items and commits → selective merge into main → documentation → merge documentation into main → official release.

- Merging preserves history and is performed in an isolated worktree, while the working directory stays on the dev branch.
- Documentation proceeds in these stages: AI summarizes the default-language documents (README, CHANGELOG, FEATURES, and AGENTS — the four standard types; more custom documents can be added as needed) → manual second-pass editing, done quickly within this board or with other editors → AI corrects typos and similar issues → AI translates the remaining languages in the language set → manual review file by file; once all files pass review, committing is unlocked. After the commit, the merge into main can be triggered.
- For the official release, a human first triggers pushing the main branch, and the website sync result is verified separately.

## Command Execution

The "Commands" module presents `atb` CLI commands grouped by data and distribution, item lifecycle, batch development, execution receipts, manual decisions, and more, shown as buttons: pick a command, fill in parameters as prompted, preview the full command, then execute; output, exit code, and elapsed time are echoed directly. High-risk commands require a second confirmation before execution; commands with side effects such as `serve` come with an impact note. "Recent Executions" keeps the 10 most recent entries deduplicated by command; click one to refill the parameters and rerun quickly. Commands are delivered via a server-side whitelist and take effect only for projects on this machine.

## Multi-Project Management

One local service manages multiple projects: projects can be added, switched, and removed, and nonexistent directories are detected. The browser board uses port 8888 by default; it supports Chinese and English interfaces, keyboard shortcuts, and restoring the view after a refresh.

## Files and Data

Item documents live in `agent-team-board/data/` and are managed with the project's Git.

Status, configuration, and execution ledgers live in `agent-team-board/runtime/`. Data is stored locally.

[返回 README](./README_en.md) · [更新日志](./CHANGELOG_en.md) · [设计文档](./DESIGN_en.md)
