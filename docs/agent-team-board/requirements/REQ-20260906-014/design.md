# 设计 — REQ-20260906-014 详细页面的操作按钮不要二次确认，提供撤销按钮

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

详情页（`renderDrawer`）操作按钮经 `attemptTransition` / `acceptItems` 执行，两处都有
`window.confirm` 二次确认（app.js 旧 785/823 行）。确认弹窗打断操作节奏；本需求改为
「先执行、后撤销」。

## 方案

（技术选型、接口设计、影响面）

只改前端 `scripts/web/app.js` + `scripts/web/style.css`，不动后端状态机与 API。

1. **详情页专用入口 `drawerAction(id, to, label)`**：不弹 confirm，直接 POST
   `/api/item/:id/status`；`to === 'accepted'` 复用 `acceptItems([id], { skipConfirm: true })`
   （`acceptItems` 增加 `skipConfirm` 可选项，缺省 false，卡片/批量入口行为不变）。
   抽屉 `[data-act]` 按钮绑定从 `attemptTransition` 换绑 `drawerAction`。
2. **撤销映射 `ACTION_UNDO`**：合法回退边只有 done ↔ in-progress
   （core.mjs `TRANSITIONS`：`done → in-progress` 是唯一回退边，REQ-20260903-001 已冻结）。
   - 确认完成（→ done）成功后 toast 带「撤销」，撤销 = 再 POST `in-progress`（等同人工驳回）；
   - 驳回完成（→ in-progress）成功后 toast 带「撤销」，撤销 = 再 POST `done`；
   - 接受（→ accepted）无回退边，不提供撤销，普通成功 toast。
   `attemptTransition`（拖拽换列路径）保持原 confirm 不变，不在本需求范围。
3. **toast 支持操作按钮**：`toast(msg, isErr, action)` 第三参可选
   `{ label, run }`；有 action 时以 `textContent` 组装文本 + `<button class="toast-act">`
   （无 innerHTML 注入面），点击后隐藏 toast 并执行 `run()`；自动隐藏时间 3200ms → 8000ms，
   给撤销留点击窗口。无 action 时行为与旧版完全一致（纯 `textContent`）。
4. **样式**：`.toast` 增加 flex 行布局与 `.toast-act` 按钮样式（描边反色，亮暗色沿用
   `currentColor`，不新增色板）。

## 风险与边界

- **撤销是状态机回退边，不是快照恢复**：确认完成的撤销等同人工「驳回完成」——认领锁已
  释放、owner/agentCompletedAt 会被清空（Agent 需重新认领）；驳回完成的撤销只回到 done，
  此前被清空的上报标记不恢复。与人工手动走反向边的结果一致，不引入新数据语义。
- 撤销有时效（toast 8 秒）且同一时刻只有一个撤销（新 toast 覆盖旧的）；过期或状态已被
  其他操作变更时，服务端按状态机拒绝，前端以错误 toast 提示，不假成功。
- 接受操作去掉确认后误点无法在界面回退（状态机无反向边）；接受本身无数据损失，误接受
  条目可被正常认领或忽略，权衡后接受（扩展状态机属设计层变更，超出本需求）。
- 拖拽换列、批量接受仍保留 confirm，行为与现状一致。
