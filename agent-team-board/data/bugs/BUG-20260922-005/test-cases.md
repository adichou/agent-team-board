# 测试用例 — BUG-20260922-005 并发 npm test 互杀 / 瞬时连接偶发

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。新增 `scripts/tests/bug-20260922-005.test.mjs`。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | run-gate 锁原语：无锁创建（O_EXCL）；持有 pid 存活时 acquire 等待至超时并报持有者 pid 与指引；陈旧锁（pid 已死）接管覆写；release 后可再获取；release 不误删他人锁 | 高 | ✅（含 L1b lockPathFor 分键） |
| L2 | run-all 互斥集成：测试先持有同套件锁，以 `ATB_RUNALL_LOCK_WAIT_MS` 小值 spawn 真实 run-all → 快速非零退出且输出含持有者 pid；锁释放后 run-all 正常执行（可用最小方式验证获取成功路径） | 高 | ✅（exit=2、未执行任何文件；成功路径经全量真实运行覆盖） |
| L3 | 文件级重试：首跑失败 + sweep + 重试通过 → 结果记通过且标注「重试 1 次后通过」；重试仍失败 → 计入 failed（不掩盖）；重试尝试独立 180s 超时 | 高 | ✅（独立超时沿用 runFile 每次调用独立计时器） |
| L4 | run-gate 信号释放：SIGINT/SIGTERM 触发锁释放（或残留陈旧锁可被下一轮 pid 存活判定自愈接管） | 中 | ✅（SIGTERM 真实子进程验证） |
| R1 | 回归：单实例全量 `npm test` 行为不变（正常顺序执行、摘要口径、run-end sweep 保留）；bug-leak-residue-20260914-013 全组用例不回归 | 高 | ✅（333 文件 0 失败、零重试；leak-residue 11 用例全绿） |
