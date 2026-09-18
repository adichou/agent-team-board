# 测试报告 — BUG-20260911-005 增加了批量 commit 功能后，要在已完成列表中添加“开始 Commit”按钮，布局和已接受和已计划的一样

- 时间：2026-09-11T02:30:38.771Z
- 执行者：zcode-batch-035-2
- 测试框架：node:assert/vm
- 覆盖率：95%

## 总结

已完成档列表头复用 #laneQuickEntry 常驻节点新增「▶ 开始 Commit」快捷入口：syncAcceptance conf 增加 done 分支（title/aria-label 同步，含与勾选无关、只 commit 不 push 口径），点击处理器扩为三分支 done→gotoRuns('commit') 仅导航；新增 5 用例测试先红后绿，三个旧契约测试按新口径更新；归因 BUG-20260910-014；全量 188 测试文件失败 0

## 明细

（可粘贴命令输出、失败用例说明等）
