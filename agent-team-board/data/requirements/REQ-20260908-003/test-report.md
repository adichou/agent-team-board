# 测试报告 — REQ-20260908-003 支持待接受的需求删除

- 时间：2026-09-08T01:38:48.175Z
- 执行者：zcode-batch-011-1
- 测试框架：node:assert 单测 + node:http 真实服务集成 + UI 静态/沙箱契约（scripts/tests/item-delete.test.mjs，10 用例）
- 覆盖率：100%

## 总结

core.deleteItem 仅删 submitted（需求/Bug；有下属 Bug 先拒并指引）+ server DELETE /api/item/:id（受既有跨站防护）+ 网页卡片/详情页删除按钮（页面内 danger uiConfirm，删后刷新并关抽屉）+ CLI atb delete；单号计数器不回退；全量回归 78 文件通过

## 明细

（可粘贴命令输出、失败用例说明等）
