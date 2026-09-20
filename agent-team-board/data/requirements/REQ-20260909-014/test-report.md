# 测试报告 — REQ-20260909-014 需求模块详细页面的说明，设计，测试用例文档支持右键菜单“讨论”

- 时间：2026-09-09T15:17:33.701Z
- 执行者：zcode-batch-027-1
- 测试框架：node:test 风格自研断言（vm 纯函数 + 静态契约，run-all 聚合）
- 覆盖率：90%

## 总结

文档页签右键「讨论」：loadDoc 渲染后用 parseDocBlocks（req-disc parseBlocks 副本+CommonMark 化增强：松散列表跨空行/缩进续行/懒续行/围栏记号长度/引用分块/异族列表分块）为 #docView 顶层块标注 data-doc-start/end/kind，子序列校验失准即停（宁缺勿错）；doc-level contextmenu 委托：需求单文档页签就绪时弹单例菜单（视口内收；外部pointerdown/Esc/滚动/resize/切页签/关抽屉收起），选中→文字+绝对路径+精确行（段落/代码内换行计数，富文本取覆盖范围），无选中→路径+落点块行范围；copyPlain 双回退，成功 toast，失败页内自绘只读文本域（不用 window.prompt）。仅改 app.js/style.css，无后端/无记录。新增测试 doc-ctx-discuss-20260909-014（17断言）+ drawer-tabs 桩补 closeDocCtxMenu；447 份真实文档块数与 marked 顶层节点 100% 对齐；npm test 124 文件全绿

## 明细

（可粘贴命令输出、失败用例说明等）
