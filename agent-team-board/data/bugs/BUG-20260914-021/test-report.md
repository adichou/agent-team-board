# 测试报告 — BUG-20260914-021 commit 消息对条目标题有截断，请修复

- 时间：2026-09-15T02:35:28.653Z
- 执行者：zcode-batch-048-033
- 测试框架：node:assert 自研 run-all（241 文件全过）
- 覆盖率：100%

## 总结

git-flow 两处去掉 slice(0,DESC_MAX_CHARS) 截断，DESC_MAX_CHARS 20→120 与标题上限对齐，validateCommitSubject 口径同步；新增 D13/D14/P7 长标题用例（autoCommitForRun 三组、supplementCommitForRun doc 组、待人工挂起 doc 组均完整保留标题且过核验），run-all 241 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
