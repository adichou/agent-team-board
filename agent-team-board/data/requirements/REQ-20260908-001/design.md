# 设计 — REQ-20260908-001 任务看板的批次记录上，需要显示每个单的标题，放到单号的后面

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

Status Board 任务模块批次面板的「批次记录」来自 `GET /api/batch/records` → `batch.listRuns()`（scripts/lib/batch.mjs）。
返回记录只有 runId/itemId/owner/result/reason/reportRef/at，没有条目标题；前端 `recordsHtml()`（scripts/web/app.js）
单号后直接渲染「执行器 · 时间」。而同面板「当前条目」行已在 server.mjs 里为 currentRun 单独补了 title，
两处口径不一致，批次记录看不到每个单的内容。

## 方案

1. **核心层补标题**：`batch.listRuns()`（lib/batch.mjs）为每条记录增加 `title` 字段，
   读取方式与 server.mjs `/api/batch/current` 的 current 一致：
   `readStatus(resolveItemDir(dataDir, r.itemId).dir).title`，try/catch 失败回退空串
   （条目可能已被删除，账本记录仍在）。`batchSummary().records` 与 `/api/batch/records` 自动带出。
2. **前端渲染**：`recordsHtml()` 在单号 span 后新增标题 span：`shortOwner(r.title || '')` 截断 + `title` 属性悬停全文，
   与「当前条目」行的展示口径一致。
3. **搜索一致性**：批次记录过滤数组由 `[itemId, owner, reason]` 扩为含 `title`
   （REQ-20260907-004 任务搜索语义本就含标题，仅批次记录缺）。

## 影响面

- scripts/lib/batch.mjs：listRuns（唯一改动函数，纯增量字段）。
- scripts/web/app.js：recordsHtml（渲染 + 过滤）。
- server.mjs 不改（current 的 title 逻辑保持原样）。

## 风险与边界

- listRuns 每条多一次同步读 status.json：页大小上限 100（面板每页 10），开销可忽略。
- 旧客户端/测试若对记录对象做严格 deepEqual 会受新字段影响——检索现有测试无此用法（均为字段级断言）。
- title 为空（条目被删）时前端留空渲染，不显示占位符，避免误导。

## 实施记录

- TDD：先在 batch-core.test.mjs / batch-ui.test.mjs 各加 1 个用例（5 组断言）确认跑红，再实现跑绿。
- `scripts/lib/batch.mjs`：`listRuns()` 记录增加 `title`；新增私有辅助 `itemTitleOrEmpty()`（try/catch 回退空串）。
- `scripts/web/app.js`：`recordsHtml()` 单号后渲染 `<span class="small rec-title" title="…">shortOwner(title)</span>`；
  任务搜索过滤数组扩为 `[itemId, owner, reason, title]`。
- `scripts/web/style.css`：新增 `.batch-record .rec-title`（正文色 + 收缩省略，模式同 `.reason`）。
- 回归：`node scripts/tests/run-all.mjs` → 76 个测试文件失败 0。
