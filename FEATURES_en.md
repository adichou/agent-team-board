# Features

Applicable version: 1.0.0 (full-feature baseline release)

## Requirements and Bugs

Register issues in the "Requirements" module, fill in the description and acceptance criteria, and optionally attach screenshots. After a human accepts an item, it is scheduled into the plan and an Agent claims it for implementation; once reported, the item shows as pending testing and is completed through human acceptance. The list supports search, sorting, and batch operations where applicable; the completed list shows the most recent 100 items by default, and earlier items can be located via search. When an item in development needs a human decision, the decision-supplement entry appears in real time as the board polls.

In the detail view you can read the description, design, test cases and reports, switch between adjacent items, copy the ticket number, and generate discussion prompts based on the document content. Bugs are registered independently; when fixing a bug, its introduction source is recorded in the description and design for traceability.

## AI Analysis and AI Development

"AI Analysis" completes the description and acceptance criteria for accepted items, and generates an interactive UI demo when a UI is involved. "AI Development" takes tickets from the planned queue and performs claim, testing, implementation, and reporting. On the requirements page, the "▶ AI Analysis" and "▶ AI Development" buttons copy the main orchestration prompt on click; just paste it into the project's Agent session to start. The board provides execution records and task control entries.

When a human decision is needed, the issue enters the pending-human-confirmation area, where a human supplies the decision and work resumes; after the AI analysis is confirmed, the continuation run starts and the continuation prompt is copied automatically. When an auto-commit has omissions or doubtful attribution, you can review the diff and complete the confirmation. A global task view aggregates active tasks across projects; the task ledger is kept on the local machine.

The auto-commit after development is finished only commits to the local dev branch; it is not human acceptance, and nothing is pushed to the remote automatically. The standalone "Batch Commit" entry has been rolled back.

## Release

Create a version plan in the "Release" module, associating completed requirements or bugs along with their commits. Version numbers follow the x.y.z format and are assigned by you. The "Overview" tab in the detail view supports AI-assisted refinement of version info with in-place editing.

A release proceeds in five steps: version plan → associate items and commits → document writing → merge into main → official release.

- Before merging, commit attribution isolation analysis is performed: independent changes can be released separately; when dependencies are unselected or commits are mixed, the reasons are clearly listed, and all unselected dependencies can be added with one click;
- The merge is executed in an isolated work tree in a history-preserving manner, and the working directory stays on the dev branch.
- Document writing has two stages: AI summarizes the default-language documents (the four types README, CHANGELOG, FEATURES and AGENTS, plus multiple custom documents added as needed) → human review file by file → AI translates the remaining languages in the language set and each file is reviewed; once all files pass review, submission is unlocked (starting from BUG-20260926-002, the overall review completion confirmation is no longer needed); document preview supports Markdown rendering.
- For the official release, a human first triggers pushing the main branch, and the website sync result is verified separately.

## Command Execution

The "Commands" module presents `atb` CLI commands as buttons, grouped by data and distribution, item lifecycle, batch development, execution receipts, human decisions, and more: choose a command, fill in the parameters as prompted, preview the full command, then execute; output, exit code, and elapsed time are echoed back directly. High-risk commands require a second confirmation before execution; commands with side effects, such as `serve`, come with an impact description. "Recent executions" keeps 10 entries deduplicated by command; click one to refill the parameters and rerun quickly. Commands are delivered through a server-side whitelist and take effect only on local projects.

## Multi-Project Management

A single local service manages multiple projects: you can add, switch, and remove projects, and it detects non-existent directories. The browser board uses port 8888 by default; it supports Chinese and English interfaces, keyboard shortcuts, and view restoration after a refresh.

## Files and Data

Item documents are located in `agent-team-board/data/` and are managed with the project's Git.

State, configuration, and execution ledgers are located in `agent-team-board/runtime/`. Data is retained locally.

[返回 README](./README_en.md) · [更新日志](./CHANGELOG_en.md) · [设计文档](./DESIGN_en.md)
