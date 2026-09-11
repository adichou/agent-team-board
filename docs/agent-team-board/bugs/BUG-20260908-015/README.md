# BUG-20260908-015 已终止完善任务可被暂停操作复活为未结束状态

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260907-003（引入 `pauseRefineBatch` 时即无终态判断；与 REQ-20260908-020 的人工终止语义交互后暴露，深测 D12 发现）
- 创建：2026-09-08T12:13:47.178Z

## 现象

REQ-20260908-020 深测发现（D12）。abort 后 pause(true)，status 从 finished 变成 paused，但 abortRequested 仍为 true；终止面板仍显示暂停按钮。应拒绝终态暂停并保持 finished。 复现：node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs。原始结果：同目录 deep-probes.log。

细化（基于当前代码核对）：

- 根因位置：`scripts/lib/refine-store.mjs` 的 `pauseRefineBatch`（约 807–818 行）没有任何终态判断——不检查 `batch.abortRequested` / `batch.aborted`，也不检查 `batch.status === 'finished'`。`abortRefineBatch` 收尾时置 `status: 'finished'`、`abortRequested: true`、`aborted: true`（约 791–795 行）；随后对同一批次调用 `pauseRefineBatch(dataDir, batchId, true)` 时，因无在途运行（active=false）命中 `if (paused && !active) batch.status = 'paused'`，已终止批次被改写为 paused。
- 可触达入口（三处都直通该函数）：
  - Web 终止面板：「任务 → 批量完善」中已终止批次详情仍渲染「暂停后续」按钮（`scripts/web/app.js` 的 `renderRefinePanel`，约 3444–3447 行：`refinePause` 按钮不区分 `b.aborted` / `batchDone`，而「终止任务」按钮在 batchDone 时会隐藏）；
  - HTTP：`POST /api/refine/pause`（`scripts/server.mjs` 约 1491–1501 行，`paused` 缺省即 true）；
  - CLI：`atb refine pause --batch <batchId>`（`scripts/atb.mjs` 约 678–688 行）。
- 后果：
  - 已终止批次 status 由 finished 翻成 paused 后，重新落入 `unfinishedRefineBatches`（`status !== 'finished'`，refine-store.mjs 约 251–257 行）并成为 `queueHeadRefineBatch` 队首，看板 `/api/refine/current` 持续把已终止批次当作"当前任务"展示，启动区不出现；
  - 面板同时显示「已终止」warn 提示与「已请求暂停后续领取」info 提示，且按钮变为「恢复后续领取」；再点恢复（pause=false）会经 `batch.status = state.runs.length ? 'running' : 'prepared'`（约 813–815 行）把已终止批次进一步翻成 running/prepared；
  - 派发侧有兜底、不会真的重新派发：`nextRefineItem` 先检查 `abortRequested` 返回 `stop: 'aborted'`（约 591–593 行）；`createRefineBatch` 的队列盘点也会把无剩余的未结束批就地 finished（约 363–376 行）。但批次状态、队列口径与界面展示已被污染，与 REQ-20260908-020「终止后任务转终止态、可重新启动新任务」的验收相悖。

## 复现步骤

方式 A（深测夹具，独立临时项目，不碰真实数据）：

1. `node /Users/adichou/Documents/src/agent-team-board/docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`
2. 查看输出中用例 D12「已终止任务的暂停请求不应复活任务」：当前为 FAIL，actual `'paused'`，expected `'finished'`（原始记录见同目录 deep-probes.log）。

方式 B（库层最小序列，等价于 D12 内部逻辑）：

1. 准备一个已接受（accepted）且未完善的条目，`createRefineBatch` 创建完善任务；
2. 调用 `abortRefineBatch(dataDir, batchId)`：批次转 finished、abortRequested=true；
3. 调用 `pauseRefineBatch(dataDir, batchId, true)`；
4. `getRefineBatch(dataDir, batchId).status` 返回 `paused`（期望仍为 `finished`）。

方式 C（看板界面路径）：

1. 启动看板，「任务 → 批量完善」面板创建并运行一个完善任务；
2. 点击「终止任务」并二次确认：批次转已终止（finished + aborted）；
3. 终止后的面板操作区仍显示「暂停后续」按钮，点击它；
4. 刷新后状态条出现「已请求暂停后续领取」提示，批次状态变为 paused，启动区被这个"复活"的已终止任务占用。

## 期望行为

- `pauseRefineBatch` 对终态批次一律拒绝暂停：批次 `abortRequested`（或 `aborted`）为 true、或 `status === 'finished'` 时，不写入 `pauseRequested`、不改动 `status`，保持 finished 终止态；返回/抛错沿用现有 `AtbError` 口径并给出可读原因（如「任务已终止/已结束，不能暂停」）。恢复方向同理：对已终止批次 `pause(false)` 也不得把 finished 翻回 running/prepared。
- CLI 与 HTTP 入口透传该拒绝：`atb refine pause --batch <已终止批次>` 与 `POST /api/refine/pause` 返回明确错误信息，而不是静默成功；错误响应协议沿用各入口现有的 `AtbError` 处理方式（具体状态码/报文格式以现有实现为准）。
- 看板「批量完善」面板对已终止批次不再提供可点的「暂停后续」入口（与「终止任务」按钮在收尾后隐藏的口径一致）；已终止批次不因任何暂停请求重新进入未结束队列/队首。

## 验收说明

- 复跑 `docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`：D12 转 PASS（abort 后 pause(true)，`getRefineBatch().status` 保持 `finished`，`abortRequested` 保持 true）；已 PASS 用例（D07 终止后迟到回执、D08 暂停/恢复等）不因本修复回退。
- 库层断言：abort 后 `pauseRefineBatch(…, true)` 抛错或幂等拒绝，批次字段（status / abortRequested / aborted / pauseRequested）与调用前一致；abort 后 `pauseRefineBatch(…, false)` 同样不得改动终态。
- CLI：对已终止批次执行 `atb refine pause --batch <batchId>` 输出错误提示且批次状态不变；HTTP `POST /api/refine/pause` 对已终止批次返回错误而非 `ok: true`。
- 界面：终止后的批量完善面板不再出现可点的「暂停后续」按钮；`/api/refine/current` 不再把已终止批次当作当前未结束任务返回。
- 回归：正常批次的暂停/恢复行为不受影响（`scripts/tests/refine-store.test.mjs` 现有 pause 用例、`scripts/tests/tasks-refine.test.mjs` 终止相关用例全部通过）；`atb refine` / `atb batch` 其余子命令行为不变。
- 引入来源归因与修复方案细节在开发阶段补入 design.md（本 Bug 由 REQ-20260908-020 深测发现，测试关联不等于历史引入来源）。
