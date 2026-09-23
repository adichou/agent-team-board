# 测试报告 — BUG-20260923-004 AI  翻译的 README_en.md 中 AGENTS.md 的超链接文本不对

- 时间：2026-09-23T16:30:08.216Z
- 执行者：zcode-batch-worker-01
- 测试框架：node:test 风格自研断言（node scripts/tests/run-all.mjs）
- 覆盖率：100%

## 总结

AI 翻译提示词补「链接重定向只改目标、链接文本保持基准原文」约束（buildDocTranslatePrompt 翻译约束节，示例随首个剩余语言动态生成）；README_en.md 第 13 行 AGENTS 链接文本 AGENTS_en.md→AGENTS.md（根第一层发布文档，差异留工作区）。引入来源 REQ-20260921-012。新增 bug-20260923-004 测试 4 用例先红后绿，全量 342 文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
