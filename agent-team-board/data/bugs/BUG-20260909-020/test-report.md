# 测试报告 — BUG-20260909-020 app 版本无法按住标题栏进行移动，请修复

- 时间：2026-09-09T23:13:42.478Z
- 执行者：zcode-batch-029-1
- 测试框架：node:assert/strict + run-all
- 覆盖率：9%

## 总结

壳层注入拖动区：shell-css.mjs 新增 TOPBAR_DRAG_REGION_CSS（.topbar drag + .top-actions no-drag，均 !important），main.mjs 与让位样式同次 insertCSS（含重载）；归因 REQ-20260905-001；pollState/dataDir 取舍：纳入拖动区，壳内悬停/选择失效、浏览器直连不受影响；V5 契约先红后绿，run-all 127 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
