# 测试报告 — REQ-20260907-012 已接受的需求或 Bug 不要在列表界面或详细内容界面显示已接受便签，应呈现是否已进入批次

- 时间：2026-09-07T23:37:33.511Z
- 执行者：zcode-batch-010-4
- 测试框架：node:test（vm 沙箱 + lib 单测 + 真实 server 集成）
- 覆盖率：100%

## 总结

已接受条目列表/详情不再显示「已接受」便签，改呈是否已进入批次：batch.mjs 新增 batchEntryIndex（未结束批次 candidates→最早批次）；/api/board 与 /api/item/:id 为 accepted 附加 batchEntry（null=未入批，非 accepted 不附加）；前端卡片与详情状态 chip 渲染「已入批次/未入批次」（悬停含批次号与批次状态），notice 按入批与否给指引，列表签名含 batchEntry 自动刷新；新增 accepted-batch-entry.test.mjs（L1-L6+S1-S2）先红后绿，npm test 73 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
