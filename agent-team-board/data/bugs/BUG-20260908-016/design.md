# 设计 — BUG-20260908-016 批量完善没有显示 zcode 和codex 的选择，生成的提示词都是 zcode

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260908-014（其修复新增的收尾「启动新任务」入口直接绑定 `createRefineBatchAndCopy`，而执行 Agent 选择控件 `#refineMode` 只存在于首次创建面板——运行态面板无该控件，创建函数回退 `state.refine.mode`（初始 `'zcode'`）静默按 zcode 创建。双 Agent 差异化能力来自 REQ-20260908-020，暴露为「选不到 codex」。两编号均经 `atb list` 核验存在。）

## 根因分析

前端 `scripts/web/app.js` 三处叠加（服务端 `/api/refine/create` 的 mode 校验与差异化提示词生成本身正确）：

1. **运行态面板无 Agent 选择**：`renderRefinePanel` 只在 `!data.batch` 分支渲染 `#refineMode` 下拉；而 `/api/refine/current` 取 `queueHeadRefineBatch`——「全部结束回退最新」，项目里只要创建过任意完善批次，`data.batch` 永远非空，面板永远走运行态分支，带选择的创建面板从此不再出现。
2. **收尾「启动新任务」静默回退 zcode**：`#refineNext` 直接绑定 `createRefineBatchAndCopy`，其取值为 `$('#refineMode')?.value || state.refine.mode || 'zcode'`——运行态面板无 `#refineMode`，回退初始值 `'zcode'`，恒以 zcode 创建。
3. **首次创建面板也无空占位**：`mode = agents[0] || 'zcode'` 默认选中第一项 zcode，用户不动下拉即静默按 zcode 创建（次要问题，与本单一并修复）。

## 方案

定案：**收尾面板内嵌 Agent 选择**（不动 `queueHeadRefineBatch` 的「回退最新」语义——运行态面板本身有查看价值），交互对齐批量开发启动条。改动全部在 `scripts/web/app.js`：

1. `state.refine.mode` 初始值 `'zcode'` → `''`（空 = 未选择），作为创建面板与收尾面板共用的选择草稿，轮询重渲染后据此恢复选中（不回落默认值）。
2. 创建面板 `#refineMode` 增加空占位 `<option value="">选择执行 Agent…</option>`；`mode` 计算去掉 `agents[0] || 'zcode'` 回退；`#refineCreate` 在「无可见 Agent」或「未选择」时禁用并给 title 说明。
3. 收尾区（`batchDone`，含终止收尾——BUG-20260908-014 入口）内嵌 `#refineNextMode` 下拉：同一空占位、选项按 `visibleTaskAgents('refine')` 过滤；全隐藏时显示「设置中已隐藏全部执行 Agent：请到「设置 → 批量任务」恢复展示。」并禁用按钮。`#refineNext` 禁用条件 = 无可见 Agent ‖ 无候选 ‖ 未选择，title 按优先级给出对应原因（无候选文案保持 R12-8 口径不回归）。
4. `createRefineBatchAndCopy`：取值改为 `$('#refineMode')?.value || $('#refineNextMode')?.value || ''`（两者互斥渲染），非 zcode/codex 时 toast「请先选择执行 Agent（zcode / codex）」并直接返回——不发出 `/api/refine/create` 请求；彻底删除 `state.refine.mode || 'zcode'` 静默回退。
5. `bindBatchDrawer` 为 `#refineNextMode` 补 change 处理（写回草稿并重渲染，与 `#refineMode` 同一模式）。

服务端、refine-store（幂等/排队/提示词差异化）零改动；批量开发面板（`renderDevStartBar` / `bindDevStart`）零改动。

## 风险与边界

- 收尾区多了一个下拉，轮询重渲染由签名剪枝 + 草稿恢复保证不打断选择；`renderBatchDrawer()` 全量重渲染为既有模式（`#refineMode` 已如此），无新增风险。
- 老用户若依赖「不动下拉直接启动」的一步启动，现需先选 Agent——这是期望行为（README 明确「未明确选择不得静默按 zcode 创建」），与批量开发一致。
- 无候选 / 全隐藏 / 未选择三种禁用原因通过 title 展示，优先级：全隐藏 > 无候选 > 未选择；`state.refine.mode` 草稿可能保存已隐藏的 Agent（设置中途变化），渲染前经 `agents.includes(...)` 过滤回落为未选择，不会下发非法 mode。
- 服务端本就校验 `mode ∈ {zcode, codex}`，前端守卫只是不产生无效请求，双层防线。

## 实施记录（2026-09-08，zcode-batch-018-1）

- TDD：`scripts/tests/refine-ui.test.mjs` 新增 R12-10（vm 提取真实 `renderRefinePanel` / `createRefineBatchAndCopy` 源码断言），先跑红（首断言「收尾面板应内嵌执行 Agent 选择」失败）后实现转绿。
- 覆盖：正常收尾 / 终止收尾出现选择与空占位、未选择禁用且不发请求并提示、选中 codex 后可用且选中可见、隐藏 codex 只剩 zcode、全隐藏提示 + 禁用、无候选仍禁用（R12-8 口径回归）、创建面板空占位 + 未选择禁用、创建函数无静默 zcode 回退（源码断言）。
- 回归：`refine-ui` / `refine-store` / `tasks-refine` 全部通过；`run-all.mjs` 全量 95 个测试文件 0 失败（首次串跑 `body-limit.test.mjs` 偶发失败，单跑与复跑均通过，与本次改动无关）。
