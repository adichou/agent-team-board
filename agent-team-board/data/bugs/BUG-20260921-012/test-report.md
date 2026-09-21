# 测试报告 — BUG-20260921-012 语言集移到文档编写三阶段的右侧对齐

- 时间：2026-09-21T09:00:13.025Z
- 执行者：zcode-batch-060-2
- 测试框架：node:test（node:assert 分层用例）
- 覆盖率：90%

## 总结

语言集控件移入文档编写标题行右侧：build.js renderDocsPane 新增 .bld-docs-titlebar（左标题+右语言集同行对齐），langsField 不再拼在 .bld-docs-sub 后独占一行；style.css 副标题条改纵向布局、语言集簇去独立行 padding、hint/行内错误右对齐换行；输入框 id/data-pf-langs/禁用口径/保存中/行内错误/title 全保留，i18n 词典零改动；新增 bug-20260921-012.test.mjs 7 例（先红后绿），npm test 309 文件全通过；引入来源归因 REQ-20260921-010

## 明细

（可粘贴命令输出、失败用例说明等）
