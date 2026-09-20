# 设计 — BUG-20260908-015 已终止完善任务可被暂停操作复活为未结束状态

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260907-003（引入 `pauseRefineBatch`，当时即无终态判断；该阶段批次仅自然收尾一种终态、入口少，未暴露）。与 REQ-20260908-020 引入的人工终止语义（`abortRefineBatch` 收尾置 `status:'finished'` + `abortRequested/aborted`，并把「暂停后续」按钮与 `/api/refine/pause` 入口带进看板/CLI/HTTP）交互后缺陷可稳定触达，由 REQ-20260908-020 深测 D12 发现（测试关联 ≠ 引入来源，两个编号均经 `atb list` 核验存在）。

## 根因分析

`scripts/lib/refine-store.mjs` 的 `pauseRefineBatch`（修复前 904–915 行）无任何终态判断：

- `abortRefineBatch` 收尾置 `status:'finished'`、`abortRequested:true`、`aborted:true`；随后 `pauseRefineBatch(…, true)` 因无在途运行命中 `if (paused && !active) batch.status = 'paused'`，把终态批次改写为 paused 并写入 `pauseRequested:true`；恢复方向 `pause(false)` 再经 `batch.status = runs.length ? 'running' : 'prepared'` 把 finished 翻回 running/prepared。
- 三入口直通该函数且均无守卫：Web 终止面板「暂停后续」按钮不区分 `aborted`/`batchDone`（`scripts/web/app.js` `renderRefinePanel`）、HTTP `POST /api/refine/pause`、CLI `atb refine pause`。
- 后果：status 由 finished 翻成 paused 后批次重新落入 `unfinishedRefineBatches` 队首，`/api/refine/current` 把已终止批次当"当前任务"展示、启动区被占用；面板同时出现「已终止」与「已请求暂停」矛盾提示。派发侧有 `abortRequested` 兜底不会真重派，但状态、队列口径与界面展示已被污染。

## 方案

库层幂等拒绝 + 入口透传明确错误 + 界面撤入口（与「终止任务」收尾后隐藏口径一致）：

1. **库层**（`scripts/lib/refine-store.mjs`）：新增导出 `refineBatchTerminalReason(batch)`——`abortRequested/aborted` 或 `status === 'finished'` 返回可读原因（「任务已人工终止，不能暂停/恢复」/「任务已结束，不能暂停/恢复」），否则 null；`pauseRefineBatch` 开头命中即原样返回批次（不写 `pauseRequested`、不改 `status`、不触 `lastActivityAt`），暂停与恢复两方向同样拒绝。
2. **CLI**（`scripts/atb.mjs` `refine pause`）：领取批次后先查 `refineBatchTerminalReason`，命中 `die("完善批次 <id> …")` 非零退出。
3. **HTTP**（`scripts/server.mjs` `/api/refine/pause`）：同样前置检查，命中 `throw new core.AtbError(...)` → 沿用现有协议返回 400 `{error}`，不再 `ok:true` 静默成功。
4. **界面**（`scripts/web/app.js` `renderRefinePanel`）：新增 `batchTerminal = b.aborted || b.status === 'finished'`，终态批次不渲染 `#refinePause` 按钮（`#refineAbort` 在 batchDone 隐藏的既有口径不变）；`toggleRefinePause` 的 catch 兜底保留。

选择「库层幂等拒绝（不抛错）+ 入口抛错」而非「库层直接抛错」：deep-probes D12 直接裸调 `pauseRefineBatch(…, true)` 后断言 status 仍为 finished，库层抛错会使探测用例本身 FAIL；幂等拒绝同时满足验收的「抛错或幂等拒绝」两可口径。

## 风险与边界

- 正常批次的暂停/恢复不受影响：终态守卫只在 finished/aborted 命中，prepared/running/paused 路径原样保留（R9/R10b 回归通过）。
- `queueHeadRefineBatch` 在全部批次结束后的「回退最新」语义保留：终止批次仍可作为面板收尾展示（供「启动新任务」入口），但不再进未结束队列、不会被 pause 复活为队首。
- 开发批次链路存在同类隐患（`batch.mjs` `pauseBatch` 无终态判断、`#batchPause` 按钮同样无条件渲染、`/api/batch/pause` 无守卫），属本 Bug 范围外，已按规范登记 BUG-20260908-023（不填引入来源）。

## 实施记录（2026-09-08，owner zcode-batch-018-1）

- TDD：先补 4 处红用例再实现——`refine-store.test.mjs` R13（库层：abort 后 pause(true)/(false) 字段全不变、正常 finished 批次不复活、终态不入未结束队列、正常暂停/恢复回归）、`refine-cli.test.mjs` R10d（CLI 报错且批次不变）、`refine-serve.test.mjs` R11b（HTTP 400 + error 而非 ok:true、current 口径不被污染）、`refine-ui.test.mjs` R12-9（终止/正常收尾面板无 `#refinePause`、运行中/已暂停保留）。跑红确认后实现上述方案，全部转绿。
- 改动文件：`scripts/lib/refine-store.mjs`（`refineBatchTerminalReason` + `pauseRefineBatch` 守卫）、`scripts/atb.mjs`（pause 子命令前置校验）、`scripts/server.mjs`（/api/refine/pause 前置校验）、`scripts/web/app.js`（终态不渲染暂停按钮）+ 四个测试文件。
- 验证：deep-probes 12/12 PASS（D12 转 PASS，D07/D08 等不回退）；`scripts/tests/run-all.mjs` 全量 95 个测试文件 0 失败。
