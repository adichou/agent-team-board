# 测试报告 — BUG-20260908-024 已计划界面中的单子不需要再显示已计划标签了

- 时间：2026-09-08T18:06:01.096Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert vm 契约测试（planned-chip-dedup 4/4）+ 全量 run-all 100 文件回归
- 覆盖率：100%

## 总结

reqRowEl 对 lane=planned 分支收敛：已计划档内卡片不再渲染与档位重复的「已计划」chip；行悬停 LANE_HINT 与详情抽屉状态字段保留状态语义，其余五档 chip 不变。新增 scripts/tests/planned-chip-dedup.test.mjs（T1 跑红复现→修复跑绿，T2-T4 回归护栏）；README 验收指定的 planned-state/impl-entry-ui/accepted-batch-entry/card-flag-dedup 四套及全量 run-all 100 个测试文件全部通过。引入来源归因 REQ-20260908-010（经 atb list 核验），已写入 design.md 引入来源节与 README 头部行。

## 明细

（可粘贴命令输出、失败用例说明等）
