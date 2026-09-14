# 测试报告 — REQ-20260913-005 批量完善和批量开发的文案改为 AI 分析和 AI 开发，要全面排查整改

- 时间：2026-09-14T01:00:58.920Z
- 执行者：zcode-batch-048-3
- 测试框架：Node.js（scripts/tests/run-all.mjs 聚合）
- 覆盖率：未统计

## 总结

「批量完善→AI 分析」「批量开发→AI 开发」全面文案整改：web（index.html/app.js/i18n.js 中英 19 键）、CLI/服务端（atb/core/batch/refine-store/git-flow/state-guard/task-settings）与展示层归一链；标识符与 API 不动；新增契约测试 7 用例，全量 217 文件 0 失败

## 明细

### TDD 过程

1. **跑红**：新增契约测试 `scripts/tests/copy-rename-20260913-005.test.mjs`（7 用例，对应 test-cases.md 用例 1-5），实现前 7/7 失败。
2. **实现**：按下表逐处替换用户可见文案（「批量完善→AI 分析」「批量开发→AI 开发」「▶ 开始完善→▶ 开始 AI 分析」「▶ 开始开发→▶ 开始 AI 开发」；含 title / aria-label 同源文案）。
3. **跑绿**：契约测试 7/7 通过；随后全量 `npm test`。

### 改动清单（用户可见文案）

| 文件 | 位置 |
| ---- | ---- |
| `scripts/web/index.html` | 驳回待接受 title、档位快捷入口 aria-label/title/可见文案 |
| `scripts/web/app.js` | 任务模块子页签、RUN_KIND_TABS / GLOBAL_KIND_LABEL、快捷入口 label+title×2、完善三态徽标 hint×3、终止二次确认标题×2、面板说明、全局空态、复工 title 与 toast、驳回禁用 title |
| `scripts/web/i18n.js` | 19 个中英键成对更新（AI analysis / AI development / Start AI analysis / Start AI development 等） |
| `scripts/atb.mjs` | 帮助×2（batch create、hold resume）与日志×3（创建进入 AI 分析候选、自动转计划进入 AI 开发候选、已复工） |
| `scripts/lib/core.mjs` | 暂停/互斥占用提示×2、完善中驳回报错 |
| `scripts/lib/batch.mjs` | 占位执行规范头「# AI 开发执行规范」、调度员提示词首句「AI 开发调度员」 |
| `scripts/lib/refine-store.mjs` | 调度员提示词首句「AI 分析调度员」 |
| `scripts/lib/git-flow.mjs` | 自动提交 summary「（AI 开发回执核验通过）」 |
| `scripts/state-guard.mjs` | 流程外提交拒绝提示 |
| `scripts/lib/task-settings.mjs` | `TASK_KIND_LABEL = { refine: 'AI 分析', develop: 'AI 开发' }`；展示层归一链新增「批量完善/批量开发调度员」→ 新名映射（存量冻结提示词展示同口径，账本不回写） |

### 存量测试同步更新（断言旧文案 → 新文案）

`batch-core`、`batch-title-removed`、`caption-toolbar-20260910-008`、`caption-toolbar-icons-20260910-026`、`lane-quick-entry-20260909-007`、`realtime-round-20260913-003`、`refine-prompt-autoplan-20260910-008`、`refine-ui`、`tasks-tabs-20260909-008`（9 文件；另 `commit-rollback-20260911-010` 的入口文案断言由「靠注释侥幸命中」收紧为直接断言新文案）。

### 验收口径复核

- `grep -rn "批量完善\|批量开发\|开始完善\|开始开发" scripts/web --include="*.js" --include="*.html"` 剩余 38 处均为代码注释（历史口径说明，README 明示不作验收项）；`i18n.js` 中英两侧零旧词（含英文 Batch refine / Batch develop / Start refining / Start developing 等短语）。
- 标识符未动：`atb refine` / `atb batch` 子命令、`data-bmode`、kind 取值 `'refine'` / `'develop'`、API 路径、gotoRuns 契约不变。
- 历史存档（`docs/agent-team-board/` 历史条目与 `dispatch/runs/`）零回溯改动；英文措辞按 README 建议定稿并写回本条目 README（待人工验收确认）。

### 测试结果

- 契约测试：`node scripts/tests/copy-rename-20260913-005.test.mjs` → 7 个用例，失败 0。
- 全量：`npm test` → 共 217 个测试文件，失败 0（完整输出见 `docs/agent-team-board/dispatch/runs/run-20260914-219/npm-test.log`）。
