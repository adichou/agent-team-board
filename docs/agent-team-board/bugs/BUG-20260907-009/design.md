# BUG-20260907-009 实施记录（design）

## 根因

`scripts/web/app.js` 三处同步 `window.confirm`（批量/单卡接受 `acceptItems`、流转按钮
`attemptTransition`、停止当前执行 `#cxStopCurrent`）。ZCode 内置浏览器（IAB）不渲染原生
对话框且 JS 对话框挂起时阻塞渲染主线程：点击后 2 秒轮询停摆、自动化 click/screenshot 超时，
表现为整页冻结。

引入来源（`atb show` 核验）：REQ-20260906-017（批量接受确认）、REQ-20260906-014（保留卡片/
换列路径确认）、REQ-20260906-003（停止执行按钮确认）。

## 方案

新增页面内异步确认对话框，替代全部同步原生对话框调用：

- `uiConfirm({ title, message, confirmText, cancelText, danger })` → `Promise<boolean>`；
  动态构建 DOM（`.modal-wrap.confirm-wrap` 覆盖层 + `.modal.confirm-box`），样式复用现有
  `.modal-wrap/.modal/.modal-foot/.btn`，仅新增 `.confirm-title/.confirm-message/.btn.danger`。
- 交互：确认/取消按钮、点遮罩空白取消、Enter 确认 / Escape 取消（capture 监听，关闭即解绑）、
  打开后聚焦确认按钮（键盘可达）；正文 `white-space: pre-line` 支持多行条目列表；
  同屏互斥（`confirmActive`）：新确认自动取消未决旧框。
- 三处调用点替换为 `await uiConfirm(...)`：批量接受（确认文案含条目数 + 逐行列表）、
  流转按钮（确认按钮文案 = 动作名）、停止执行（danger 红色确认按钮，保留原说明文案）。
- `skipConfirm`（REQ-20260906-014 详情页免确认路径）语义不变。

## 测试

- 新增 `scripts/tests/confirm-dialog.test.mjs`（C1–C7）：静态契约（无 window.confirm/alert/prompt
  调用）、uiConfirm 单元契约（构建/确认/取消/遮罩/清理/键盘/互斥）、acceptItems 与
  attemptTransition 集成（取消不发请求、确认才 POST、skipConfirm 不弹框）、停止入口静态契约、
  CSS 契约。TDD 先跑红（7/7 红）后实现转绿。
- 同步更新既有测试适配异步确认：`accept-ui.test.mjs`（uiConfirm stub + A5/A9 微任务 flush）、
  `confirm-lane.test.mjs`（T4 stub）、`drawer-undo.test.mjs`（T4/T6 断言改 uiConfirm）。
- 全量 `npm test`：68 个测试文件失败 0。
- M1（内置浏览器人工核验三入口不冻结）留待人工确认，外部浏览器行为未验证的局限保留在 README。
