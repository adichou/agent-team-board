# Changelog

## 1.0.0 Full-Feature Baseline Version (202609-1)

### Requirements Board

Requirements and bugs are managed through their full lifecycle across six statuses: Pending Acceptance, Accepted, Planned, In Development, Pending Test, and Completed. The list and detail are shown in separate panes, with a tabbed detail view and quick browsing to the previous or next item. Supports search, sorting, pagination, bulk acceptance and move-to-planned, editing and deletion, screenshot upload with double-click to zoom, copying item IDs, and generating discussion prompts from item documents. When an item in development has a pending manual decision, the entry point for supplying that decision appears in the requirements list in real time, no longer relying on a refresh.

### AI Task Board

AI analysis automatically refines the description and acceptance criteria for accepted items (producing an interactive demo when a UI is involved).

AI development automatically implements the planned queue one item at a time — claim, test, implement, report — and the system automatically commits each item's changes to the dev branch for manual acceptance. Blocked items move to the pending-manual-confirmation area and resume once the missing decision is supplied manually.

Provides project-level task management, along with a global overview view of tasks across projects.

### Release Board: Five-Step Workflow and Three-Phase Documentation

A standardized release process walks you through five steps — "Version Planning → Link Items and Commits → Write Documentation → Merge into main → Official Release" — focused on solving the problem of not knowing what remains to be done after requirement development is complete.

### Command Board

"Commands" tab: `atb` CLI commands are presented as buttons grouped by category; fill in parameters and run them in the web page with the full output echoed back; high-risk commands require a second confirmation, and the whitelist is distributed from the server side;

"Recent Executions" keeps the 10 most recent entries, deduplicated by command; click one to refill its parameters. Commands not covered by the dedicated UI, such as `serve` and `rebuild`, can be used without a terminal.

[返回 README](./README_en.md) · [功能说明](./FEATURES_en.md) · [设计文档](./DESIGN_en.md)
