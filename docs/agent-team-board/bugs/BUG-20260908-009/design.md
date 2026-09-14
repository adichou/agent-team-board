# 设计 — BUG-20260908-009 任务界面去掉任务这个标题

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260907-004（经 `atb list` 核验在册）。该需求把批量抽屉页面化为任务模块视图（`#runsView` 内 `#batchDrawer`，布局契约测试 W10「批量面板渲染进任务视图」），并确立「第三行不显示模块大标题，仅展示一句副标题」（`MODULE_SUB`）的去重口径；页面化时原抽屉头部 `header.batch-head > .batch-title` 里的 `<h2>任务</h2>` 模块名大标题被沿留，未按同一口径清理，形成导航 Tab 与面板头部的双重模块标识。与 BUG-20260908-008（设置模块同类沿留）同源。

## 根因分析

`scripts/web/app.js` 的 `renderBatchDrawer()`（约 2583 行）输出以 `header.batch-head > .batch-title` 开头，内含 `<h2>任务</h2>` 与项目标识 `span.path`。REQ-20260907-004 布局口径下模块归属已由第二行「任务」页签（`data-view="runs"` 高亮）+ 第三行副标题 `MODULE_SUB.runs`（「进度、队列与结果集中在这里」）承担，视图内模块名大标题属口径落地遗漏的冗余标识（同屏「任务」出现两次）。

## 方案

1. 仅移除 `renderBatchDrawer()` 模板中 `batch-title` 内的 `<h2>任务</h2>` 一行（README 期望 1 的逐字范围）；`span.path` 项目标识、`#batchClose` 关闭按钮（绑定 `setView('status')` 不变）、「批量完善 / 批量开发」子面板 Tab 全部原样保留。函数注释补一行 BUG 编号归因说明。
2. 新增契约测试 `scripts/tests/batch-title-removed.test.mjs`（沿 settings-title-removed.test.mjs 的 vm 沙箱模式）：
   - T1/T2 动态：沙箱内分别以 `state.batch.mode = 'refine' / 'develop'` 执行 `renderBatchDrawer()`，断言输出无 `<h2>任务</h2>`，且项目标识 span（含 title 提示）、`#batchClose`、两个 `data-bmode` Tab、`header.drawer-head` 容器、批量开发启动区 `#devMode` 均保留。
   - T3 静态契约：`renderBatchDrawer` 函数体不再拼接 `<h2>任务</h2>`，`id="batchClose"` 保留。
   - T4 范围边界：条目详情抽屉 `renderDrawer` 的 `<h2>${esc(it.title)}</h2>`（条目标题，非模块名）保持原样；`style.css` 的 `.drawer-head h2` 规则仍被详情抽屉引用故保留；`#runsView aria-label="任务"`、`#batchDrawer aria-label="任务面板"` 非可见辅助信息保留；设置模块头部不在本单范围。
3. 同步更新 `settings-title-removed.test.mjs` T3：其原边界断言「任务抽屉 `<h2>任务</h2>` 应保持原样」随本单边界变更失效，改为 `doesNotMatch` 并注明 BUG-20260908-009。
4. 不动 `style.css`：`.batch-head/.batch-title` 仍承载项目标识布局；`.drawer-head h2` 仍被详情抽屉引用。

## 风险与边界

- 头部去掉大标题后 `.batch-title` 仅剩 `span.path`，`span.path` 自身无 margin 依赖 h2 的结构（`.drawer-head h2 { margin: 6px 0 0 }` 只作用于 h2），宽屏/窄屏（含 ≤720px 无边框布局）由 `.batch-head` flex 布局继续承担，项目标识与「✕」分列两端不重叠。
- 无数据与状态流转变更：关闭按钮绑定、子面板切换（`bindBatchDrawer`）、任务搜索过滤、进入模块刷新轮询均不动。
- 回归入口：`node scripts/tests/batch-title-removed.test.mjs` + `node scripts/tests/settings-title-removed.test.mjs` + `node scripts/tests/run-all.mjs`。
