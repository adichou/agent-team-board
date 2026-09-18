# 测试报告 — BUG-20260830-001 顶栏「看板/文件」按钮在窄窗口遮挡路径文字

- 时间：2026-08-29T23:43:25.569Z
- 执行者：terminal
- 测试框架：node:assert CSS 契约测试
- 覆盖率：5%

## 总结

修复顶栏窄窗口遮挡：.brand-text 增加 min-width:0 使路径省略号生效；.path 的 max-width 由 46vw 改为 100%（交给 flex 收缩）；.view-tabs/.top-actions 增加 flex:none 防压缩错位；≤640px 顶栏 flex-wrap:wrap 换行降级（brand 占整行）。新增 scripts/tests/topbar-overflow.test.mjs 5 用例先红后绿，layout/file-board/multi-project/loop-mode 回归全过。多宽度真实浏览器目验建议人工在 /board 760px/640px 下复核。

## 明细

（可粘贴命令输出、失败用例说明等）
