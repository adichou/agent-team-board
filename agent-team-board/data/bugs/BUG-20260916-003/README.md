# BUG-20260916-003 条目人工确认完成后未取消其受阻回执，批次计数永久残留受阻

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-16T05:01:11.554Z

## 现象

worker 交 blocked 回执后，若该条目随后被其他轮次成功实施上报并经人工确认完成，原 blocked run 记录仍永久保留，batch check 的「受阻 N」计数持续残留。实例：batch-20260913-048 中 run-20260916-266（BUG-20260916-001）受阻（原因：发布接口独立化与官网配置共享范围待确认），该条目后续已成功实施上报（提交 e6f6267 等），但批次计数仍显示受阻 1。

代码定位（均经现仓库源码核验）：

- `scripts/lib/batch.mjs` `batchState`（约 380–413 行）：`counts.blocked` 完全按批次 run 账本统计——`batchRuns`（362–369 行）只筛 `r.batchId === batchId` 的运行并按创建时间倒序，`finalByItem` 对每个条目取**最新**一条终态 run（blocked / reported / failed / skipped，`FINAL_RUN_PHASES` 见 42 行）计入对应计数，与条目当前业务状态无关。
- blocked 回执经 `finishRun`（约 845 行起）落账后 `run.phase='blocked'` 是永久终态，无任何后续流转。条目后续若经**手工通道**成功上报（`atb claim` + `atb report` 不带 `--run`），只产生 `manual-<ID>` 形态的运行记录（`executor='manual'、batchId=null`，见 `scripts/lib/git-flow.mjs` 209–214 行与 `scripts/lib/manual-closeout.mjs`），不挂批次、不参与批次计数；若经**其他轮次**成功上报，新 reported run 挂在其他批次账本——两种情形都不改写原批次内该条目的最新终态 blocked。
- 人工确认完成 `atb status <ID> done`（`scripts/lib/core.mjs` `setStatus` 846–887 行）只闭环 hold 记录（closed-done），完全不触碰 dispatch run 账本。
- 于是 `checkBatch` counts（`scripts/lib/batch.mjs` 1063 行）、`batchSummary` / `batchBrief` 与看板任务面板「受阻待处理 N」（`scripts/web/app.js` 6891 行；异常口径 `blockedRuns` 见 `scripts/server.mjs` 2937–2945 行）持续计入已 done 条目的历史 blocked run，且无任何自动或人工途径消除：CLI `atb run` 仅有 receipt / release / autocommit 三个子命令（`scripts/atb.mjs` 1653–1703 行）；终态任务的「重新执行」入口要求条目回到 planned 且未认领（`scripts/lib/batch.mjs` 807–814 行），done 条目不可达；`atb hold cancel` 只作废 hold 声明，不影响 run 账本。

实例核验（本仓库 runtime 账本现存）：run-20260916-266（batchId=batch-20260913-048，BUG-20260916-001）于 2026-09-15T17:03Z 以 blocked 落账（safeToContinue=true，批次继续其他项）；该条目 2026-09-16T02:23Z 经手工通道上报（manual-BUG-20260916-001，batchId=null，lastReport.runId=null）、2026-09-16T05:46Z 人工确认 done（提交 e6f6267 等）；batch-20260913-048 账本内该条目最新终态仍为 blocked，批次 counts.blocked 持续 +1，批次 status 亦因此类残留长期停在 running。

## 复现步骤

方式 A（临时项目 + Node 直调库层最小序列）：

1. 在临时项目目录初始化看板数据，准备 1 个条目并人工置为 planned，`createBatch` 创建开发批次（status=running）；
2. worker 领取并认领该条目（条目 in-progress、产生 run 记录）；
3. 调用 `finishRun(runId, { result: 'blocked', reason: '待人工决策', safeToContinue: true })`（`scripts/lib/batch.mjs`）：run.phase='blocked' 落终态，批次继续；
4. 模拟条目经其他途径完成：对该条目走手工通道 `atb claim <ID>` → `atb report <ID> --summary "…"`（不带 --run，只新增 manual-<ID> 记录），随后人工确认完成 `atb status <ID> done`；
5. 调用 `checkBatch(dataDir, batchId)`（或 `node scripts/atb.mjs batch check --dir <项目>`）：counts.blocked 仍为 1（期望 0）；`batchSummary` / 看板任务面板「受阻待处理 1」持续显示；run 记录列表中该 blocked run 永久裸露，CLI / 看板均无取消入口。

方式 B（CLI 路径，回放实例链路）：

