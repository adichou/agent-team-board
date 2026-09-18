# BUG-20260906-004 Codex 完成核对接受缺少 runId 的报告

- 状态：in-progress（已认领实施；实时状态以 status.json 为准）
- 归属需求：REQ-20260906-003
- 创建：2026-09-06T06:40:04.067Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 C-A1。

当前 run 有明确 runId，但新 report 未传 `--run`，`lastReport.runId=null`，`verifyCompletion` 仍返回 `reported=true`。

## 复现步骤

隔离项目 claim 条目；建立 startedAt 早于报告的当前 run；report 不带 `--run`；调用 verifyCompletion。

## 期望行为

自动运行的报告必须关联本次 runId；旧调用兼容不能充当本次自动执行的完成证据。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/execution-verifier.mjs:verifyCompletion

## 修复

2026-09-06（zcode-batch-002-1）：`verifyCompletion` 运行关联校验由「仅拦显式错配」改为——
`run.runId` 存在时必须 `lastReport.runId === run.runId`，缺失返回 `report-run-missing`，
错配返回 `report-run-mismatch`；`done` 幂等核对（人工确认）不受影响。新增回归用例
V7/V8/V9（scripts/tests/execution-verifier.test.mjs），探针 C-A1 转绿。

## 关联（引入来源）

- 引入来源：REQ-20260906-003（ExecutionVerifier 首版实现把 REQ-20260906-002 的 report 旧调用兼容——不带 `--run` 时 `runId=null`——沿用为自动执行的完成证据，运行关联校验 `item.lastReport.runId && run.runId && …` 仅拦显式错配、未拦缺失）
