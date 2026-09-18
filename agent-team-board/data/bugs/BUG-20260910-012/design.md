# 设计 — BUG-20260910-012 scheduler-unclaimed.test.mjs 间歇失败（等待运行结算超时，HEAD 基线可复现）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- **引入来源：BUG-20260906-006**（已经 `atb list` 核验存在，状态 in-progress）。
  该测试文件（`scripts/tests/scheduler-unclaimed.test.mjs`）正是随 BUG-20260906-006 的修复引入（文件头注释即标注），
  引入时 `timeoutMs: mode === 'timeout-sleep' ? 150 : 5000` 按「模式」而非「阶段」取值，埋下本缺陷。

## 根因分析

**定性：测试侧 bug（非调度器生产逻辑缺陷）**；失败点为测试第 64 行第三处 `waitFor`（后续条目 `agentCompletedAt`），
仅 `timeout-sleep` 模式触发。证据链（复现数据见本目录 `evidence.md`）：

1. **确定性复现**：用阻塞式 spawn 延迟注入（`NODE_OPTIONS --require` 补丁给每次 `spawn/spawnSync/execFileSync`
   前置阻塞 `SLOW_SPAWN_MS`，模拟高负载机器）连跑原文件：`400ms` 延迟下 100% 失败于第 64 行
   `AssertionError: 等待运行结算超时`，与登记现象完全一致；空闲直连 3/3 通过亦与登记复核一致（负载相关）。
2. **卡点定位**：`timeout-sleep` 模式下 `makeScheduler()` 对该模式所有调度器实例一律 `timeoutMs: 150`。
   该 150ms 本意只服务于**首个** run（fixture `timeout-sleep` 睡 60s，验证超时→SIGINT→强杀→failed 结算路径）；
   但测试后半段「重启 + 后续条目」阶段复用同一 `makeScheduler()` 重建调度器，随后以 `worker-ok` 模式派发后续条目
   ——该 run 的完成链是 3 个串行 node 子进程（fake-codex 启动 + `atb claim` + `atb report`），空闲时 ≈85ms 完成，
   余量仅 ≈65ms；机器有负载（全量测试第 117 位、并行批次等）即超 150ms 被超时强杀。
3. **失败闭环**：后续 run 被杀后按超时路径结算 `phase=failed, result.reason=timeout`（调试实测落账如此）；
   失败项按本测试验证的语义不再自动重派（条目保持 planned，行为正确），`agentCompletedAt` 永不出现，
   第三处 `waitFor` 必然空转到 5s 预算断言超时——「等待运行结算超时」是等待侧文案，根源是被测链路被误杀。
4. **次要因素**：三处 `waitFor` 共用固定 5s 预算且共用一句断言文案（登记时「未逐点记录卡在哪一处」的直接原因）；
   `no-report` 模式首个 run 的结算链含 6 次串行阻塞式子进程启动（版本探测+目录+2×spawn+2×ps），400ms/次注入下
   已达 ≈3.3s，预算同样偏紧（800ms/次注入会先在此处超时）。同项目 `scheduler.test.mjs` 的既有惯例是
   `waitFor(cond, timeoutMs=10_000~15_000, label)`，本文件是孤例。

**结论**：调度器 `scripts/lib/scheduler.mjs` 行为符合配置与设计（超时强杀、失败不重派、互斥均正确），
不修改生产代码与默认参数。

## 方案

只改 `scripts/tests/scheduler-unclaimed.test.mjs`（测试侧），断言语义逐条保留：

1. **按阶段而非按模式取单项时限**：`makeScheduler({ probeTimeout })` ——首个调度器保持
   `timeout-sleep ? 150 : 5000`（验证超时路径不变）；重启/后续条目阶段的调度器显式 `probeTimeout: false`
   → 一律 5000ms，worker-ok 守规执行不再被 150ms 误杀（消除结构性竞态，主修复）。
2. **等待策略对时序抖动鲁棒**：`waitFor(check, label)` 预算 5s → 15s（与 `scheduler.test.mjs` 同款），
   并给三处等待分别打标签（`首个 run 进入终态` / `disable 后 current 清空` / `后续条目完成上报`），
   再失败可直接定位卡点。通过时仍毫秒级收敛（实测空闲单文件 <3s），不拖慢全量测试；
   仅真故障时多等至多 15s，远低于 run-all 单文件 180s 上限。

**开源选型（REQ-20260909-015）**：未引入开源库——本修复是既有测试的参数化与等待预算调整，
无外部依赖需求（自研理由：无合适库的原因——不涉及新能力，仅修正既有测试自身配置）。
不创建 licenses.md。

## 风险与边界

- 不触碰 `scripts/lib/scheduler.mjs` 生产逻辑与默认参数（`tickMs/timeoutMs/cancelGraceMs/settleMs` 均未改）。
- 不触碰 `scripts/web/*`、`electron/*`；`timeout-sleep` 首个 run 仍验证超时强杀路径（attempts=1、reason=timeout）。
- 已确认既有断言全部保留：尝试预算（no-report 2 次/其余 1 次）、不伪造认领（planned）、重新开启不重派、
  重启不丢失败记录、失败项不阻塞后续派发。
- 已确认用户工作区未提交改动（含 scheduler.mjs 的 REQ-20260909-015 提示词增补）原样保留，未提交。
