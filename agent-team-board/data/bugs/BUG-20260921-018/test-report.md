# 测试报告 — BUG-20260921-018 隔离分析误判已在 main 的共享提交为混合提交，合并被误阻断

- 时间：2026-09-21T15:46:21.035Z
- 执行者：BUG-20260921-018
- 测试框架：node:assert/strict + 临时 git 仓库分层口径
- 覆盖率：92%

## 总结

隔离分析豁免已在目标分支上的共享提交：analyzePublishIsolation 对 isAncestorOf 为真的共享 hash 不列入 blocked，降级 exempted+notes 豁免提示（与执行侧 alreadyIncluded 幂等同口径）；不在目标分支的共享 hash 维持阻断文案不变。server publish-plan 透传 exempted；合并页新增单行豁免提示（非 alert、title 明细）并同步 i18n 中英动态词条。TDD：新增 bug-20260921-018.test.mjs 4 例先红后绿；req-20260920-003 L3-4 拆为 L3-4a/b。真实场景复核 BLD-20260920-001（341 条目）blocked 1→0（6f2ead6009aa 豁免、关联 250 条目），合并误阻断解除。全量 npm test 本单相关全绿；仅 req-20260918-002 / req-doc-entry 两文件因 REQ-20260921-005 未提交 README/AGENTS 改写而红（clean HEAD 验证通过，与上单报告同因，非本单引入）。

## 明细

（可粘贴命令输出、失败用例说明等）
