# BUG-20260906-002 手工先认领时 Zcode 批次仍可认领另一项导致项目并行实施

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-002
- 创建：2026-09-06T06:40:03.996Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 Z-A2。

## 现象

先由 manual-worker claim A，再创建批次并由 batch-worker next/claim B，两个条目同时 in-progress 且 owner 不同。

## 复现步骤

隔离项目建立并接受 A、B；手工 claim A；创建 Zcode 批次；next 后 claim B。

## 期望行为

手工、Zcode、Codex 任一入口先占用项目后，其余实施入口都被阻塞。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/core.mjs:claim/assertNoImplConflict；scripts/lib/batch.mjs:nextItem
- 当前为测试登记，尚未修复。


## 复现步骤

1.

## 期望行为
