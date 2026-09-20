# 测试报告 — BUG-20260907-009 内置浏览器中触发 window.confirm 的操作冻结整页：单卡「✓ 接受」/批量接受/停止执行无可见弹窗

- 时间：2026-09-07T16:32:47.103Z
- 执行者：zcode-batch-009-01
- 测试框架：node:assert + vm 沙箱契约测试（confirm-dialog.test.mjs C1–C7）
- 覆盖率：92%

## 总结

新增页面内异步确认对话框 uiConfirm（Promise 化，复用 .modal 样式，Enter/Escape/遮罩/同屏互斥），替换三处冻结内置浏览器的同步 window.confirm（批量/单卡接受、流转按钮、停止执行）；app.js 不再有 window.confirm/alert/prompt 调用；新增 7 用例先红后绿，同步适配 accept-ui/confirm-lane/drawer-undo，npm test 68 文件全过；引入来源已归因（REQ-20260906-017/014/003）；M1 内置浏览器人工核验待确认

## 明细

（可粘贴命令输出、失败用例说明等）
