# 设计 — REQ-20260909-007 在已接受和已计划界面分别添加开始完善和开始开发快捷按钮

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

需求模块六档筛选条下，用户在「已接受」档想启动批量完善、在「已计划」档想启动批量开发时入口不直接：
批量完善只剩任务模块子面板与完善三态徽标（徽标首要语义是展示状态）；批量开发的列表头入口
（原 `#implGo`「进入批量开发」）挂在右组批量操作条内，零勾选时右组整体隐藏。本需求在两个档位
列表头左组各加一个**常驻、与勾选无关、仅导航**的快捷按钮。

### 现状差异澄清（README 现状依据的时点偏移）

README「现状依据 / 交互行为 §2」按 BUG-20260909-006 之前的代码撰写：彼时存在 `#implGo` 按钮与
`enterBatchImpl` / 勾选范围推送链路（`scopeActive` + `/api/dispatch/scope` + 面板 `?ids=` 收窄）。
BUG-20260909-006 已将「进入批量开发」入口与勾选范围链路**整体移除**——批量开发入口唯一收敛任务模块，
口径恒为已计划队列（最旧优先），已计划档勾选仅为「移出计划」服务；现有
`scripts/tests/impl-entry-ui.test.mjs` E1 静态断言禁止这些符号回流。因此：

- 「开始开发」的行为对齐目标 = `gotoRuns('develop')`（任务模块「批量开发」子面板，当前唯一入口的等价跳转）；
  **无勾选范围语义**。README 验收「『开始开发』行为与『进入批量开发』一致」按「与任务模块批量开发子面板一致」解释，
  「已有勾选沿用范围」子句随 BUG-20260909-006 的口径演进而自然失效（勾选不再影响批量开发范围）。
- 「开始完善」不受影响：`gotoRuns('refine')` 与 README 口径一致。

## 方案

（技术选型、接口设计、影响面）

**纯前端改动，零后端 / 状态机影响**：`scripts/web/index.html` + `scripts/web/app.js`，不新增 API、
不改任何 status.json，批量完善 / 批量开发的创建、领取、回执协议全部不变。

1. **单按钮元素按档变形**（而非两个按钮）：`#reqCaption` 左组 `.caption-left` 末尾、「全不选」之后
   新增 `<button type="button" id="laneQuickEntry" class="btn small primary hidden">`，初始隐藏；
   `syncAcceptance()` 按当前筛选档切换显隐 / 文案 / title / aria-label：
   - 已接受档：`▶ 开始完善`，title「进入任务模块批量完善面板：对已接受未完善条目批量补全文档（与勾选无关）」；
   - 已计划档：`▶ 开始开发`，title「进入任务模块批量开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务」
     （措辞避开「启动批量开发」子串，`tasks-panel-26.test.mjs` K1 静态断言 REQ-20260908-026 口径）；
   - 其余四档（待接受 / 开发中 / 待测试 / 已完成）隐藏。
2. **显隐同步挂在 `syncAcceptance()`**：该函数由 `renderBoard()` 每轮调用（切档 chips 点击、轮询刷新均经过），
   只改控件态不重建容器（沿用 REQ-20260909-002「计数更新不重建列表头」机制），轮询不闪烁、不打断交互；
   文案 / title 先比对再赋值，避免无效 DOM 写入。
3. **点击绑定**（事件绑定区，`#selectNone` 绑定之后）：
   `$('#laneQuickEntry')?.addEventListener('click', () => gotoRuns(state.reqFilter === 'accepted' ? 'refine' : 'develop'))`。
   按钮仅在已接受 / 已计划档可见，三元分支安全；纯导航——不创建任务、不弹确认、幂等（重复点击仅重复拉取面板数据）。
4. **常驻可用性**：与勾选、右组显隐、`anyBatchPending()` 四路批量进行中均解耦（`disabled` 恒 false）；
   任务创建仍由面板内「启动」承接（未显式选择执行 Agent 时启动禁用，BUG-20260908-016 口径不变）。
5. **样式与可达性**：复用现有 `.btn.small.primary`（主操作观感，与 `quiet` 的全选 / 全不选明显区分；
   右组仅在勾选时出现，无视觉冲突）；`type="button"` 原生按钮可 Tab 聚焦 / 回车触发；`aria-label` 随档同步；
   窄屏 ≤1020px 沿用 `.caption-left { flex-wrap: wrap }` 自然换行，无需新增 CSS（style.css 零改动）。

### 待确认两项的结论（README「待确认」节）

- **不带候选计数**：纯文案「▶ 开始完善 / ▶ 开始开发」。计数与完善三态徽标、任务面板候选队列已有重叠，
  且右组本身有「已选 N 项」计数，再加计数增加噪音、扩大轮询重渲染面。
- **样式档位取 primary**：见方案 5。

## 风险与边界

- **与既有静态断言的碰撞已排除**：app.js 全文不得出现 BUG-20260909-006 移除符号
  （`implGo` / `enterBatchImpl` / `pushImplScope` / `scopeActive` / `/api/dispatch/scope`）与
  REQ-20260908-026 的「启动批量完善 / 启动批量开发」子串，本实现注释与 title 措辞均已规避并由新增测试 Q1 守护。
- **右组口径不回退**：快捷按钮在左组常驻，右组 `#selGroup` 按钮文案不含「开始完善 / 开始开发 / 批量完善」
  （右组按钮 title 提示语可合法提及这些词，测试按按钮可见文案断言）。
- **现有入口全部保留**：完善三态徽标 `data-goto-refine` 跳转、任务模块子面板 tab（`data-bmode`）、
  右组既有四按钮不受影响（全量回归 113 个测试文件通过）。
- **边界**：按钮不做候选预判、空态不禁用（与完善徽标点击行为一致）；面板数据拉取失败走现有 toast，
  不影响按钮显隐。

## 实施记录

- 测试：`scripts/tests/lane-quick-entry-20260909-007.test.mjs`（Q1-Q6，vm 模拟 DOM 模式，沿用
  selection-bar-merge.test.mjs 模式；点击行为经绑定切片后真实触发 `gotoRuns` 验证 fetch 序列）。
  TDD：先跑红（Q1-Q4 失败）→ 实现后 6/6 跑绿。
- 代码：`scripts/web/index.html`（左组新增 `#laneQuickEntry` 按钮）、`scripts/web/app.js`
  （`syncAcceptance()` 快捷入口同步块 + 事件绑定区点击绑定）；`style.css` 无改动。
- 回归：`npm test` 113 个测试文件全部通过（期间修复一处自伤：已计划档 title 初稿含「启动批量开发」
  子串触发 tasks-panel-26 K1 静态断言，已改写措辞）。
- 2026-09-09 实施于批次 batch-20260909-020（run-20260909-119，owner zcode-batch-020-01）。
