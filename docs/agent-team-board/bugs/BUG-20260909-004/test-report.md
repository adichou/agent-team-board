# 测试报告 — BUG-20260909-004 不要在列表的每个单的后面加上状态显示

- 时间：2026-09-09T01:11:48.462Z
- 执行者：zcode-batch-019-1
- 测试框架：node:assert 契约测试（vm 沙箱）+ npm test 全量回归
- 覆盖率：100%

## 总结

需求模块六档列表行统一去除与档位重复的状态 chip：reqRowEl 删除 <span class="state…"> 拼接（原仅 planned 豁免，现六档 REQ/BUG 同口径），同步删除失去引用的 .req-row .state 样式；顶部筛选条、行悬停 LANE_HINT、详情状态字段与上报横幅保留，完善徽标/模型配置提示不动。TDD 先红后绿：planned-chip-dedup T2 反转为六档去重并新增 T2b 样式清理，card-flag-dedup T1–T3、confirm-lane T3/T8、req-filter-removed T5、accepted-batch-entry L1–L3 行级断言同步反转（红 11 例）；引入来源归因 REQ-20260907-004（atb list 核验）。npm test 104 个测试文件全部通过。

## 明细

（可粘贴命令输出、失败用例说明等）
