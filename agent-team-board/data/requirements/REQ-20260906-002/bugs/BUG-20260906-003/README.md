# BUG-20260906-003 Zcode 失败待核对仍释放项目锁允许其他入口继续实施

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-002
- 创建：2026-09-06T06:40:04.031Z

## 现象

独立验收复测（2026-09-06），优先级 P1，探针 Z-A3。

## 现象

failed 回执带 safeToContinue=false 后，批次显示 needs_attention，但 impl.lock 已删除，手工还能 claim 另一条目。

## 复现步骤

隔离项目 next/claim A；提交 failed、safeToContinue=false 回执；检查项目锁并手工 claim B。

## 期望行为

无法确认工作区可继续时暂停项目，并让其他入口遵守该暂停。

## 测试证据

- 复现脚本：docs/agent-team-board/test-runs/20260906-002-003/adversarial.mjs
- 假执行器结果：docs/agent-team-board/test-runs/20260906-002-003/adversarial-results.json
- 真实 CLI 结果：docs/agent-team-board/test-runs/20260906-002-003/real-cli-production-probes.json
- 检查位置：scripts/lib/batch.mjs:finishRun；scripts/lib/core.mjs:claim
- 当前为测试登记，尚未修复。


## 复现步骤

1.

## 期望行为
