# 测试报告 — REQ-20260907-007 删除详细页面的一键派单功能，派单只能通过批量实施

- 时间：2026-09-07T15:22:16.010Z
- 执行者：zcode-batch-009-1
- 测试框架：node:assert + 自建 runner（npm test/run-all.mjs）
- 覆盖率：100%

## 总结

删除详情页一键派单：app.js 移除 dispatchBtnHtml/dispatchPrompt/launchZcode/launchCodex/flashDispatchBtn 及 data-dispatch 绑定（保留 copyDispatchText 供批量实施）；server.mjs 移除 POST /api/dispatch/codex/item 端点与未用 dispatch import；scheduler.mjs 移除 dispatchItem（tick/startRunForItem 自动派发不受影响）；style.css 移除 .dispatch-row/.dispatch-btn。契约测试改写为已移除防回归，全量 65 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
