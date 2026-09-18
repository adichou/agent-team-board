# 测试报告 — REQ-20260908-014 需求完善批次每一轮上报需在主调度会话中显示单号和标题

- 时间：2026-09-08T06:40:09.082Z
- 执行者：zcode-batch-015-01
- 测试框架：node:assert/strict 自制 runner（npm test → scripts/tests/run-all.mjs）
- 覆盖率：92%

## 总结

refine 完善批次每轮上报显示单号+标题：run 账本领取时快照 itemTitle（zcode 领取/出局/codex 入队三入口），done/failed 回执、check.current、records 记录均增补 title；历史运行回退实时读条目标题，条目已删返回 null 不报错；回执/check 仍 ≤2KiB。R11 与 R10 追加断言先红后绿，全量 87 测试文件失败 0

## 明细

（可粘贴命令输出、失败用例说明等）
