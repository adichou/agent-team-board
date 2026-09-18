# BUG-20260907-009 测试用例

方案：新增页面内异步确认对话框 `uiConfirm({ title, message, confirmText, cancelText, danger })`
（返回 `Promise<boolean>`，动态构建 DOM、不阻塞主线程），替换 app.js 三处同步 `window.confirm`
（批量/单卡接受 `acceptItems`、流转按钮 `attemptTransition`、停止当前执行 `#cxStopCurrent`）。
样式复用现有 `.modal-wrap`/`.modal`/`.modal-foot`/`.btn`，新增确认框专属类。

| 编号 | 类型 | 用例 |
| ---- | ---- | ---- |
| C1 | 自动 | 静态契约：`app.js` 全文不再出现 `window.confirm` / `window.alert` / `window.prompt`；存在 `uiConfirm` 定义 |
| C2 | 自动 | `uiConfirm` 对话框契约：动态构建 `.confirm-wrap` 覆盖层 + `.confirm-box`；标题/正文/确认与取消按钮文案来自参数；点确认 resolve(true)、点取消 resolve(false)；点击遮罩空白处取消；关闭后 overlay 节点移除且 keydown 监听解绑 |
| C3 | 自动 | 键盘与互斥：Enter 确认、Escape 取消；已有确认框未决时再次调用 `uiConfirm`，旧框自动取消（resolve false）且只保留一个覆盖层 |
| C4 | 自动 | 批量/单卡接受集成：`acceptItems`（未 skipConfirm）先弹页面内确认，点确认后才逐条 POST `/status`；点取消不发任何请求；skipConfirm 路径不弹框直接 POST |
| C5 | 自动 | 流转按钮集成：`attemptTransition` 确认后 POST 目标状态；取消不发请求 |
| C6 | 自动 | 停止执行入口（静态）：`#cxStopCurrent` 处理器改用 `await uiConfirm(...)`（danger 确认按钮），不再 `window.confirm` |
| C7 | 自动 | CSS 契约：`.confirm-message` 支持多行 ID 列表（`white-space: pre-line`）；`.btn.danger` 危险确认按钮样式存在 |
| M1 | 人工 | ZCode 内置浏览器实测：三入口点击后出现页面内对话框，主线程不冻结、2 秒轮询不停摆，确认/取消行为正确 |