1. 批量开发任务运行中，子代理对某条目交受阻回执：`node scripts/atb.mjs run receipt <RUN-ID> --result blocked --reason "<短句>" --safe-to-continue`；
2. 后续另开会话手工收口该条目：`atb claim <ID>` → 实施 → `atb report <ID> --summary "…"`（不带 --run）；
3. 人工确认完成：`atb status <ID> done`（或看板网页端二次确认）；
4. `node scripts/atb.mjs batch check --dir <项目>`：「受阻 1」不消失，条目已 done 与计数长期不一致；`atb run` 可用子命令（receipt / release / autocommit）中无任何可取消该回执的入口。

方式 C（本仓库现存残留实例，只读检视）：

1. 检视 `agent-team-board/runtime/dispatch/runs/run-20260916-266/run.json`：phase=blocked、batchId=batch-20260913-048；同目录 `manual-BUG-20260916-001/run.json`：phase=reported、batchId=null；
2. 检视 `agent-team-board/runtime/status/BUG-20260916-001.json`：status=done（2026-09-16T05:46Z 人工确认完成）；
3. 两者并存即缺陷现场：修复前该批次的受阻计数无消解途径。

## 期望行为

登记时期望：条目被人工确认完成（done）时，系统自动将其历史 blocked run 标记为已取消/已关闭（或提供人工取消命令），批次 check 与回执计数同步不再计入。细化为：

- 条目经人工确认完成（in-progress → done）时，系统自动把该条目名下仍处 blocked 终态的批次 run 标记为已取消/已关闭：账本留痕（记录取消时间与操作路径，如「随条目完成关闭」），不抹除历史记录；`checkBatch` / `batchSummary` / `batchBrief` 与看板任务面板的受阻计数（counts.blocked / blockedRuns）同步不再计入，运行记录展示「已取消」类标注而非裸受阻。
- 或/并提供人工取消入口（如 `atb run cancel <RUN-ID>`，仅对 blocked 终态、条目已 done 或人工显式确认的场景开放），与自动闭环互补；自动 / 人工命令 / 双轨的具体取舍在开发阶段 design.md 定稿。
- 不误伤正常受阻：条目未完成时 blocked 计数照常统计（含依赖受阻 blockedPending 口径）；同条目后续再次受阻产生的新 blocked run 按最新终态正常计数；failed / interrupted / skipped 终态不在本单范围（如需同样处理，开发阶段在 design.md 一并定夺）。
- 存量残留（本仓库 batch-20260913-048 / run-20260916-266）修复后有明确消解途径（自动生效，或可人工触发清理）。

## 验收说明

- 新增回归测试（`scripts/tests/bug-<单号小写>.test.mjs`）：blocked → 手工通道上报 → 确认 done 后，`checkBatch` counts.blocked 归零、run 记录留存且带取消留痕；blocked → 条目未完成时计数保持不变（不误清）；同条目先 blocked 后在同批次内 reported 的既有口径不回归。
- 界面：看板任务面板「受阻待处理 N」与异常口径（失败 + 受阻回执 + 中断）不再计入已取消的 blocked run；运行记录列表对已取消回执展示「已取消（随条目完成关闭）」类标注。
- 存量数据：本仓库 batch-20260913-048 的受阻计数经修复后可归零（自动或人工命令触发）。
- `npm test` 全量通过，现有 batch 相关测试（如 batch-core / batch-queue 套件）无回归。
- 引入来源归因与修复方案细节（取消形态的账本字段、向后兼容、是否顺带覆盖 failed 等终态）在开发阶段补入 design.md。

## 界面展示

可交互演示见 [./ui-demo.html](./ui-demo.html)（单文件、无外网依赖、浏览器直接打开）。演示覆盖：

- 界面布局：模拟看板「任务 → 批量开发」面板——批次状态徽标、提示区（受阻警示 / 完成结果）、计数行（上报 / 失败 / 受阻待处理 / 待处理）、本批次运行记录列表、条目状态卡（BUG-20260916-001 状态流转时间线）与数据检视（run.phase / counts.blocked / manual 记录口径）。
- 交互行为：按实例链路分步回放（① worker 认领并交受阻回执 → ② 手工通道实施并上报 → ③ 人工确认完成带二次确认）；「Bug 现状 / 修复后期望」模式切换对照——缺陷模式下确认完成后「受阻待处理 1」永久残留（红色强调），修复模式下确认完成时自动取消历史受阻回执、计数归零并展示取消留痕；修复模式另提供「atb run cancel」可选人工入口演示（标注形态以 design.md 定稿为准）。
- 状态反馈：各步骤按钮的加载态与分步引导、操作结果 toast（成功 / 缺陷提示）、确认完成的二次确认弹层（可取消）、重置后的初始空态、批次「执行中 / 已结束」徽标切换。
- 主题适配深浅色（跟随系统 `prefers-color-scheme`，可选）。
