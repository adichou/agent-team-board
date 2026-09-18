# BUG-20260908-006 测试用例

框架：node:test 风格自研 runner（`scripts/tests/run-all.mjs`）+ node:assert 静态契约/VM 模拟 DOM 断言。

| # | 用例 | 优先级 | 结果 |
| --- | --- | --- | --- |
| 1 | 详情按钮：accepted 档 `drawerActionsButtonHtml` 输出 `data-act="planned" data-label="移入计划"`，可见文案为 `➤ 移入计划` | P0 | 通过（plan-wording W1） |
| 2 | 插件源码（scripts/、commands/、skills/）不再出现「改为已计划」 | P0 | 通过（plan-wording W2） |
| 3 | 指引文案统一：`LANE_HINT.accepted`、未入批次 title/详情提示、详情「未入计划」notice、批量开发空态 notice 均含「移入计划」 | P1 | 通过（plan-wording W3） |
| 4 | CLI 提示：`scripts/lib/batch.mjs` 无候选提示含「移入计划」 | P1 | 通过（plan-wording W4） |
| 5 | Agent 指引：`commands/dev.md` 与 `skills/agent-team-board/SKILL.md` 的排期指引含「移入计划」 | P1 | 通过（plan-wording W5） |
| 6 | 回归：planned 档「移出计划」按钮与批量移入/移出计划（plan-batch-move、planned-state、pending-alignment 等全量套件）不受影响 | P0 | 通过（全量 87 个测试文件，失败 0；planned-state S10/pending-alignment R5 断言随本 Bug 更新为「移入计划」后通过） |
