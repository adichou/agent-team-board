# 设计 — BUG-20260908-023 已终止/已结束的开发批次可被暂停操作复活为未结束状态

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260906-002（Zcode 批量实施——`pauseBatch` 随批次核心层引入时即无终态判断，已核验单号真实存在）
- 暴露交互：REQ-20260908-020（人工终止收尾把批次置 `finished + aborted` 终态后，暂停入口成为唯一能改写终态的路径）
- 同类先例：BUG-20260908-015（完善链路同型缺陷，已先行修复，本 Bug 对齐其方案）

## 根因分析

`scripts/lib/batch.mjs` 的 `pauseBatch`（修复前 949–960 行）只按「有无在途运行」与当前 status 分支写状态：

```js
batch.pauseRequested = Boolean(paused);
if (paused && !active) batch.status = 'paused';
else if (!paused && batch.status === 'paused') batch.status = 'running';
```

没有任何终态判断。`abortBatch` 收尾置 `status:'finished' + abortRequested:true + aborted:true`、`currentRunId=null` 后，对已终止批次调 `pauseBatch(…, true)`：因无在途运行（`active=false`）命中第一分支，`finished` 被改写为 `paused` 且写入 `pauseRequested:true`——批次重新落入 `unfinishedBatches`（`status !== 'finished'` 过滤）并成为 `queueHeadBatch` 队首，污染 `/api/batch/current` 的缺省解析与「创建新批」启动区；`pauseBatch(…, false)` 恢复方向再把 `finished` 翻回 `running`，已终止批次在队列口径中完全「复活」。自然收尾（`remaining=0` → `finished`，无 aborted 标记）的批次同样命中该缺陷面。派发侧虽被 `nextItem` 的 `abortRequested` 检查与 `checkBatch` 兜底（不会真的重新派发），但批次状态、队列口径与界面展示已被污染，与 REQ-20260908-020「终止后转终止态、可重新启动新任务」的收尾语义相悖。

CLI（`atb batch pause`）与 HTTP（`POST /api/batch/pause`）入口直接透传库层结果，对终态批次静默成功；Web 面板「暂停后续」按钮此前也不区分终态（本 Bug 登记后、修复前，REQ-20260908-026 已先行在 `renderZcodeBatchPanel` 引入 `terminal` 口径隐藏该按钮，本次以回归测试锁定）。

## 方案

对齐 refine 侧 BUG-20260908-015 已落地的三件套：

1. **库层终态判定 + 幂等拒绝**（`scripts/lib/batch.mjs`）：新增导出 `batchTerminalReason(batch)`——`abortRequested || aborted` 返回「任务已人工终止，不能暂停/恢复」、`status === 'finished'` 返回「任务已结束，不能暂停/恢复」、非终态返回 `null`（与 `refineBatchTerminalReason` 同口径同文案）。`pauseBatch` 开头先判终态，命中即原样返回批次对象：不写 `pauseRequested`、不改 `status`（两个方向一致），不触发保存与 `releaseImplLockIf`。
2. **CLI 透传**（`scripts/atb.mjs` `batch pause` 子命令）：调用前先 `batchTerminalReason(getBatch(...))`，命中即 `die("批次 <ID> <原因>")` 非零退出，不再输出「✓ 已请求暂停」。
3. **HTTP 透传**（`scripts/server.mjs` `POST /api/batch/pause`）：解析目标批次后先判终态，命中 `throw new core.AtbError(reason)` → 现有错误协议 400 `{error}`；缺省目标 `queueHeadBatch || latestBatch` 的解析逻辑不变。
4. **界面回归锁定**（`scripts/tests/batch-ui.test.mjs` 新增 U16）：提取真实 `renderZcodeBatchPanel` 源码在 vm 中渲染——终止收尾态与正常完成态面板不出现 `#batchPause`，运行中/已暂停面板保留（含「恢复后续领取」文案）。

测试（TDD 先红后绿）：

- `batch-core.test.mjs` 新增：abort 后 `pauseBatch(true)/(false)` 幂等拒绝，`status/abortRequested/aborted/pauseRequested/currentRunId` 与调用前一致；`unfinishedBatches`/`queueHeadBatch` 不被污染；正常收尾 `finished` 批次两方向同样拒绝（`batchTerminalReason` 文案断言）；非终态批次暂停/恢复回归不受影响。
- `batch-cli.test.mjs` 新增 Z14b：已终止批次 `atb batch pause`（及 `--off`）非零退出 + 「不能暂停/恢复」明确报错，summary `--json` 核对状态不变；正常新批次暂停/恢复照常。
- `batch-serve.test.mjs` 新增：`/api/batch/pause` 对已终止批次返回 400 `{error}`（不返回 `ok:true`）、恢复方向同样 400、`/api/batch/current` 的 queue 口径不含被触碰过的终态批次；自然收尾批次（库层驱动全部回执）同样 400「任务已结束，不能暂停/恢复」。

## 风险与边界

- **needs_attention「暂停→恢复」解除占用链路不受影响**：该场景批次 status 为 `needs_attention`（非终态），守卫不拦截；已终止批次的 attention 占用在 `abortBatch` 内已全量释放（`releaseImplLockIf(() => true)`），拒绝路径无需补偿释放。
- **暂停后自然收尾的批次**：`finishRun` 对 `pauseRequested=true` 的批次在 remaining=0 时同样置 `finished`（保留 pauseRequested 标记）；此后恢复方向的 pause(false) 会被终态守卫拒绝——语义正确（已结束无需恢复），与 refine 侧一致。
- **返回值兼容**：`pauseBatch` 终态拒绝时返回批次对象（同 refine 侧 `pauseRefineBatch` 幂等拒绝口径）；入口层先行判定使 CLI/HTTP 正常路径行为不变。
- **HTTP 缺省目标解析不变**：`queueHeadBatch || latestBatch` 照旧；终态批次本就不入 `unfinishedBatches`，修复后不会再被暂停请求复活进队首。
- 修复中发现的相关缺陷另行登记：BUG-20260909-001（`/api/batch/current` 未透出 `aborted`/`abortRequested`，面板「已终止」徽标/warn 分支经 HTTP 不触发；不影响本 Bug 的按钮隐藏——`terminal` 兜底 `status==='finished'`）。
