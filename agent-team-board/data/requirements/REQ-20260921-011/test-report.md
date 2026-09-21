# 测试报告 — REQ-20260921-011 发布模块的文档预览要支持 Markdown 格式预览

- 时间：2026-09-21T05:21:55.329Z
- 执行者：zcode-batch-059-08
- 测试框架：node:assert/strict + vm（真实 vendored marked）自研 runner
- 覆盖率：11%

## 总结

审查对话框预览态 Markdown 富文本渲染：build.js 新增 sanitizeHtml/renderMd（与既有三处 renderMd 同口径，复用 vendored marked v12.0.2 零新增依赖），预览分支改 .md 富文本容器（data-i18n-skip 防词典改写审核对象）、空文档占位、渲染异常回退源码 pre；同步滚动选择器纳入预览容器；style.css 容器样式深浅色适配；语法高亮结论不启用（design.md 记录）；新增 11 例测试先红后绿，npm test 304 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
