# 测试报告 — BUG-20260910-010 待测试界面为什么会有这个紫蓝色边框？

- 时间：2026-09-10T06:27:06.081Z
- 执行者：zcode-batch-031-14
- 测试框架：node:assert+vm
- 覆盖率：4%

## 总结

picked 行标记改中性 var(--text)（弃 --primary/--viewrail-accent），title 追加「详情打开中（右侧抽屉正展示此条目）」；新增 4 用例测试，全量 147 文件回归 0 失败（accepted-batch-entry L1 断言随新契约更新）

## 明细

（可粘贴命令输出、失败用例说明等）
