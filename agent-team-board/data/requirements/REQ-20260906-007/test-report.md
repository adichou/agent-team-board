# 测试报告 — REQ-20260906-007 文件看板的目录树要改成横幅呈现，参考 codex 的文件右侧面板

- 时间：2026-09-06T16:47:44.620Z
- 执行者：zcode-batch-20260907-003-1
- 测试框架：node:assert（纯函数单测+静态契约+server 集成）
- 覆盖率：8%

## 总结

文件看板目录树改横幅呈现：新增 banner.js 层栈状态机（面包屑+分层横幅条带），index.html/app.js/style.css 重构为横幅布局，移除 Wunderbaum 树与竖向分隔条接线（vendor 与 splitter.js 文件保留不加载）；file-board F7 改写/F10F11F13 退役、file-splitter S5-S7 改退役守卫，新增 B1-B8 用例全通过，npm test 43 文件失败 0；顺带修复切项目后文件视图不刷新

## 明细

（可粘贴命令输出、失败用例说明等）
