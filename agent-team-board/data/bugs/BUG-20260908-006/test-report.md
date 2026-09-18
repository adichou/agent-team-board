# 测试报告 — BUG-20260908-006 “改为已计划”要改为“移入计划”

- 时间：2026-09-08T06:30:44.736Z
- 执行者：zcode-batch-015-01
- 测试框架：node:assert 静态契约/VM 模拟 DOM（scripts/tests/run-all.mjs）
- 覆盖率：100%

## 总结

统一文案：详情页按钮「➤ 改为已计划」改为「➤ 移入计划」（data-act=planned 契约不变），LANE_HINT/未入批次提示/详情未入计划 notice/批量开发空态（app.js）、batch.mjs 无候选提示、dev.md 与 SKILL.md 指引、batch-execution.md 活文档同步改称；新增 plan-wording.test.mjs（W1-W5 先红后绿），更新 planned-state S10、pending-alignment R5 断言；引入来源：REQ-20260908-010（引入文案）/REQ-20260908-018（暴露冲突并指派本 Bug，均经 atb list 核验）。全量 87 测试文件失败 0。

## 明细

（可粘贴命令输出、失败用例说明等）
