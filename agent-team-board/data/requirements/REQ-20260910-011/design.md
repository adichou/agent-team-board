# 设计 — REQ-20260910-011 去掉接受、驳回待接受和加入计划，移出计划等二次提示框，意义不大，因为可以撤销

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260906-014 已为详情页操作按钮建立「免二次确认 + toast 撤销」范式（`drawerAction` /
`undoActionFor`，toast 撤销按钮停留 8 秒）。但接受（卡片「✓ 接受」、工具栏「接受所选」）、
移入计划、驳回待接受、移出计划四个可回退流转仍有二次确认弹窗（`uiConfirm`）。四个操作的反向
操作在界面上始终可用（`core.mjs` TRANSITIONS 人工回退边 + `ACTION_UNDO` 映射），确认框收益有限。

## 方案

（技术选型、接口设计、影响面）

- **去掉确认**：`acceptItems` / `moveToPlan` / `rejectToSubmitted` / `removeFromPlan`（均在
  `scripts/web/app.js`）整体移除 `uiConfirm` 调用与 `skipConfirm` 参数（确认既然不再存在，免确认
  开关一并退役）；进度反馈、资格过滤、成功/失败分列、防重入与项目切换中止逻辑均不动。
- **单条入口带撤销**：四函数新增 `single` 选项（卡片「✓ 接受」与详情页 `drawerAction` accepted
  分支传入）。单条成功时 toast 由批量文案改为「✓ {单号} 已接受 / 已移出计划」并附「撤销」按钮
  （8 秒窗口，对齐 REQ-20260906-014）；批量入口仍为批量文案、无撤销按钮（批量误操作按 README
  用反向批量操作回退，批量 toast 撤销为待确认的可选增强，不实现）。
- **撤销动作复用**：拆出 `undoActionTo(id, undoTo)`（原 `undoActionFor` 内联逻辑），因「接受」与
  「移出计划（planned → accepted）」目标同为 accepted 但回退目标不同（submitted / planned），
  需显式传回退目标；`undoActionFor(id, to)` 改为按 `ACTION_UNDO` 映射委托。
- **补撤销边**：`ACTION_UNDO` 增加 `submitted → accepted`（撤销「驳回接受」= 重新接受），详情页
  「驳回接受」成功 toast 由此获得撤销；映射边与 `core.mjs` TRANSITIONS 保持一致（测试断言）。
- **保留确认**：`deleteItem`（删除待接受条目，看板层面不可恢复）danger 确认原样保留并加防回归
  断言（单号 + 标题 + 不可恢复说明、取消零请求、成功 toast 无撤销）。删除批次 / 终止批量完善 /
  终止批量开发 / 停止执行 / 项目面板移出等确认框零改动，静态断言防回归。
- **遗留边界**：`attemptTransition`（拖拽换列路径，随 REQ-20260907-004 已无调用方）按 README
  边界说明保留不动，其 accepted 目标自然复用免确认的批量函数；是否清理不影响验收，留待后续。
- **测试**：新增 `scripts/tests/no-confirm-undo-20260910-011.test.mjs`（N1–N9）；同步更新断言旧
  确认契约的 6 个既有测试（accept-ui A3/A4、confirm-dialog C4、drawer-undo T2/T4/T6、
  pending-accept-inline T3、plan-batch-move U4/U6、selection-lane-scope S4）。
- **影响面**：仅 `scripts/web/app.js` 与上述测试；无服务端 / 状态机 / 样式改动。

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

本条目自研理由：无合适库——改动是对既有 `uiConfirm`/`toast`/`ACTION_UNDO` 既有范式的定向收窄与复用
（删调用 + 传撤销目标），不引入任何新依赖，无对应开源库可替代；未创建 licenses.md。

## 风险与边界

- 误操作风险由撤销窗口（8 秒）与反向操作覆盖；超窗或状态已变时撤销按服务端状态机拒绝，错误
  toast 如实提示（既有 `undoActionTo` 行为，N5 覆盖），不出现假成功。
- `single` 仅在「恰一条且全部成功」时切换文案并附撤销；混入失败或多条仍走批量文案，避免部分
  成功时给出误导性的单条撤销。
- `state.acceptance.message` / `state.impl.message` 单条文案变化影响工具栏结果区展示口径，
  相关既有测试已同步更新。

