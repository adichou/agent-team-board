# 设计 — REQ-20260908-027 选择功能混乱，需要重构

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

Status Board 需求列表的三档勾选（待接受 / 已接受 / 已计划）互相独立且跨档保留（BUG-20260907-016 契约），
但选择工具条把三类勾选合并计数，且「接受所选 / 移入计划 / 进入批量开发 / 移出计划 / 批量完善 / 清空选择」
全部按钮常驻——不同档的勾选与操作在同一个工具条里混杂；全选 / 全不选入口不成对；勾选行还有主题蓝边框
高亮（`.req-row.selected`）。本需求把选择整体重构为「按当前筛选档隔离」。

## 方案

（技术选型、接口设计、影响面——实施记录）

### 1. 工具条按档收窄（`scripts/web/app.js` `syncAcceptance` 重写）

- 新增 `LANE_SELECTION = { submitted: 'acceptance', accepted: 'plan', planned: 'impl' }`、
  `currentLaneSelection()`、`anyBatchPending()`（接受 / 移入计划 / 驳回 / 移出计划任一进行中）。
- 工具条可见性 = 当前档勾选数 > 0（旧版为三档合并计数 > 0）；开发中 / 待测试 / 已完成档无可勾选条目，
  恒隐藏。`#selCount` 只统计当前档：`已选 N 项（<当前档名>）`。
- 按钮显隐（静态节点 + `.hidden` class 切换，事件绑定仍只绑一次）：
  待接受 → 「接受所选」；已接受 → 「移入计划」+「驳回待接受」（新增 `#planReject`）；
  已计划 → 「进入批量开发」+「移出计划」；尾部保留「清空选择」。
- 结果区 `#acceptResult` 按档呈现：submitted → acceptance 模块，accepted → plan + reject 模块，
  planned → impl 模块；切档不打扰其他档结果（切回仍可见）。

### 2. 批量驳回待接受（新增 `rejectToSubmitted`，对齐 `moveToPlan` 交互）

- 与批量移入计划共用已接受勾选集合 `state.plan.selected`（资格 = `planCandidates()`：accepted，叠搜索）；
  `state.reject = { pending, message, failures }` 独立，同档两个操作先后执行状态互不覆盖。
- 一次页面内二次确认 → 逐条 `POST /api/item/:id/status {to:"submitted"}`（绑定当前项目）→
  成功移出勾选、失败进 failures 并保留勾选可重试、单项失败不回滚。
- 完善中（refineState=refining）的单由服务端 `core.mjs setStatus` 拦截（错误文案「完善中，待本轮批量
  完善结束后再驳回回待接受」），计入失败清单——与详情页单条驳回、CLI 同口径。
- `switchProject` 重置 `state.reject`；进行中切项目停止后续请求（`state.reject !== m` 守卫）。

### 3. 全选 / 全不选成对入口（`#selectOperable` 改造 + 新增 `#selectNone`）

- 「全选」（原「选择可操作项」，id 不变，文案改「☑ 全选」）：当前档勾选集合**替换为**当前筛选档内
  可见可操作条目（叠搜索范围，所见即所选；`operableInCurrentLane()` 口径不变）；**其他档勾选不动**
  （跨档保留契约不因全选被清空）。旧版「整体替换三类集合」的跨档清空语义废弃。
- 「全不选」`deselectOperable()`：仅清当前档勾选；已计划档集合变化同步 `pushImplScope()` 推送空范围。
- 「清空选择」与全不选同口径（仅清当前档；旧版三类跨档全清废弃）。
- 可用性：当前档无可操作条目禁用全选；当前档勾选 0 禁用全不选；任一批量进行中两者均禁用（防误触）。

### 4. 去掉勾选蓝边框

- 删除 `scripts/web/style.css` 的 `.req-row.selected { border-color: var(--primary) }` 规则与
  `app.js` 三处 `classList.toggle('selected', …)`——勾选反馈只保留复选框打勾态（手动勾选与全选一致）。

### 5. 「批量完善」按钮移出选择工具条

- REQ-20260908-020 起批量完善面向已接受未完善单、与勾选无关，不参与按档工具条；入口收敛为
  任务模块「批量完善」面板与已接受行 / 详情页完善徽标（`gotoRuns('refine')` 均保留）。

### 待确认项的落地决策（对齐 README 目标行为与 ui-demo.html 口径）

| 待确认 | 决策 | 依据 |
| ---- | ---- | ---- |
| 切档是否清残留勾选 | 保留（仅隔离展示/计数/操作） | BUG-20260907-016 契约不回退；README 目标行为 |
| 批量完善按钮位置 | 移出工具条 | 与勾选无关；入口在任务模块 + 完善徽标 |
| 手动勾选是否也去边框 | 一律不加边框 | ui-demo 默认口径「勾选一律不加边框」 |
| 批量驳回是否二次确认 | 保留确认 | 对齐 moveToPlan / removeFromPlan 既有批量交互 |

### 影响面

- `scripts/web/index.html`（#selectionBar、#selectOperable/#selectNone）、`scripts/web/app.js`
  （state / syncAcceptance / syncImpl / syncPlan / selectOperable / deselectOperable / clearSelections /
  rejectToSubmitted / switchProject / 事件绑定）、`scripts/web/style.css`（删 .req-row.selected）。
- 无服务端改动（accepted → submitted 流转与完善中拦截均为 `scripts/lib/core.mjs` 既有能力）。
- 既有测试随新口径更新：accept-ui（A1/A13）、impl-entry-ui（E2/E3/E6/N1-N3/N5b）、
  plan-batch-move（U3/U7/U9）、refine-ui（R12-1/R12-5）；新增 selection-lane-scope（S1-S12）。

## 风险与边界

- 「全选」对当前档为替换语义（所见即所选）：搜索缩小范围后全选会取消范围外的当前档勾选——与
  REQ-20260907-009 一贯直觉一致；其他档勾选不受影响。
- 跨档保留契约不变：切档、全选、全不选、清空选择均不清其他档勾选；仅轮询资格剪枝（条目离开原状态）会移除。
- 工具条计数为 0 即整条隐藏（含批量进行中逐条消费完勾选的收尾瞬间），与旧版行为一致。
- `#selectOperable` id 保留（仅改文案/语义），外部书签或深链不受影响。
