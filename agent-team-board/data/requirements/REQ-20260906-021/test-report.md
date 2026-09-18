# 测试报告 — REQ-20260906-021 文件模块支持文件切换自动换行模式

- 时间：2026-09-06T17:34:15.298Z
- 执行者：zcode-batch-003-01
- 测试框架：node:assert（源码结构/CSS 契约 + server 集成回归）
- 覆盖率：85%

## 总结

文件视图源码态新增「自动换行」开关（data-wrap-toggle+aria-pressed，文案显示目标态），设置存 state.banner.wrap 跨文件保持、切项目/刷新重置；wrap 态 pre 软换行（pre-wrap+anywhere）并隐藏行号槽（软换行下无法 1:1 对齐），关闭即恢复行号与行号复制；渲染态 md/图片不显示按钮；file-board 新增 W1–W4 全绿，npm test 46 文件失败 0

## 明细

（可粘贴命令输出、失败用例说明等）
