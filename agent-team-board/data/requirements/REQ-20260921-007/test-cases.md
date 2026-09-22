# 测试用例 — REQ-20260921-007 发布模块的 AI 写作改成 AI 总结，并优化提示词显示布局

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 正式发布步第二步标题为「第二步 · 官网 AI 总结」；`scripts/web/build.js` 与 `scripts/web/i18n.js` 全文无「AI 写作」残留 | P0 | 通过（build.js 全文无残留；i18n.js 键字面量无残留，历史注释保留更名记录） |
| 2 | i18n 新键中英齐备：`EN['官网 AI 总结'] === 'Website AI summary'`、`EN['第二步 · 官网 AI 总结'] === 'Step 2 · Website AI summary'`；旧键「官网 AI 写作」「第二步 · 官网 AI 写作」已清理；全词典值无「AI writing」 | P0 | 通过 |
| 3 | 提示词预览默认折叠：`renderDocsPane` 中 AI 总结 / AI 翻译两个 `<details class="bld-docs-prompt-box">` 均不带 `open` 属性；「复制提示词」按钮（data-pf-copy-prompt / data-pf-copy-tprompt）仍存在 | P0 | 通过 |
| 4 | 回归：文档编写步（renderDocsPane）内无「AI 写作」文案（008 既有口径不回退）；任务模块 AI 总结页签、全局 summary 类型与 `sum-` 前缀兜底仍在（app.js 静态契约） | P1 | 通过 |
| 5 | 既有测试同步后全量通过：req-20260921-008（更名与官网键断言更新）、req-20260920-003（官网文案断言更新）、i18n 系列（coverage/dict/lang/runtime）不回退 | P0 | 通过（三者全绿；全量 330 文件中 2 个失败为文档阶段对根 README/AGENTS 的未提交改写所致的既有失败——req-20260918-002、req-doc-entry-20260916-003，与本单改动无关，待文档阶段审核提交时一并处理） |
