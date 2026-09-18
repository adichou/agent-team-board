# 测试报告 — BUG-20260911-003 发布模块界面的新建发布按钮点击无反应，右上角的正常

- 时间：2026-09-11T01:04:29.302Z
- 执行者：zcode-batch-034-2
- 测试框架：node:assert + vm 自研接缝（run-all 聚合）
- 覆盖率：85%

## 总结

空态新建入口无反应：两处重复 id=relNewBtn 致 querySelector 只绑工具栏首个。修复：空态入口独立 id relEmptyNewBtn，bindCommon 提取 openNewPanel 双入口同绑；新增忠实 DOM 接缝测试 T1-T5（红→绿）；归因 REQ-20260910-029；release 系列与全量 186 文件回归 0 失败；浏览器实机项留人工。

## 明细

（可粘贴命令输出、失败用例说明等）
