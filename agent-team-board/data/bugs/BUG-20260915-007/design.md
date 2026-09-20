# 设计 — BUG-20260915-007 atb report（无 run 场景）缺系统收口提交，手动 /dev 与批量 run 的提交行为不一致

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260911-009（引入「到待测试自动提交」机制时，把系统提交只挂在批量 run 回执通道，同时拦截 Agent 侧一切 Bash 提交且无豁免——无 run 的手动 /dev 因此没有任何代码级提交通道）。
- 关联：BUG-20260915-002（「dev 命令收尾缺少 Git 提交与待测试状态闭环」的修复只落在规则文档层——commands/dev.md、SKILL.md、dev-closeout.md——未提供代码级通道，本单可视作其在机制层的续篇）。

## 根因分析

（登记时已定位，修复阶段核实行号）

1. 系统自动提交的实现（run receipt 核验通过后的 git-flow 提交）**只由 `run receipt` 路径调用**；`atb report` 的无 run 分支只写 test-report.md 与 status.json（上报事件），不触达任何提交逻辑。
2. 钩子侧（state-guard 规则⑤，REQ-20260911-009/010）：Agent 经 Bash 的提交命令一律拦截、无豁免（CMT 通道已下线）。系统提交之所以不触发拦截，是因为它由 atb 进程内部 spawnSync 执行、不经 Agent 工具——这个「豁免」只授予 run receipt 路径。
3. 两者组合：无 run 的手动 /dev 在代码级不存在任何授权提交通道；一致性只剩规则文档约束，执行效果取决于各执行端钩子覆盖（Codex 无拦截可提交、ZCode 必被拦、终端人工可提交）。

## 方案

**开源选型（REQ-20260909-015）**：无合适库（提交编排为 atb 既有 git-flow 内核的复用与调用点扩展，纯自研增量）。

方向（开发阶段细化并补测试）：

1. **复用而非新写**：把 run receipt 路径的自动提交内核（归因扫描 + git-flow 提交 + 条目↔提交索引 + 失败挂起登记）抽为共用入口，`atb report` 无 run 分支在写完报告后调用同一入口——口径天然一致（幂等、失败挂起同 batch）。
2. **归因口径（关键设计点）**：批量 run 有预留时的 treeSnapshot 做「本单改动」界定；手动 /dev 无快照。建议在 `atb claim` 时落一份轻量 treeSnapshot（与批量预留同构），report 时按「认领后变更 ∩ 可归因规则」计算本单路径。认领受阻例外分支（无 claim）以 `atb status → in-progress` 时点为快照点兜底。
3. **钩子不动**：Agent Bash 提交继续拦截；系统提交保持 atb 进程内部执行。
4. 失败路径：复用 confirm-store 的 commit 挂起登记与任务页「待人工确认」闭环（与 BUG-20260914-001/020 实测链路一致）。

## 风险与边界

- claim 时快照有成本（git status 扫描），量级可接受；无 git 项目沿用「无测试/非 git」跳过口径；
- 与工作区其他任务脏文件的隔离完全依赖归因扫描的正确性——需要用「多任务并行 + 混合脏文件」用例回归；
- 登记 bug 时描述文案含「git commit」字样会被钩子按写目标语义误拦（本单登记时实测，措辞规避后通过）——该误拦是否单独立单修复，由人工定夺。

## 实施记录（2026-09-15，zcode-batch-048-037）

- **快照基线（方案 2 落地）**：`core.claim`（认领/续认）与 `core.setStatus → in-progress`（例外授权/驳回重开兜底）调用 `gitFlow.captureManualTreeSnapshot`，落 `dispatch/runs/manual-<itemId>/run.json`（executor='manual'、batchId=null，与批量/Codex 运行同目录互不误读；目录由 `ensureLedgerIgnore` 幂等补行 `dispatch/runs/` 排除在版本控制外）。同周期（phase='reserved'）重复认领保留最早快照；上一周期已收口（phase='reported'）则刷新开启新周期。
- **共用入口（方案 1 落地）**：新模块 `scripts/lib/manual-closeout.mjs`（分层：core 不能引用 confirm-store）在 `atb report`（不带 `--run`）成功后调用 `closeoutManualReport` → 直接复用 `gitFlow.autoCommitForRun`（doc/test/业务分组、消息带单号、只 commit 不 push、幂等/失败续传）+ `confirmStore.commitIncompleteReason / declareCommitConfirm`（失败/归属不明挂起待人工确认，`waitingDevelopConfirm` 项目级防呆即批量 pauseRequested 的等价物）。CLI 输出提交分组与挂起提示，上报本身不受阻断；`--json` 附加 `closeout` 字段。
- **口径裁决**：重复 report = 调 kernel 补交报告状态变动（对齐 dev-closeout「后续报告/状态变动仍需补交」），已入库路径退出脏集合天然不重复提交；已挂起待人工确认时不越权重放提交（与 `atb run autocommit` 守卫同口径）。历史认领（无快照记录）明确提示跳过、不登记无法闭环的挂起（无快照确认记录无法核验/补交，会把项目卡死在 waiting），重新认领后即可正常收口。
- **回归测试**：`scripts/tests/bug-report-closeout-20260915-007.test.mjs` 覆盖自动提交（claim 快照归因、他人改动隔离、无远端不 push、commit log 可查）、幂等补交（重复 report 仅新增 1 个 doc 提交，实现/测试不重复）、失败挂起（failing pre-commit hook：上报不受阻断、confirms 账本 waiting、挂起期间拒绝认领）、例外分支（status → in-progress 快照兜底同样收口）、非 git 跳过五条路径。
