# 测试报告 — BUG-20260909-018 单详情也么太矮了，请优化

- 时间：2026-09-09T16:31:05.244Z
- 执行者：zcode-batch-028-1
- 测试框架：node:assert（静态契约测试 G1–G4）+ run-all.mjs 全量回归
- 覆盖率：100%

## 总结

纯 CSS 修复（style.css）：.doc-shot 默认展示放宽 max-height 260px→min(58vh,640px)、max-width 420px→640px；新增 #drawer>.drawer-body flex:1+min-height:0 与文档页签 .md 拉伸，说明页签不足一屏不再大段空白；app.js 零改动，lightbox/失败占位/lazy/8MB 口径不回退；.oncall-fig 豁免不动（理由见 design.md）。TDD：新增 doc-shot-size-20260909-018.test.mjs G1–G4 先红后绿；drawer-height/item-shot-ui/discussion-ui 定向回归通过；全量 127 文件失败 0。

## 明细

（可粘贴命令输出、失败用例说明等）
