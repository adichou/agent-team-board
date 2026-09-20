# 设计 — REQ-20260909-008 任务界面采用多页签布局优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

任务模块（`#runsView` → `#batchDrawer`）为「一级页签（批量完善 / 批量开发）+ 单页长滚动」：
运行中批次的状态行、通知条、当前条目详情、计数、待处理队列、排队批次、主调度提示词、
操作按钮、本轮处理记录全部纵向堆叠，用户需长滚动在「看进度」与「取提示词 / 看记录」之间切换。
本需求在保留两个独立一级页签的前提下，为运行态内容引入二级页签分区，单屏切换。

## 方案

纯前端改动（`scripts/web/app.js` + `scripts/web/style.css`），不新增后端 API、不改状态机、不写 status.json。

### 待确认项结论（README「待确认」逐条）

1. **二级页签集合与命名**：定稿「概况 / 队列 / 提示词 / 记录」四区。
   - 概况：状态行 + 通知条（终止 / 暂停 / 完毕 / 待核对）+ 终态「启动新一轮」区 + meta-grid（当前条目 / 子代理会话 / 开始时间 / 耗时 / 最近回执 / 最后活动）+ 计数行 taskStatsLine + 操作按钮（暂停后续领取 / 终止任务 / 排队新批次 / 删除本批次）+ 暂停口径说明。
   - 队列：排队批次列表（REQ-20260906-025，含删除）+ 待处理队列（pendingQueueHtml，最近 2 条口径不变）。
   - 提示词：主调度提示词块（重新复制 / 复制续接提示词 / 打开 Zcode 工作区）。
   - 记录：本轮处理记录（runAttemptsHtml 四列表格，含重新执行）。
   - 操作按钮**归入「概况」分区**，不设独立常驻底栏（操作与状态/计数同屏，避免跨页签找按钮）。
2. **角标计数**：不加。概况已有计数行，队列 / 记录分区头部已有「最近 X 条 / 共 N 条」，页签角标冗余。
3. **记录展示上限**：维持 REQ-20260908-026 口径（最近 2 条 + 全量计数），不放宽。
4. **视觉层级**：一级页签保持胶囊式（`.tabs.batch-modes` 不变），二级页签为下划线式
   （`.task-subtabs`：无边框按钮 + 激活下划线 `--primary`），形态差异区分层级。
5. **键盘导航**：不引入左右方向键，与详情抽屉页签（REQ-20260909-006）一致——原生 button + Tab 聚焦 + 回车触发。

### 结构与状态

- 新增模块级 `TASK_PANES` 常量（四分区 key/label）、`taskPaneOf(store)`（记忆有效性，无效回落 overview）、
  `taskPaneShell(scope, store, panes)`（渲染页签行 + 四个 `task-pane` 分区，当前分区无 `hidden`、其余隐藏）、
  `activateTaskPane(scope, pane)`（纯前端切换：active / aria-selected / `.hidden` class，scope 隔离）。
- 记忆位置：批量开发 `state.batch.pane`、批量完善 `state.refine.pane`，初始 `'overview'`，相互独立；
  一级页签来回切换不重置（renderBatchDrawer 按当前 mode 渲染对应面板，各自读自己的 store）；
  2 秒轮询签名变化重建 DOM 后由 taskPaneShell 按 store.pane 恢复当前分区（同 REQ-20260909-006 的 drawer.tab 机制）。
- 归组实现：`renderZcodeBatchPanel` / `renderRefinePanel` 运行态分支改为向 `taskPaneShell` 传四分区内容；
  区块顺序与现状一致（概况内 status → notice → 终态启动区 → meta-grid → 计数 → 操作 → 说明）。
- 启动态（无 `data.batch`）与加载态（data 未到达）不渲染二级页签行，保持启动区 + 队列单屏。
- 空态：终态队列分区给「任务已收尾…」说明；完善任务提示词缺失（存量批次 `b.prompt` 为空）给
  「暂无调度提示词」说明；记录空态沿用 runAttemptsHtml「暂无执行记录」——页签均保留不隐藏。
- 存量 Codex 深链：`renderBatchDrawer` 的 `mode === 'codex'` 分支原样保留，不引入二级页签
  （无法归属分区的入口按 activateTaskPane 回落「概况」的口径兜底）。
- 可达性：`role="tablist"/"tab"/"tabpanel"` + `aria-selected` + `:focus-visible` 焦点态，沿用详情抽屉模式。
- CSS：`.task-subtabs`（flex-wrap 换行、无横向滚动）、`.task-subtabs .tab(.active)`（下划线式）、
  `.task-pane`（flex column gap，沿用 `.batch-run` 间距口径）、`.task-pane-tab:focus-visible`；全部复用现有 CSS 变量。

### 兼容与测试

- 存量 vm 隔离测试（refine-ui R12-8/9/10、batch-ui U16）以固定桩集提取运行面板函数执行，
  按 REQ-20260908-026 引入共用渲染件时的既有做法，为这些上下文补一行
  `taskPaneShell: (scope, store, panes) => Object.values(panes).join('')` 桩（断言本身不变）。
- 新增 `scripts/tests/tasks-tabs-20260909-008.test.mjs`（N1–N13：结构 / 记忆 / 切换行为 / 归组 /
  空态 / 可达性 / 窄屏样式 / 深链兼容 / 轮询契约 / 控件零回退），`npm test` 全量通过（114 个文件）。

## 风险与边界

- 只改布局不改流程：创建 / 领取 / 回执协议与全部操作入口（含 id）逐一保留并有 N13 契约用例盯防；
  提示词从「概况长滚动可见」变为「提示词页签内可见」，属预期的位置变化。
- 分区滚动位置不记忆（切换回顶部）：轮询重渲染本就重建 DOM，记忆收益低，保持简单。
- 2 秒轮询不打断输入 / 点击沿用现有签名比对 + 草稿保护机制，二级页签记忆叠加其上，不新增请求路径。
