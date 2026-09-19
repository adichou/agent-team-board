# BUG-20260918-004 确认闭环全量测试硬编码 600 秒超时，长套件永远无法通过确认

- 状态：accepted（已接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-18T08:05:45.151Z

## 现象

现象：REQ-20260916-005 提交确认闭环两次确认均被拒：「测试未通过（npm test 退出码 null）」。账本（runtime/confirms/confirms.json）记录 test.timedOut=true——server.mjs startConfirmTask 的 timeoutMs 硬编码 600_000，而本仓库 270 个测试文件全量超过 10 分钟，跑到一半被 SIGKILL，退出码 null。批次执行路径超时为 (run.timeoutMin || settings.timeoutMin || 60) 分钟（server.mjs:1005/1174），确认闭环口径不一致且过短，导致长套件仓库的确认闭环永远无法通过。期望：确认任务超时与批次执行同口径（默认 60 分钟或可配置），或至少不再低于全量实际耗时。

## 复现步骤

登记时（修复前）路径，均已在源码核实：

1. 前置：被看板管理的仓库全量 `npm test` 耗时超过 10 分钟（本仓库登记时 270 个测试文件即如此；脚本注释确认 2026-09-15 时约为 4 分钟，随后增长越过 600 秒）。
2. 该仓库某条目 Agent 上报完成（进入「待测试」），在看板任务页「待人工确认」面板触发「重新核验」或「确认并继续」。
3. 服务端 `startConfirmTask`（scripts/server.mjs）以登记时硬编码的 `timeoutMs: 600_000` 注入 testRunner，调用 `runProjectTestsAsync`（scripts/lib/confirm-store.mjs）运行 `npm test`。
4. 600 秒内测试未跑完：超时回调对整个进程组发送 SIGKILL（confirm-store.mjs 的 killGroup），子进程以退出码 null 结束、`timedOut=true`。
5. `verifyCommitConfirm` / `confirmCommitContinue` 判定不通过，拒绝理由为「测试未通过（npm test 退出码 null）」（confirm-store.mjs 两处拼装），账本 runtime/confirms/confirms.json 记录 test.timedOut=true。
6. 重试「重新核验」/「确认并继续」结果完全相同——超时是确定性的，确认闭环永远无法通过。

现状备注（2026-09-19 核实）：登记当日 17:33 的提交 7329efe（「人工确认补交 REQ-20260916-005」）已把该处硬编码临时上调为 `timeoutMs: 36_000_000`（10 小时），上述 600 秒被杀路径在当前代码不再触发；但 36_000_000 仍是与批次执行无关的硬编码常量，口径不一致的根因未解决，且 scripts/lib/confirm-store.mjs 中 `runProjectTests` / `runProjectTestsAsync` 的默认参数仍为 600_000（当前服务端总是注入 testRunner 才未踩到）。

## 期望行为

1. 确认/核验任务（startConfirmTask 的 npm test）超时与批次执行同口径：按 `run.timeoutMin || settings.timeoutMin || 60` 分钟取值（与 server.mjs 批次路径一致；settings.timeoutMin 在设置页可配，合法范围 5–240 分钟，见 scripts/lib/dispatch-store.mjs SETTING_RANGE 与默认 60）。至少不再低于被管仓库全量测试的实际耗时。
2. 修复后不再出现新的硬编码超时常量：登记时的 600_000 与临时缓解的 36_000_000 均应被上述口径取代（临时上调值是否保留为上限语义，开发阶段待确认）。
3. `runProjectTests` / `runProjectTestsAsync` 的 600_000 默认参数是否一并统一到同口径，避免未来未注入 testRunner 的调用方再次踩坑——待确认（开发阶段定）。

## 验收说明

1. 长套件可通过确认：全量 `npm test` 超过 10 分钟的仓库（或以注入慢测试的沙箱项目模拟），在看板分别完成「重新核验」与「确认并继续」两条路径，任务在合理时长内正常完成，账本不再出现 test.timedOut=true，确认不再被「测试未通过（npm test 退出码 null）」拒绝。
2. 口径一致：确认任务超时取值链路与批次执行一致（run.timeoutMin / settings.timeoutMin 5–240 / 默认 60 分钟）；在设置页调整单项时限后，确认任务超时随之生效（可通过 runtime/confirms/tasks.json 中任务的 timeoutMs 或实际行为核验）。
3. 回归不伤短套件：全量耗时远小于时限的仓库（本仓库当前 271 个测试文件）确认闭环行为不变；无 package.json / 无测试脚本的项目仍按 skipped 口径跳过测试（不凭空要求）。
4. 批次执行路径（server.mjs 批次超时与失败文案）不受本次改动影响。
