# 测试报告 — BUG-20260908-004 单号的前缀已经用了 REQ，BUG 这些区分，不需要再加单独的类型图标来区分了

- 时间：2026-09-08T03:56:20.114Z
- 执行者：zcode-batch-013-1
- 测试框架：Node 契约测试（vm 渲染 + 静态源码断言）
- 覆盖率：100%

## 总结

移除三处与单号并排的 REQ/BUG 类型徽章（需求列表行/详情抽屉头部/需求完善候选行），单号前缀已区分类型；清理 style.css 失引用的 .chip.req/.chip.bug；新增 type-chip-removed.test.mjs 4 用例（先红后绿），同步 detail-close-btn 与 pending-accept-inline 两条旧契约；npm test 全量 84 文件通过；引入来源按未定位归因（徽章先于首个登记需求，排查过程见 design.md）。

## 明细

（可粘贴命令输出、失败用例说明等）
