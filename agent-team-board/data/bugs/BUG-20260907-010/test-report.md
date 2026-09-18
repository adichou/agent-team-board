# 测试报告 — BUG-20260907-010 已上报条目卡片显示两个「待确认」标记；已完成条目仍残留「待确认」chip 与「请人工确认」横幅

- 时间：2026-09-07T16:38:53.556Z
- 执行者：zcode-batch-009-01
- 测试框架：node:assert + npm test（run-all 聚合）
- 覆盖率：100%

## 总结

卡片去重：reqRowEl 移除 testFlagHtml 角标（lane 状态 chip 已显示待测试，叠加即重复）；角标保留于详情抽屉头部与下属 Bug 列表；done 残留（现象2）已由 REQ-20260907-005 先行收敛，本次以 T3/T4 回归锁定；同步调整 confirm-lane.test.mjs T8 断言；新增 card-flag-dedup.test.mjs（T1 先红后绿）；全套 69 个测试文件通过；引入来源 REQ-20260906-013（已 atb list 核验）

## 明细

（可粘贴命令输出、失败用例说明等）
