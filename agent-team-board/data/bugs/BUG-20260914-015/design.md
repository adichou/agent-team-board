# 设计 — BUG-20260914-015 AI 分析或 AI 开发中时，开始 AI 分析和开始 AI 开发按钮需要改变状态，不能点击，文本改为 AI 分析中和 AI 开发中

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- **引入来源：REQ-20260909-007**（已 `atb list` 核验存在，done：「在已接受和已计划界面分别添加开始完善和开始开发快捷按钮」）。该需求在看板列表头引入常驻快捷入口按钮（文案「▶ 开始 AI 分析 / ▶ 开始 AI 开发」由 REQ-20260913-005 改名而来），实现口径为「仅导航：批量操作进行中也不禁用」并恒置 `quick.disabled = false`（app.js `syncAcceptance()` 内，注释在案）。当时看板侧没有批次运行态数据源、也没有「任务执行中应禁用」的要求，按钮在任何批量任务执行中都保持可点原文案——即本 Bug 现象。
- 补充关联：REQ-20260913-005（快捷入口与面板文案改名「AI 分析 / AI 开发」）、BUG-20260909-006（批量开发入口唯一收敛任务模块，快捷入口纯导航的由来）。

## 根因分析

1. **前端按钮不消费运行态**：`syncAcceptance()`（scripts/web/app.js）每轮同步快捷入口按钮的文案与显隐，但配置只按当前筛选档切换（已接受 → `▶ 开始 AI 分析`，已计划 → `▶ 开始 AI 开发`，其余档隐藏），不读任何任务运行态；且恒置 `quick.disabled = false`（「仅导航」口径一刀切，未区分任务执行中场景）。
2. **看板侧无运行态数据源**：批次运行态的现有接口 `/api/refine/current`、`/api/batch/current` 仅在任务模块打开时随主轮询拉取（`poll()` 内 `if (state.batch.open) await refreshBatch()`），看板视图的 `/api/board` 轮询拿不到任务运行态——`syncAcceptance` 即使想消费也无处可读。
3. 两点叠加：任务执行中按钮无任何状态变化，与「任务未启动」不可区分，点击照常跳转任务模块，产生误导。

## 方案

**开源选型（REQ-20260909-015）**：自研。理由=无合适库：本改动是插件自有前后端的一处只读聚合接口 + 一个自研按钮控件的消费逻辑，无对应成熟开源库可引入（UI 组件为本项目自研体系），引入任何库成本均高于这几十行自研代码。

### 服务端（scripts/server.mjs）

新增只读轻量接口 `GET /api/tasks/state`（绑定 `?project=`，与 `/api/tasks/settings` 相邻放置）：

- 复用既有 `projectTaskRows(root)`（「在工作」口径：unfinished 且未 terminated，与全局任务看板同源），按 `kind`（`refine` / `develop`）归类；
- 响应 `{ ok: true, refine: <status|null>, develop: <status|null> }`；同类多行（存量排队账本）时按活跃度取一行：`running > needs_attention > paused > prepared`；
- 未初始化项目（无 dataDir）不抛错，按「无任务」返回两个 null（对齐全局任务看板对未初始化注册项目的 README 边界口径）。

### 前端（scripts/web/app.js）

- `state` 增 `taskRun: { refine: null, develop: null }`（当前项目两类任务运行态快照）。
- 新增 `refreshTaskRunState()`：拉 `/api/tasks/state`；签名（两状态拼接）无变化不写 DOM，变化则更新 `state.taskRun` 并调 `syncAcceptance()`——`/api/board` 无变化时 `renderBoard` 不执行（boardJson 剪枝），任务态变化必须显式同步按钮；失败静默保留旧值（服务离线按钮保持最后已知状态不误报，README 口径）。
- `poll()` 在 board 拉取后追加 `await refreshTaskRunState()`（不依赖 `state.batch.open`；boot 与切项目首轮 poll 即首载，无需单独接线）。
- `switchProject()` 重置 `state.taskRun`（按项目隔离，防串项目）。
- `syncAcceptance()` 快捷入口分支消费运行态：
  - 已接受档且 `state.taskRun.refine === 'running'` → 文案「AI 分析中」、title「AI 分析任务执行中：子代理正在批量补全文档，收尾后自动恢复入口」、`disabled = true`；
  - 已计划档且 `state.taskRun.develop === 'running'` → 「AI 开发中」同理禁用；
  - 其余保持原文案可点（**批量操作进行中仍不禁用**，REQ-20260909-007 既有口径保留）；`aria-label` 随 label 既有逻辑同步。

