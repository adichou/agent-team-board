# 测试报告 — BUG-20260907-012 run receipt 用法提示与实现不符：--report-ref 被标为可选，实际 reported 回执必填

- 时间：2026-09-07T16:49:17.281Z
- 执行者：zcode-batch-009-1
- 测试框架：node:test
- 覆盖率：100%

## 总结

run receipt 用法提示与实现对齐：atb.mjs 主 USAGE 与 BATCH_USAGE 拆为 reported 必带 --report-ref / blocked|failed 必带 --reason 两行；finishRun 报错追加修正命令示例；SKILL.md 速查同步必填呈现；新增 receipt-usage-hint.test.mjs（H1–H4），npm test 70 文件全通过

## 明细

（可粘贴命令输出、失败用例说明等）
