# BUG-20260906-001 全依赖阻塞批次已结束但 check 仍返回 continue

- 状态：in-progress（owner zcode-batch-002-1）
- 归属需求：REQ-20260906-002
- 创建：2026-09-06T06:40:03.960Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 Z-A1。

只有受阻候选时，next 返回 stop=blocked 并把批次置为 finished；随后 check 仍返回 nextAction=continue、blocked=0、remaining=1。主调度于是反复派发空 worker（每轮 next 都再 stop=blocked），批次永远收不了尾。

## 复现步骤

隔离项目建立 A、B；令 A 依赖未 done 的 B；limit=1 创建只含 A 的批次；依次调用 check、next、check。

## 期望行为

全受阻时主调度收到 stop 和准确阻塞计数，不再派发空 worker。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/batch.mjs:checkBatch/batchState/nextItem

## 关联（引入来源）

- 引入来源：REQ-20260906-002（新增 scripts/lib/batch.mjs：checkBatch 的 nextAction 只按「终态运行计数 remaining===0」判 stop，未覆盖「剩余项全部依赖受阻或冻结后已认领/流转」的不可派发场景；nextItem 的逐候选出局判定（依赖受阻/流转出局）没有对应的核对口径，两者口径脱节）。
