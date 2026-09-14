# 测试报告 — BUG-20260914-013 集成测试泄漏 server/stub 进程：随机端口被残留监听者占用致跨轮次偶发失败（serve-stale T1 实证）

- 时间：2026-09-14T10:14:36.126Z
- 执行者：zcode-batch-048
- 测试框架：node:assert/strict + 真实进程/端口端到端 + lsof/ps 快照
- 覆盖率：85%

## 总结

测试进程泄漏修复：新增 scripts/tests/lib/test-process.mjs（pickFreePort 端口占用预检、stopChild/stopPid 确定性收尾 SIGTERM→有界等待→SIGKILL、waitHealth 可校验 pid 命中冒牌 health 报端口被占、listTestResidue/sweepTestResidue 残留扫描清理）；serve-stale T1-T5 全量 try/finally + 端口预检 + expectPid；dispatch-api stop() 消除 5s/20s 失配静默泄漏窗口；run-all 每文件后 sweep 兜底。11 用例先红后绿；serve-stale×5、run-all×3 全绿零失败；本机 2026-09-08 起 7 个泄漏进程全部检出回收，前后快照零残留。归因 BUG-20260907-017（辅 REQ-20260906-003/BUG-20260908-003）

## 明细

### 引入来源（归因）

- 主源 **BUG-20260907-017**（`atb list` 核验存在，done）：引入 `serve-stale.test.mjs`——随机端口无占用预检、
  服务/stub 收尾 fire-and-forget 不等退出、T2/T3/T5 无 try/finally。
- 辅源 **REQ-20260906-003**（核验存在，done）：引入 `dispatch-api.test.mjs` 的 `stop()`（SIGTERM 后最多等 5s
  即放行、不校验结果）。
- 辅源 **BUG-20260908-003**（核验存在，done）：服务端优雅关停强退兜底缺省 20s，与测试侧 5s 等待失配成
  静默泄漏窗口。

### TDD（先红后绿）

自动化载体 `scripts/tests/bug-leak-residue-20260914-013.test.mjs`（C1–C9 + C7b，11 用例）：

- 跑红：实现前 10/10 失败（模块缺失 + 源码契约未满足）。
- 跑绿：全部通过（含 C4 SIGKILL 兜底、C6b 冒牌 health 诊断、C7/C7b 真实残留检出回收、C8 不误杀）。

### 验收（对照 README 验收说明，日志见 dispatch/runs/run-20260914-238/）

1. **A1 确定性回归**：复刻泄漏 stub 占住 38804 后运行 serve-stale → 全绿（pickFreePort 自动换端口），
   无「health 应含数字 pid」误导失败。→ `serve-stale-A1-occupied-38804.log`
2. **A2 无泄漏快照**：run-all×3 前后 lsof/ps 对比——修复前存在 2026-09-08 起泄漏的 7 个
   atb-api-*/atb-mapi-* server 进程（`listTestResidue` 全部检出、sweep 全部回收）；run-all×3 后测试端口段
   （20000–50999）零测试残留，第三方监听（Doubao 49182/49853、clash 33331）未触碰。→ `lsof-ps-snapshots.log`
3. **A3 失败路径也回收**：T5 人为注入中途断言失败 → 用例失败但收尾后零残留进程/监听。→ `serve-stale-A3-failure-path.log`
4. **A4 稳定性**：serve-stale 连续 5 轮全绿；run-all（233 文件）连续 3 轮 0 失败；
   T3「不误杀」/T5「老服务重启」语义保持。→ `serve-stale-x5.log`、`run-all-round{1,2,3}.log`

### 改动清单

- 新增 `scripts/tests/lib/test-process.mjs`（自研基建；未引入开源依赖，不创建 licenses.md）
- 新增 `scripts/tests/bug-leak-residue-20260914-013.test.mjs`
- 改 `scripts/tests/serve-stale.test.mjs`、`scripts/tests/dispatch-api.test.mjs`、`scripts/tests/run-all.mjs`
- 未改任何产品代码（server.mjs 关停语义保持）

