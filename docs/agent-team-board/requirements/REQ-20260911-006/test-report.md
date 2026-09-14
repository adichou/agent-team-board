# 测试报告 — REQ-20260911-006 回退REQ-20260911-004

- 时间：2026-09-11T14:37:36.469Z
- 执行者：zcode-batch-039-1
- 测试框架：node:assert + npm test (run-all.mjs)
- 覆盖率：100%

## 总结

整体撤销004提交目录范围:task-settings无commit分区(patch.commit按未知键忽略,残留读忽略保存不写回);commit-store提示词/批次/摘要/核验恢复无目录约束(batch无scope,spec静态,三参核验);server不透传body.commit;设置页恢复仅批量任务分区;删004测试文件;新增7用例先红后绿,npm test 199文件0失败

## 明细

（可粘贴命令输出、失败用例说明等）
