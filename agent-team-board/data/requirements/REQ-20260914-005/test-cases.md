# 测试用例 — REQ-20260914-005 回退 BUG-20260914-015，并把 开始 AI 开发和开始 AI 分析两个按钮改成 AI 开发和 AI 分析就行

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 服务端：`GET /api/tasks/state` 路由随回退移除——已初始化项目与未初始化裸目录请求均返回 404，服务端其余接口（/api/health 等）行为不变 | 高 | 通过（quick-entry-revert-20260914-005.test.mjs S1） |
| R2 | app.js 源码契约：BUG-20260914-015 引入符号全部移除（`state.taskRun`、`refreshTaskRunState`、`/api/tasks/state`、执行中判定分支、「AI 分析中 / AI 开发中」文案）；恢复 `quick.disabled = false` 与「仅导航：批量操作进行中也不禁用」注释 | 高 | 通过（quick-entry-revert-20260914-005.test.mjs F1） |
| R3 | 前端行为（vm 模拟 DOM）：已接受档按钮恒为「▶ AI 分析」、已计划档恒为「▶ AI 开发」，任何批量 pending 下均 disabled=false（不存在执行中禁用路径）；title 沿用导航说明不变 | 高 | 通过（quick-entry-revert-20260914-005.test.mjs F2，及 lane-quick-entry-20260909-007 Q2/Q5 更新后口径） |
| R4 | i18n：BUG-20260914-015 的 4 条词条（「AI 分析中」「AI 开发中」及两条执行中 title）移除；键「▶ 开始 AI 分析 / ▶ 开始 AI 开发 / 开始 AI 分析」改为「▶ AI 分析 / ▶ AI 开发 / AI 分析」（英文 `▶ AI analysis` / `▶ AI development` / `AI analysis`）；旧键不残留 | 高 | 通过（quick-entry-revert-20260914-005.test.mjs F3，i18n-coverage 保持通过） |
| R5 | index.html 静态节点 `#laneQuickEntry`：可见文案「▶ 开始 AI 分析」→「▶ AI 分析」、`aria-label="开始 AI 分析"` → `"AI 分析"`，title 不变 | 高 | 通过（quick-entry-revert-20260914-005.test.mjs F4） |
| R6 | 既有测试同步改词不回归：`lane-quick-entry-20260909-007` / `caption-toolbar-20260910-008` / `caption-toolbar-icons-20260910-026` / `copy-rename-20260913-005` / `commit-rollback-20260911-010` 中「▶ 开始 AI 分析 / ▶ 开始 AI 开发 / 开始 AI 分析」断言改为新词；专属测试文件 `bug-quick-entry-running-20260914-015.test.mjs` 删除；全量 `node scripts/tests/run-all.mjs` 通过 | 高 | 通过（全量套件） |