## 边界口径（README「待确认」三项定稿）

- **执行中判定 = 批次 `status === 'running'`**：与任务面板徽章 `batchStatusLabel` 的「执行中」同源同值（登记运行后才算执行中）；只有该态禁用按钮并改文案「AI 分析中 / AI 开发中」。
- **待启动（prepared）/ 已暂停（paused）/ 待核对（needs_attention）：按钮保持可点原文案**。理由：验收第 4 条要求按钮态与任务面板批次状态「一致、不互相矛盾」——这三态的面板徽章分别是「待启动 / 已暂停 / 执行状态待核对」，按钮若显示「AI 分析中」即与面板矛盾；且暂停、待核对正等人工进面板处理（恢复 / 核对 / 终止），入口可点正是处理通道；prepared 沿用产品既有口径「复制成功 ≠ 执行中」（README 原则确认项）。
- **终态（finished / aborted）**：服务端「在工作」口径已排除，不进入响应；批次收尾后 ≤1 个轮询周期（约 2 秒）按钮随 `refreshTaskRunState` 自动恢复可点。
- **跨任务不联动**（README 默认口径确认）：已接受档按钮只看 refine 态，已计划档只看 develop 态。
- **服务离线**：拉取失败保留旧值，按钮保持最后已知状态；连接状态由 `#pollState`「○」既有指示承担，不重复反馈。

## 风险与边界

- 每 2 秒多一个轻量只读请求（读两份批次账本 JSON），开销可忽略；仅在签名变化时才触发 `syncAcceptance` 的 DOM 写入，无闪烁。
- disabled 的原生 button 不派发 click，无需额外拦截；视觉弱化直接复用现有 `.btn:disabled`（opacity 0.5 / cursor not-allowed），零新增 CSS。
- 既有测试 `lane-quick-entry-20260909-007`（Q2 文案 / Q5 常驻可用性）不回归：默认 `state.taskRun` 为 null（无任务）时按钮行为与现状完全一致；「批量操作进行中不禁用」口径保留。

## 实施记录（2026-09-14，zcode-batch-048-21）

改动文件：

1. `scripts/server.mjs`：新增 `GET /api/tasks/state`（紧邻 `/api/tasks/settings`）——复用 `projectTaskRows`「在工作」口径，`{ ok, refine, develop }` 各为批次状态或 null；同类多行按 `running > needs_attention > paused > prepared` 取一。
2. `scripts/web/app.js`：
   - `state` 新增 `taskRun: { refine, develop, sig }`；
   - 新增 `refreshTaskRunState()`（拉 `/api/tasks/state`，签名剪枝，失败静默保留旧值），`poll()` 在 board 拉取后无条件调用（不依赖任务面板打开）；
   - `syncAcceptance()` 快捷入口分支消费运行态：执行中禁用并改文案/title/aria-label，其余保持原文案（批量 pending 仍不禁用）；
   - `switchProject()` 重置 `state.taskRun`（按项目隔离）。
3. `scripts/web/i18n.js`：新增 4 条词条（「AI 分析中 / AI 开发中」及两条 title 说明的英文翻译）。
4. 条目文档：README 头部引入来源行与边界口径定稿、ui-demo.html「待启动」措辞同步定稿、新增 test-cases.md 与本 design.md。

测试：新增 `scripts/tests/bug-quick-entry-running-20260914-015.test.mjs`（S1-S5 服务端真 server 用例、F1-F7 前端 vm 桩用例、C1 接线契约，共 9 例全过）；全量 `node scripts/tests/run-all.mjs` 234 个测试文件全部通过（i18n 词典补齐后 i18n-coverage 恢复绿色）。
