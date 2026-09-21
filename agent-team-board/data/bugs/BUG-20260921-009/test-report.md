# 测试报告 — BUG-20260921-009 命令模块的最近执行没有显示，请修复

- 时间：2026-09-21T07:01:04.346Z
- 执行者：zcode-batch-059-11
- 测试框架：node:assert + vm
- 覆盖率：4%

## 总结

根因：commands.js render() 重建 #commandsView DOM 但漏调 renderRecent()，进入模块无空态提示、切页签往返/再进入后最近执行条目被清空不重渲染；引入来源 REQ-20260920-004（commit 12ac4ae）。修复：render() 补调 renderRecent() 一行。测试：新增 bug-20260921-009.test.mjs（vm 驱动真实前端 4 例，先红后绿），npm test 307 文件全过；无文案改动，i18n 零新增。

## 明细

（可粘贴命令输出、失败用例说明等）
