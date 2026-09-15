# 测试报告 — BUG-20260915-007 atb report（无 run 场景）缺系统收口提交，手动 /dev 与批量 run 的提交行为不一致

- 时间：2026-09-15T04:31:56.072Z
- 执行者：zcode-batch-048-037
- 测试框架：node:test
- 覆盖率：未统计

## 总结

无 run 手动 report 接入系统收口提交（引入来源 REQ-20260911-009，经 atb list 核验；关联 BUG-20260915-002）：claim/status→in-progress 拍工作区快照落 dispatch/runs/manual-<ID>，report 成功后经 manual-closeout 复用 autoCommitForRun 同口径提交（doc/test/业务、带单号、只 commit 不 push、幂等补交），失败/归属不明走 confirm-store 挂起待人工确认且不阻断上报；例外分支与非 git 跳过同覆盖。新增回归测试 5 场景全绿，全量 245 个测试文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
