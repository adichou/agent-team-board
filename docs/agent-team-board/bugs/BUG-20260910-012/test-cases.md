# 测试用例 — BUG-20260910-012

被测对象：`scripts/tests/scheduler-unclaimed.test.mjs`（本 Bug 的修复即该测试自身的稳定性修复；
调度器生产代码 `scripts/lib/scheduler.mjs` 不改动，其行为由既有 152 文件套件回归覆盖）。

## 既有用例（全部保留，语义不变）

| # | 用例 | 断言 |
|---|------|------|
| 1 | 单 run 尝试预算 | `no-report` 2 次（new+resume）、`no-thread`/`timeout-sleep` 1 次 |
| 2 | 执行器不伪造认领 | 失败后条目状态保持 `planned` |
| 3 | 重新开启不自动重派 | 再 enable 后 `listRuns.total` 仍 1 |
| 4 | 重启不丢失败记录 | recover 后 `listRuns.total` 仍 1 |
| 5 | 失败项不阻塞后续 | `worker-ok` 后续条目 `agentCompletedAt` 出现且 total=2 |
| 6 | 超时强杀路径（timeout-sleep 首个 run） | fixture 睡 60s，150ms 单项时限 → failed(reason=timeout)，attempts=1 |

## 新增用例（本修复引入的形态约束）

| # | 用例 | 断言 |
|---|------|------|
| N1 | 后续 worker-ok run 不受 150ms 单项时限 | 重启/后续阶段调度器 `probeTimeout:false` → timeoutMs=5000（构造参数）；表现为用例 5 在负载下收敛 |
| N2 | 等待卡点可定位 | 三处 `waitFor` 均带 label，失败信息形如 `等待运行结算超时 [<mode>：<卡点>]` |
| N3 | 等待预算对负载鲁棒 | `waitFor` 预算 15s（原 5s）；通过路径仍毫秒级收敛 |

## 执行与验证记录（2026-09-10，macOS arm64 darwin 25.6.0，Node v17.8.0）

跑红（修复前，原文件）：
- 确定性慢机模拟（spawn 前置阻塞 400ms/次，注入方式见 evidence.md）：`node scripts/tests/scheduler-unclaimed.test.mjs`
  失败于第 64 行第三处 waitFor，`AssertionError: 等待运行结算超时`，timeout-sleep 模式；800ms/次注入同败。

跑绿（修复后，同一模拟与常规路径）：
- 慢机模拟 400ms/次：退出码 0（3/3 模式通过）；800ms/次：退出码 0。
- 直连连跑 15 次退出码 0：其中 10 次与一轮全量 `npm test` 并行（负载轮），5 次空闲。
- 全量 `npm test`（152 文件）连续 3 次全绿（1m32s / 1m55s / …），本文件均在 run-all 180s 单文件上限内完成。

回归证明思路：本修复的回归面即「原红场景」——同一注入负载下原文件必败、修复后必过；
注入补丁未入库（仅诊断工具），防回归由 N1 的构造约束 + 用例 5 断言承担（若有人改回按模式取 150ms，
高负载 CI 下将复现本失败）。
