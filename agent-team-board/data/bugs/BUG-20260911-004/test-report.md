# 测试报告 — BUG-20260911-004 营销模块的概览页面还是有问题，需要 Cmd+R 才能看到数据

- 时间：2026-09-11T02:22:54.663Z
- 执行者：zcode-batch-035-1
- 测试框架：node:assert + vm（run-all.mjs 聚合）
- 覆盖率：90%

## 总结

根因：render() 写 data-mkt-pane 而 setTab() 读 dataset.pane，键不匹配致任何页签切换给全部 pane 加 hidden，概览空白须 Cmd+R 重绘。修复 setTab 改读 dataset.mktPane（一行），归因 REQ-20260910-019。新增 3 用例先红后绿，全量 187 测试文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
