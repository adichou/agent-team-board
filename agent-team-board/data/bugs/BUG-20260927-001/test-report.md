# 测试报告 — BUG-20260927-001 项目根目录的README.md 等文档所引用的图片在文档审核通过后也需要一并提交

- 时间：2026-09-27T11:04:51.858Z
- 执行者：zcode-batch-080-1
- 测试框架：node:assert/strict 子进程契约（run-all.mjs 聚合）
- 覆盖率：100%

## 总结

发布文档豁免口径补图片通道（方案：按引用路径静态解析，见条目 design.md）：state-guard 从豁免发布文档正文解析被引用本地图片集合（仅相对路径+图片扩展名+不入源码/agent-team-board 目录），提交侧 pathspec 允许「文档+图片一并」与「图片配套」提交（主题仍过 validateCommitSubject），写入侧无锁改写同口径豁免；未引用图片、源码/看板数据夹带、裸提交、--amend、glob/magic pathspec 依旧拦截。引入来源：REQ-20260918-002（经 atb list 核验），REQ-20260923-001 延续口径。新增 scripts/tests/bug-20260927-001.test.mjs 先红后绿，npm test 363 个测试文件全量通过。

## 明细

（可粘贴命令输出、失败用例说明等）
