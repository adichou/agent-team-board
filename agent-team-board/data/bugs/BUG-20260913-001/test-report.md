# 测试报告 — BUG-20260913-001 版本创建时应该允许关联的需求范围是已完成的需求或 bug，其他都不应该出现在这个范围内。

- 时间：2026-09-13T09:10:23.551Z
- 执行者：zcode-batch-044-01
- 测试框架：node:assert/strict + 子进程 HTTP 集成 + 前端 vm 行为测试（scripts/tests/run-all.mjs 聚合）
- 覆盖率：90%

## 总结

候选范围收窄为仅 done 条目：/api/build/candidates 后端过滤，创建/添加条目接口对非 done 拒绝（400 带原因）；前端 doneCandidates 双重过滤 + 无候选空态提示，两面板口径一致；全选仅纳入有 commit 的 done 条目。新增 8 用例 TDD 红→绿，全量 211 测试文件失败 0。

## 明细

（可粘贴命令输出、失败用例说明等）
