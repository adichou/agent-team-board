# 测试报告 — BUG-20260909-007 详细页面的返回按钮多余，因为已经有关闭按钮了

- 时间：2026-09-09T05:38:57.673Z
- 执行者：zcode-batch-022-1
- 测试框架：node:assert 静态契约测试（node scripts/tests/run-all.mjs）
- 覆盖率：92%

## 总结

移除需求/Bug 详情抽屉冗余「← 返回」按钮：app.js 删 drawerBack 标记与绑定，关闭收敛为 ✕/Escape/遮罩（同一 closeDrawer 不变）；.drawer-back 样式保留给讨论侧唯一出口 #ocBack 未受波及；style.css 仅更正注释；D4/W4/P2 三处契约断言先红后绿，全量 117 测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
