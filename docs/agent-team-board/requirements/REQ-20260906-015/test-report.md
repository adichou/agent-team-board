# 测试报告 — REQ-20260906-015 支持全局搜索，可以任意搜索需求，bug 和文件数中的文件。在需求看板界面就是搜索需求、bug，设计文档，在文件看板就是搜索文件

- 时间：2026-09-06T17:04:16.343Z
- 执行者：zcode-batch-003-1
- 测试框架：node:test 自定义脚本（run-all.mjs：真实起 server 集成 + 静态契约）
- 覆盖率：94%

## 总结

新增 GET /api/search 三桶搜索（items=id/标题、docs=条目md正文跳过H1、files=文件名DFS忽略node_modules/.git/隐藏/符号链接，各类上限50+truncated）；顶栏全局搜索框随视图解释：需求视图过滤看板卡片+文档命中条带点击定位文档，文件视图文件命中chip点击预览；250ms防抖+seq竞态防护，轮询不重置过滤，Esc清空不冒泡。新增 search-api.test.mjs（S1-S9）与 global-search-ui.test.mjs（U1-U6），全量45个测试文件0失败；M1浏览器人工验收待人工。

## 明细

（可粘贴命令输出、失败用例说明等）
