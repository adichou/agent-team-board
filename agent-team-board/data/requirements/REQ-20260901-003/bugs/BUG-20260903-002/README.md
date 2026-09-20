# BUG-20260903-002 认领锁永不清理，源码守卫被长期放行（零认领会话可改插件源码）

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260901-003
- 创建：2026-09-03T01:34:06.911Z

## 现象

REQ-20260901-003 的源码守卫在实际运行中被架空：本会话**未认领任何条目**，仍然成功对插件源码目录 `scripts/web/` 执行了 Write（探针文件已清理）。

根因是两个设计点叠加：

1. **锁只增不减**：`core.mjs` 中认领锁只在「人工驳回（done→in-progress）」时释放（core.mjs:371）；`report()`（上报待确认）与「确认完成（in-progress→done）」都不释放。当前 `.locks/` 已积累 19 把锁，全部对应 in-progress（待确认）条目，最新三把 2026-09-03 07:51 生成。
2. **放行判定过宽**：守卫放行条件是「当前项目看板 `.locks/` 存在 24h 内未过期认领锁」（state-guard.mjs:10 注释、CLAIM_LOCK_STALE_MS=24h），不校验锁的 owner 是否是当前会话。只要项目里近 24h 有**任何人**认领过，**所有人**都能改源码。

以本看板 19 条在办条目的活跃度，「近 24h 内存在认领锁」几乎恒真 ⇒ 源码保护实际长期处于关闭状态，REQ-20260901-003「必须先登记并认领条目才能改插件源码」的核心承诺未达成。

## 复现步骤

1. 确认 `docs/agent-team-board/.locks/` 存在 24h 内的锁（如 `REQ-20260903-001.lock`，2026-09-03 07:51）；
2. 在一个**未执行过 claim** 的会话中，用 Write/Edit 对插件源码（如 `scripts/web/app.js`）做改动；
3. 预期被 PreToolUse 钩子拦截，实际放行、写入成功（2026-09-03 复核时以 `scripts/web/guard-probe.tmp` 探针实证，已删除）。

## 引入来源

REQ-20260901-003（守卫方案 A 设计缺陷：放行条件复用 claim 锁但未考虑锁在 report 后残留的生命周期问题；state-guard.mjs 放行逻辑与 core.mjs 锁释放时机不匹配）。

## 期望行为（修复方向供参考）

- [x] report 上报时（或条目离开 in-progress 进入待确认时）释放认领锁；「确认完成」「驳回」路径同样清理
- [x] 释放时机调整后，守卫放行条件保持「存在未过期锁」即可重新收紧（有锁=确有会话在开发中）
- [x] 存量 19 把残留锁需一次性清理（或提供 `atb` 维护子命令清理失效锁）——已提供 `atb prune-locks [--dry-run]` 并对本看板执行一次（清 20 留 9）
- [x] 回归：code-guard.test.mjs 全绿；新增「report 后无锁、未认领写入被拦」用例（lock-lifecycle.test.mjs L1–L8）

## 修复记录（2026-09-05）

- 方案与影响面见 design.md；用例与结果见 test-cases.md / test-report.md。
- 改动：core.mjs（report/确认完成释放锁 + pruneLocks）、atb.mjs（prune-locks 子命令）、
  state-guard.mjs（注释）、新增 scripts/tests/lock-lifecycle.test.mjs。

## 关联

- 引入来源：REQ-20260901-003（源码守卫）
- 关联单：BUG-20260901-002（守卫误报修正，同一守卫模块）
