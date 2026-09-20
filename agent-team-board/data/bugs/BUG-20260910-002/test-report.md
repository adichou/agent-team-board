# 测试报告 — BUG-20260910-002 列表占太多空间，应该调整下，列表和详情页面占比应为 1:2

- 时间：2026-09-10T00:09:55.364Z
- 执行者：zcode-batch-029-2
- 测试框架：node:assert/strict + run-all
- 覆盖率：85%

## 总结

宽屏 .req-split 列宽由 minmax(0,1fr) minmax(0,460px) 改为 minmax(0,1fr) minmax(0,2fr)：列表:详情恒定 1:2 随视口伸缩，详情不再 460px 锁死；讨论模块复用同规则同步生效；裁定超宽不设上限、讨论同步 1:2；TDD 先红后绿同步 confirm-lane T7 / portrait-board P4 / layout T6 契约；npm test 129 文件全过；归因 REQ-20260907-004

## 明细

（可粘贴命令输出、失败用例说明等）
