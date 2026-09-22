# 测试报告 — BUG-20260922-005 并发 npm test 实例互相误杀对方测试 server：run-all 文件级残留清理无法区分他实例在用进程，ECONNREFUSED 偶发

- 时间：2026-09-22T15:27:24.125Z
- 执行者：zcode-run-gate
- 测试框架：node:assert 锁原语/重试/信号 + 真实 run-all 集成
- 覆盖率：未统计

## 总结

run-all 单实例互斥 + 文件级重试根治并发互杀与瞬时连接偶发：新增 lib/run-gate.mjs（按套件分键锁文件，O_EXCL 建锁、持有者存活则等待至上限【默认 20 分钟，ATB_RUNALL_LOCK_WAIT_MS 可调】后 exit=2 明确报持有者 pid、陈旧锁 pid 存活判定自愈接管、release 不误删他人锁、SIGINT/SIGTERM 尽力释放）+ run-all 集成（单文件首跑失败先 sweep 再重试一次，重试通过摘要可观测、真实回归两次仍失败照常报红）；既有文件间/run-end sweep 原样保留。新增 bug-20260922-005.test.mjs 6 用例先红后绿，leak-residue 回归全绿，全量 333 文件 0 失败零重试。引入来源：BUG-20260914-013（文件级 sweep 兜底未考虑并发实例在用 server）。B 不做（A 已消灭并发前提）、C（中断任务终止测试进程组）归 BUG-20260922-004 同修。

## 明细

（可粘贴命令输出、失败用例说明等）
