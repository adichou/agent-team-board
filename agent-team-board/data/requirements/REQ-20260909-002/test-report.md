# 测试报告 — REQ-20260909-002 列表头与批量操作条合并为单行：去清空选择、文案精简

- 时间：2026-09-09T00:54:48.601Z
- 执行者：zcode-batch-019-01
- 测试框架：node:test(vm 模拟 DOM + 静态契约)
- 覆盖率：9%

## 总结

列表头与批量操作条合并为单行：index.html 删除独立 #selectionBar 与清空选择按钮，#reqCaption 合并行分左组（计数/排序/全选/全不选）与右组 #selGroup（role=group，含分隔线+已选计数+当前档动作，零选择整体隐藏）；app.js syncAcceptance 改用 #selGroup，计数统一「已选 M 项」、按钮去数量后缀，删除 clearSelections 及绑定；style.css 删 .selection-bar 规则，.req-caption/.sel-group flex-wrap 窄屏换行。新增 selection-bar-merge.test.mjs M1-M9（TDD 先红后绿），同步更新 selection-lane-scope/accept-ui/impl-entry-ui/plan-batch-move/batch-ui/refine-ui 旧契约断言；npm test 全量 104 文件失败 0

## 明细

（可粘贴命令输出、失败用例说明等）
