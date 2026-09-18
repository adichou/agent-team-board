# 设计 — REQ-20260908-018 已接受列表要要支持批量移入计划

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

accepted → planned 的单条人工排期入口已存在（REQ-20260908-010：详情抽屉
「改为已计划」+ 服务端流转边 + 守卫人工专属）。本需求把该操作升级为列表级
批量操作，交互与「批量接受 acceptItems」「批量移出计划 removeFromPlan」同构。

## 方案

纯前端改动（scripts/web/app.js + scripts/web/index.html），服务端零改动
（`/api/item/<ID>/status` accepted→planned 边与守卫均已就绪）。

1. **新选择桶 `state.plan`**（app.js state 初始化 + `switchProject` 重置）：
   `{ selected: Set, pending, message, failures[] }`，与 `state.acceptance`
   （submitted）、`state.impl`（planned）并列；勾选资格 = 已接受条目，跨档保留、
   叠搜索只作用可见行（对齐 `submittedItems`/`implCandidates` 的
   BUG-20260907-016 契约）。
2. **行复选框**：`reqRowEl(it)` 为 accepted 行渲染 `data-plan-id` 复选框，
   click 阻止冒泡（不打开详情），change 写入/移出 `state.plan.selected`。
3. **同步函数 `syncPlan(notify)`**：轮询剪枝失效勾选（notify=true 时 toast）、
   回写复选框 checked/disabled 与行 selected 类，末尾调 `syncAcceptance()`
   刷新工具条合并计数；`renderBoard` 在 `syncImpl()` 后追加调用。
4. **`syncAcceptance` 升级**：合并计数
   `已选 N 项（待接受 X · 已接受 Y · 已计划 Z）`；新增 `#planAdd` 按钮态
   （N=0 或 pending 禁用；pending 显示「移入中…」）；结果区 #acceptResult
   合并 plan 的 message/failures。
5. **批量执行 `moveToPlan(ids, {skipConfirm})`**：镜像 `removeFromPlan`——
   资格过滤 → 页面内 uiConfirm 二次确认 → 逐条 POST `{to:'planned'}`（绑定
   当前项目，`state.plan !== m` 检测切项目中断）→ 逐条进度 message →
   完成 message + toast → `poll()` 刷新；单项失败记入 failures 不回滚整批；
   finally 复位 pending 并 `syncPlan(false)`。
6. **全选/清空**：`operableInCurrentLane()` 加入 `planCandidates()`；
   `selectOperable()` 三桶分发（submitted→acceptance、accepted→plan、
   其余→impl）；`#clearSelection` 同时清空 plan 勾选。
7. **index.html**：#selectionBar 在「接受所选」后新增
   `#planAdd`「移入计划」按钮（btn primary，带 title 说明）；
   `#selectOperable` title 更新为「待接受 / 已接受 / 已计划」。

### 明确不做

- 不改 `drawerActionsButtonHtml` 的「改为已计划」文案——改名归属 BUG-20260908-006。
- 不改批量开发候选口径（仍 planned 未认领）、不改状态机/守卫/服务端。
- 不做跨档混选执行（三类勾选各自独立按钮，与现状一致）。

### 影响面

- `scripts/web/app.js`：state、switchProject、reqRowEl、renderBoard、
  syncAcceptance、operableInCurrentLane/selectOperable、新增
  planCandidates/syncPlan/moveToPlan、事件绑定区。
- `scripts/web/index.html`：#selectionBar、#selectOperable title。
- 既有断言演进：impl-entry-ui.test.mjs 中 3 处合并计数文案断言随新格式更新
  （`已选 N 项（待接受 X · 已接受 Y · 已计划 Z）`），其余用例不动。
- 新测试：`scripts/tests/plan-batch-move.test.mjs`。

## 风险与边界

- **合并计数文案变更**会触碰依赖精确文案的既有断言（仅 impl-entry-ui 3 处），
  已同步演进；accept-ui 的前缀式断言不受影响。
- **已入批次未派发的已接受单**也可批量移入计划：与详情页单条按钮同口径
  （批次实时队列本就支持后置计划的单，planned-state S6 已验证），无新风险。
- **并发窗口**：确认后某单已被并行流转 → 服务端状态机 403/报错进 failures
  分列反馈，不回滚整批（与批量接受/移出计划一致）。
- **撤销**：批量移入计划不做整批撤销；单条可用详情页「移出计划」回退
  （ACTION_UNDO 已有 planned→accepted 边）。

## 实施记录

- TDD：test-cases.md 用例 1-9 → scripts/tests/plan-batch-move.test.mjs 先跑红，
  实现后跑绿；全量 `npm test` 回归通过。
