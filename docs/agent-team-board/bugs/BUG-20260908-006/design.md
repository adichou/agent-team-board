# BUG-20260908-006 方案：「改为已计划」统一改为「移入计划」

## 引入来源（源单）

- 引入来源：REQ-20260908-010（引入了详情页「改为已计划」单条按钮与配套指引文案）；术语冲突由 REQ-20260908-018 暴露（列表级批量操作命名「移入计划」，且其设计明确把既有文案改名留给本 Bug：REQ-20260908-018 design.md「不改 `drawerActionsButtonHtml` 的『改为已计划』文案——改名归属 BUG-20260908-006」）。
- 来源 ID 均经 `atb list --json` 核验存在（REQ-20260908-010 / REQ-20260908-018，均为 in-progress）。

## 根因分析

REQ-20260908-010 首次引入人工排期操作时，详情页按钮文案定为「改为已计划」，各处指引随之大面积引用该叫法。REQ-20260908-018 增加列表级批量同口径操作时采用更准确的动词短语「移入计划」（与既有「移出计划」对仗），但为控制改动面未同步改名既有文案，导致同一 accepted → planned 动作在界面上并存两套术语。

## 方案

纯文案统一，不改任何状态机与交互行为：

1. `scripts/web/app.js`
   - `drawerActionsButtonHtml` accepted 档按钮：`data-label="改为已计划"`、`➤ 改为已计划` → `data-label="移入计划"`、`➤ 移入计划`（`data-act="planned"` 不变）。
   - 指引文案 5 处改称「移入计划」：`LANE_HINT.accepted`、未入批次 `stateBadge` title、未入批次详情提示、详情「未入计划」notice、批量开发空态 notice。
   - 同口径注释 4 处同步改名（`与详情页「改为已计划」同口径`、`撤销「改为已计划」`、`改为已计划（人工排期…）` 等），保持注释与 UI 一致。
   - 不动：`planned` 档「移出计划」文案、`LANES`/`REQ_FILTERS` 等机器契约、`REQ-20260908-010 资格改为已计划`（此处「改为」为动词，指资格变更为 planned 状态，非按钮名）。
2. `scripts/lib/batch.mjs`：无候选提示「接受条目并『改为已计划』」→「移入计划」。
3. `skills/agent-team-board/SKILL.md`、`commands/dev.md`：Agent 指引「接受并『改为已计划』」→「移入计划」。
4. `docs/agent-team-board/batch-execution.md`（活文档）：「需人工『改为已计划』排期」→「移入计划」。
5. 历史 REQ 条目文档（REQ-20260908-010/018 目录内）为当时实施记录，不改写。

## 测试

- 新增 `scripts/tests/plan-wording.test.mjs`（BUG-20260908-006）：按钮 data-label/文案、指引文案、batch.mjs 提示、dev.md/SKILL.md 指引均含「移入计划」且插件源码不再出现「改为已计划」。
- 更新既有断言：`planned-state.test.mjs` S10、`pending-alignment.test.mjs` R5（原断言旧文案，随本 Bug 改为断言新文案）。

## 实施记录

- 2026-09-08 zcode-batch-015-01：按上述方案实施，测试见 test-cases.md / test-report.md。
