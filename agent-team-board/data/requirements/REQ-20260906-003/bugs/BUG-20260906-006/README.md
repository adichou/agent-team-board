# BUG-20260906-006 未认领未上报的 Codex 条目在续跑耗尽后被无限重新派发

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T06:40:04.134Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 C-A3。

## 现象

假 CLI 正常结束但未认领未上报，每次按默认最多追加 2 轮后 blocked；条目仍 accepted，又被新建 run 处理。450ms 观察窗口内已出现多份同条目运行记录。

## 复现步骤

隔离项目只接受一项；使用 fake-codex 的 no-report 模式，maxResumeRounds=2；持续调度，等首个 blocked 后再观察 450ms。

## 期望行为

有限续跑耗尽后阻塞该条目或暂停执行器，人工重试前不得自动创建新的尝试。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/scheduler.mjs:selectCandidate/settleAttempt
- 2026-09-06 修复：自动选单排除最近一次运行为 blocked、failed 或 interrupted 的条目；账本持久化限制跨开关和重启生效，其他条目仍可执行。

## 根因与验证

选单仅排除了 interrupted，没有排除未认领导致的 blocked/failed；条目保持 accepted，因此每个新 run 都重置了尝试预算。

新增 `scripts/tests/scheduler-unclaimed.test.mjs`，覆盖未认领未上报、无会话 ID、超时三种情况，以及重新开启、服务重启、后续条目执行。红阶段 no-report 预期 1 次运行，实际 5 次；修复后 3 组全过，原 scheduler 17 组回归全过。未测全库覆盖率。

## 关联（引入来源）

- 引入来源：REQ-20260906-003（后台调度器的选单仅排除 interrupted，未排除失败及受阻终态；已通过 atb show 核验）。


## 复现步骤

1.

## 期望行为
