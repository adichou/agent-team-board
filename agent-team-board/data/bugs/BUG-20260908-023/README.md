# BUG-20260908-023 已终止/已结束的开发批次可被暂停操作复活为未结束状态

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-08T15:49:23.312Z

## 现象

BUG-20260908-015 在批量完善链路（refine-store.mjs pauseRefineBatch）的同类隐患，出现在批量开发链路：scripts/lib/batch.mjs 的 pauseBatch（约 949-960 行）无终态判断——abortBatch 收尾置 status:'finished' + aborted:true 后，调用 pauseBatch(…, true) 因无在途运行命中 if (paused && !active) batch.status='paused'，已终止批次被改写为 paused 并重新落入未结束队列；恢复方向 pause(false) 亦会把 finished 翻回 running。可触达入口：Web 任务面板「批量开发」#batchPause 按钮对终态批次仍渲染（scripts/web/app.js renderImplPanel 约 3389 行，终止任务按钮在 batchDone 时隐藏而暂停按钮不区分）；HTTP POST /api/batch/pause（scripts/server.mjs 约 1378 行）；暂停 CLI 入口。期望：pauseBatch 对 abortRequested/aborted 或 status==='finished' 的批次一律拒绝（不写 pauseRequested、不改 status），CLI/HTTP 返回明确错误，看板终态批次不再提供「暂停后续」入口；正常批次暂停/恢复不回归。修复时可参考 refine 侧已落地的 refineBatchTerminalReason + pauseRefineBatch 幂等拒绝 + 入口透传方案。

## 复现步骤

方式 A（库层最小序列，Node 直接调用 `scripts/lib/batch.mjs`，等价于 refine 侧 D12 探针的批量开发版）：

1. 在临时项目目录初始化看板数据（`docs/agent-team-board`），准备至少 1 个 accepted 状态条目，`createBatch` 创建开发批次（status=running）；
2. 调用 `abortBatch(dataDir, batchId)`（`scripts/lib/batch.mjs` 991–1023 行）：收尾置 `status:'finished'`、`abortRequested:true`、`aborted:true`，剩余候选全部落 skipped 出局账，`currentRunId=null`；
3. 调用 `pauseBatch(dataDir, batchId, true)`（同文件 949–960 行）：无终态判断，因无在途运行（active=false）命中 `if (paused && !active) batch.status = 'paused'`，同时写入 `pauseRequested:true`；
4. `getBatch(dataDir, batchId).status` 返回 `'paused'`（期望仍为 `'finished'`）；批次重新落入 `unfinishedBatches`（`status !== 'finished'` 过滤，batch.mjs 288–292 行）并成为 `queueHeadBatch` 队首；
5. 再调用 `pauseBatch(dataDir, batchId, false)`：命中 `else if (!paused && batch.status === 'paused') batch.status = 'running'`，已终止批次进一步翻回 running。

方式 A'（正常结束批次，同一缺陷面）：对一个自然收尾（remaining=0、status='finished'、无 aborted 标记）的批次执行步骤 3–4，同样把 finished 复活为 paused——终态判断缺失不止影响已终止批次。

方式 B（CLI 路径）：

1. `node scripts/atb.mjs batch abort --batch <batchId>`：批次转已终止（finished + aborted）；
2. `node scripts/atb.mjs batch pause --batch <batchId>`（`scripts/atb.mjs` 860–870 行，无终态判断）：返回 `✓ 已请求暂停后续领取`（静默成功），批次 status 被改写为 paused；`--off` 恢复方向同理翻回 running。

方式 C（看板界面路径）：

1. 启动看板（server + web），「任务 → 批量开发」面板创建并运行一个开发批次；
2. 点击「终止任务」并二次确认：批次转 finished + aborted，剩余项出局（skipped），`batchDone=true` 后「终止任务」按钮隐藏（`scripts/web/app.js` renderImplPanel 3393 行），但「暂停后续」按钮仍渲染（3392 行，不区分 `b.aborted` / `batchDone`）；
3. 点击「暂停后续」：`toggleBatchPause` 发送 `POST /api/batch/pause`（app.js 3873–3887 行；`scripts/server.mjs` 1379–1389 行，无终态判断，`paused` 缺省即 true）返回 `ok:true`；
4. 刷新后：状态条同时出现「任务已人工终止」warn 提示与「已请求暂停后续领取」info 提示，按钮变为「恢复后续领取」，数据检视口径下 status=paused；`/api/batch/current` 缺省解析队首（server.mjs 1314 行起 `queueHeadBatch`），持续把这个"复活"的已终止批次当作当前任务展示，创建新批的启动区被占用；
5. 继续点击「恢复后续领取」（paused:false）：status 翻回 running，已终止批次在队列口径中完全"复活"。

注：派发侧有兜底、不会真的重新派发——`nextBatchItem` 先检查 `abortRequested` 返回 `stop: 'aborted'`（batch.mjs 664 行），且主调度核对（checkBatch）对 `abortRequested` 返回 stop（884–886 行）；但批次状态、队列口径与界面展示已被污染，与 REQ-20260908-020「终止后任务转终止态、可重新启动新任务」的收尾语义相悖。

