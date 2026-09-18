# 测试报告 — BUG-20260909-019 左上角有元素遮挡，请修复

- 时间：2026-09-09T23:07:48.290Z
- 执行者：zcode-batch-029-1
- 测试框架：node:assert/strict（electron-shell.test.mjs V1–V4 + I1–I4，run-all 全量 127 文件）
- 覆盖率：8%

## 总结

根因：insertCSS 注入表与页面 style.css 同 author 同 specificity，不保证排在页面规则之后，78px 让位被 .topbar{padding:10px 18px} 压制从未生效（引入来源 BUG-20260905-003，已核验）。修复：让位声明加 !important（author important 恒胜 normal，与顺序无关）且不包 @media（竖屏分支同让位）；main.mjs 注入失败改为可见日志；V4 契约补 !important/无 @media 断言（先红后绿）；浏览器直连零改动。全量 127 测试文件失败 0。真机验收（首载/Cmd-R/≤640px/深浅色）留人工。

## 明细

（可粘贴命令输出、失败用例说明等）
