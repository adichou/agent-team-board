# 测试报告 — BUG-20260906-018 detail-close-btn T2 全文件断言误伤批量抽屉的 space-between（存量失败）

- 时间：2026-09-06T19:29:46.091Z
- 执行者：zcode-batch-003-01
- 测试框架：node 静态契约测试（scripts/tests）
- 覆盖率：100%

## 总结

存量失败已被并行修复消除，本次核验确认并归因结案：T2 全文件断言误伤 renderBatchDrawer 由 REQ-20260906-005 的 T2 过度断言引入；BUG-20260906-011 已把 T2 收窄至 renderDrawer，BUG-20260906-016 已把批量抽屉头部改 .batch-head 类并新增 T5 全局断言。现状 detail-close-btn T1–T5 全绿，全量 npm test 57 个文件失败 0；未改代码，README 补归因与排查结论

## 明细

### 根因分析（含引入来源）

- 引入来源：REQ-20260906-005（经 `atb list/show` 核验存在）。其 detail-close-btn.test.mjs 原始 T2 用例对整个 scripts/web/app.js 断言不出现 `justify-content:space-between`，属过度断言；误伤 REQ-20260906-002（核验存在）引入的 renderBatchDrawer() 批量抽屉头部合法内联两端布局，导致 T2 恒失败、npm test 整体转红。
- 修复路径（本 Bug 登记后由并行条目完成，编号均经 `atb show` 核验）：
  - BUG-20260906-011（2026-09-06T16:14Z 上报）：T2 断言收窄至 renderDrawer 函数体；
  - BUG-20260906-016（2026-09-06T19:24Z 上报）：renderBatchDrawer 头部改 `.batch-head` 类承载两端布局，并新增 T5 恢复 app.js 全局无内联 space-between 断言。

### 验证证据（2026-09-07）

```
$ node scripts/tests/detail-close-btn.test.mjs
✓ T1 关闭按钮固定单号右侧：#drawerClose 在单号及复制控件之后、待确认 flag 之前
✓ T2 旧布局移除：…（断言范围限 renderDrawer 详情抽屉，BUG-20260906-011 收窄）
✓ T3 关闭交互保留：click 绑定 closeDrawer，Escape 兜底关闭
✓ T4 样式：行内关闭按钮不被压缩且尺寸适配单号行
✓ T5 全局无内联 space-between：批量抽屉头部改 .batch-head 类承载（BUG-20260906-016）

全部通过
$ npm test
共 57 个测试文件，失败 0
```

### 结论

本 Bug 描述的失败在当前代码已不存在（T1–T5 全绿、全量回归 57 文件失败 0），期望行为 1/2 均已由 BUG-20260906-011/016 的修复满足；本次未改任何代码，仅核验确认、补 README 归因与排查结论后结案。