## 期望行为

- `pauseBatch` 对终态批次一律拒绝：批次 `abortRequested`（或 `aborted`）为 true、或 `status === 'finished'` 时，不写入 `pauseRequested`、不改动 `status`，保持 finished 终态。修复方案对齐 refine 侧已落地的 BUG-20260908-015：提供同口径终态判定函数（参照 `refineBatchTerminalReason`，`scripts/lib/refine-store.mjs` 973–977 行）+ `pauseBatch` 幂等拒绝（参照 `pauseRefineBatch` 983 行）。
- CLI 与 HTTP 入口透传该拒绝并返回明确错误：`atb batch pause --batch <已终止批次>` 与 `POST /api/batch/pause` 对终态批次返回可读错误（如「任务已人工终止，不能暂停/恢复」「任务已结束，不能暂停/恢复」）而非静默成功（参照 atb.mjs 705–718 行 `die` 透传、server.mjs 1502–1515 行 `AtbError` 透传）；HTTP 入口缺省目标 `queueHeadBatch` 的解析不受影响。恢复方向同理：对已终止/已结束批次 `pause(false)` 也不得把 finished 翻回 running。
- 看板「批量开发」面板对已终止/已结束批次不再提供可点的「暂停后续」入口（与「终止任务」按钮在 batchDone 时隐藏的口径一致）；已终止批次不因任何暂停请求重新进入未结束队列/队首。
- 正常批次不回归：非终态批次的暂停（阻止领取下一项、在途不受影响）与恢复（含 needs_attention「暂停→恢复」解除项目占用的链路，batch.mjs 957–958 行 `releaseImplLockIf`）保持现状——已终止批次的 attention 占用在 `abortBatch` 内已全量释放（1014 行），终态拒绝不影响该语义。

## 验收说明

- 库层断言：abort 后 `pauseBatch(…, true)` 抛错或幂等拒绝，批次字段（status / abortRequested / aborted / pauseRequested / currentRunId）与调用前一致；abort 后 `pauseBatch(…, false)` 同样不得改动终态；对正常结束（无 aborted 标记）的 finished 批次两个方向同样拒绝。
- CLI：对已终止批次执行 `atb batch pause --batch <batchId>`（及 `--off` 恢复方向）输出明确错误提示且批次状态不变，不再返回 `✓ 已请求暂停`。
- HTTP：`POST /api/batch/pause` 对已终止/已结束批次返回错误而非 `ok:true`（错误协议沿用入口现有 `AtbError` 处理方式，具体状态码/报文格式以现有实现为准）。
- 界面：终止后的「批量开发」面板不再出现可点的「暂停后续」按钮；`/api/batch/current` 不再把已终止批次当作当前未结束任务返回；`unfinishedBatches` / `queueHeadBatch` 口径不再纳入被暂停请求触碰过的已终止批次。
- 回归：正常批次的暂停/恢复行为不受影响——`scripts/tests/batch-core.test.mjs` 现有 pause 用例（约 243–244、473–483、659–661 行）、`scripts/tests/batch-queue.test.mjs`（约 199–203 行）全部通过；needs_attention「暂停→恢复」解除项目占用链路、`atb batch` 其余子命令行为不变。
- 引入来源归因与修复方案细节在开发阶段补入 design.md（本 Bug 为 BUG-20260908-015 在批量开发链路的同类隐患，与 REQ-20260908-020 人工终止语义交互后暴露）。

## 界面展示

可交互演示见 [./ui-demo.html](./ui-demo.html)（单文件、无外网依赖、浏览器直接打开）。演示覆盖：

- 界面布局：模拟看板「任务 → 批量开发」面板——状态行（批次状态徽标 + 批次号 + 执行 Agent）、提示区（warn「任务已人工终止」/ info「已请求暂停后续领取」）、计数行（上报 / 失败 / 出局 / 待处理）、批次记录列表、操作区（暂停后续 / 恢复后续领取 / 终止任务 / 查看批次记录），以及实时「批次数据检视」（status / abortRequested / aborted / pauseRequested 与未结束队列口径）。
- 交互行为：「终止任务」带二次确认，收尾后剩余项落 skipped、批次转已终止；「Bug 现状」模式下已终止批次仍可点「暂停后续」→ 状态被改写为 paused 并重新进入未结束队列，「恢复后续领取」进一步翻回 running；「修复后期望」模式下终态批次不再渲染「暂停后续」按钮，直接调用则返回明确错误提示。提供「Bug 现状 / 修复后期望」模式切换与「模拟请求失败」开关。
- 状态反馈：请求中的按钮加载态、操作结果 toast（成功/失败）、终态/暂停/运行中的提示区切换、轮询刷新的加载态、「删除本批次」后的空态（尚无批次 + 创建新批启动区）。
- 主题适配深浅色（跟随系统 `prefers-color-scheme`，可选）。
