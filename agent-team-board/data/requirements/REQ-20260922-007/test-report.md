# 测试报告 — REQ-20260922-007 AI 开发过程中忽略文档的编写差异，不要提交文档到 git。文档有另外的流程提交

- 时间：2026-09-22T17:09:59.715Z
- 执行者：zcode-batch-064-3
- 测试框架：node:assert（atb 既有测试 runner，req-20260922-007.test.mjs 9 例）
- 覆盖率：未统计

## 总结

开发收口提交忽略条目文档编写差异：autoCommitForRun 归因把本单条目目录（非 R 码、非留痕出库）文档差异记入 ignoredDocs 不提交、保留在工作区走文档讨论轮/人工通道；板级共享（迁移搬移/留痕出库/看板共享文件）仍随 doc 组收纳；仅文档改动收口 skipped 不挂起不误报 committed（commitIncompleteReason 视为完整）；回执与 auto-commit.json 明细如实携带 ignoredDocs；AGENTS.md/SKILL.md/dev-closeout.md 表述同步；新增 req-20260922-007.test.mjs 9 例（先红后绿），同步 4 个既有测试到新口径，npm test 335 文件全过

## 明细

（可粘贴命令输出、失败用例说明等）
