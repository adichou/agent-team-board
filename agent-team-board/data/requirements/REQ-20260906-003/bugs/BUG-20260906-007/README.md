# BUG-20260906-007 网络退避期间停止当前执行后重试仍会唤起新进程

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T06:40:04.166Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 C-A4。

## 现象

网络失败进入退避后调用 stopCurrent 返回 ok；退避结束时进程启动次数仍从 1 增为 2，cancelRequested=true 与 phase=running 同时存在。

## 复现步骤

隔离项目启用 net-error 假 CLI；设退避 600ms；等待 retriesUsed=1 后 stopCurrent；再观察 850ms。

## 期望行为

停止请求撤销待执行重试，并在确认停止后结束运行，不复活旧执行。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/scheduler.mjs:scheduleRetry/stopCurrent
- 当前为测试登记，尚未修复。


## 复现步骤

1.

## 期望行为

## 根因分析（2026-09-06 修复）

`scripts/lib/scheduler.mjs` 两处缺口：

1. `scheduleRetry` 退避定时器回调只核对 `S.current?.runId === run.runId && !S.stopping`，缺少续跑路径已有的 `cancelRequested` 双重核对（见 settleAttempt 续跑分支"停止请求发出后不得再续跑/复活本次 run"）。停止请求后定时器照常触发 `spawnAttempt(kind='retry')`，进程启动次数 +1，phase 回到 running，与 `cancelRequested=true` 并存——即 C-A4 观察到的复活。
2. 退避等待期没有活进程：`S.current.handle` 是已退出尝试的旧句柄，`stopCurrent` 里 `handle.cancel()` 无效果，run 永远停在 `cleanup_pending`，`S.current` 不清空、实施占用不释放。

修复：

- `stopCurrent`：检测到待执行重试定时器（`S.retryTimer`，此时无活进程）时，撤销定时器并直接落账 `phase=interrupted`、`result.reason=user-stop`，走 `finishRun('interrupted')` 结束运行并释放占用。
- `scheduleRetry`：回调补与续跑路径一致的取消双重核对（内存 `S.current.cancelRequested` + 账本现值），竞态兜底不复活。

## 关联（引入来源）

- 引入来源：REQ-20260906-003（后台调度器引入网络退避重试 scheduleRetry 与 stopCurrent：退避等待期无活进程，停止撤销路径缺失，重试回调也未同步续跑路径已有的 cancelRequested 双重核对；已经 atb show 核验存在）。
