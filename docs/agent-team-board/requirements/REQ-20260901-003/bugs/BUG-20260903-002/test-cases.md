# 测试用例 — BUG-20260903-002 认领锁永不清理，源码守卫被长期放行

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。测试文件：`scripts/tests/lock-lifecycle.test.mjs`

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | claim 产生认领锁；report 上报后锁被释放（核心修复点） | P0 | ✓ 绿 |
| L2 | 人工确认完成（in-progress→done）后锁被释放 | P0 | ✓ 绿 |
| L3 | 人工驳回（done→in-progress）清理残留锁（既有行为回归） | P1 | ✓ 绿 |
| L4 | report 释放锁后，无锁会话对插件源码的 Write 被 guard 拦截（exit 2）；锁存在时放行（对照） | P0 | ✓ 绿 |
| L5 | report 后原认领者 claim 续认补锁，guard 重新放行 | P1 | ✓ 绿 |
| L6 | prune-locks：保留「条目 in-progress 且未过期」的锁；删除不在办条目（submitted/done）的锁、孤儿锁、>24h 过期锁 | P0 | ✓ 绿 |
| L7 | prune-locks：新鲜的 config.lock 保留、过期删除；非认领 ID 形态的 .lock 跳过不动 | P1 | ✓ 绿 |
| L8 | CLI `atb prune-locks --dry-run` 只预览不删除；不带 --dry-run 实际删除 | P1 | ✓ 绿 |

> TDD 记录：初版 8 用例 6 红（L1/L2/L4 释放逻辑缺失、L6/L7 pruneLocks 缺失、L8 CLI 缺失），
> 实现后全绿。L6/L8 曾两次因测试自身构造疏漏失败（done 条目未补残留锁、submitted 条目未补残留锁、
> 前序用例残留 config.lock 干扰 L8），修正测试后通过，与实现无关。
