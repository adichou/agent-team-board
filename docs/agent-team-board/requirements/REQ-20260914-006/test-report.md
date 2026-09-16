# 测试报告 — REQ-20260914-006 构建合并策略结论纪要：不采用 rebase，保留逐条 --no-ff 合并，main 观感用 --first-parent 解决

- 时间：2026-09-15T01:37:11.070Z
- 执行者：zcode-batch-048-031
- 测试框架：none
- 覆盖率：0%

## 总结

决策归档纪要，无代码改动：已核实 README 全部事实依据——mergeCommitsIntoMain 逐条 --no-ff 合并及消息模板（build-git.mjs:224）、BLD-20260914-001 共 288 条目其中 250 条指向提交 6f2ead6、main 上 28 个 build: 合并提交、git log --first-parent main 压平阶梯。结论维持不改代码，验收标准 1/2 满足，标准 3 为归档引用待人工确认。

## 明细

（可粘贴命令输出、失败用例说明等）
