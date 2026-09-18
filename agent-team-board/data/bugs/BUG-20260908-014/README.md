# BUG-20260908-014 批量完善终止后面板缺少重新启动入口

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-08T12:13:47.074Z

## 现象

REQ-20260908-020 深测发现（D06）。批量完善任务在面板「终止任务」后，任务模块「批量完善」面板既不显示启动区（`refineCreate`「启动批量完善」按钮），也不显示「启动新任务」（`refineNext`）按钮——用户没有重新启动入口，只能通过 CLI 或绕路方式新建任务。

- 深测复现：`node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`，D06 断言失败：`终止面板没有 refineNext/refineCreate 启动按钮`；原始结果见同目录 `deep-probes.log`（TOTAL 12; PASS 5; FAIL 7，其中 D06 FAIL）。
- 代码层面的成因（修复阶段据此归因，此处仅登记证据链）：
  - `abortRefineBatch`（`scripts/lib/refine-store.mjs`）终止后把批次置为 `status='finished'` 且 `aborted=true`，批次仍是「最新批次」；
  - `/api/refine/current`（`scripts/server.mjs`）经 `queueHeadRefineBatch`（`scripts/lib/refine-store.mjs`）解析：无未结束批次时回退返回最新批次，因此终止后接口仍返回该 aborted batch 作为 `batch`；
  - `renderRefinePanel`（`scripts/web/app.js`）中：启动区仅在 `!data.batch` 时渲染（无 `refineCreate`）；「启动新任务」`refineNext` 仅在 `batchDone && !b.aborted` 时渲染（`scripts/web/app.js` 中 `batchDone = b.status === 'finished' && (counts.remaining ?? 0) === 0`）。终止态 `b.aborted=true` 把 `refineNext` 条件否掉，`data.batch` 非空把启动区条件否掉——两个入口同时消失。

## 复现步骤

方式 A：看板 UI 手工复现

1. 准备至少一个「已接受且未完善」条目（否则无候选，启动按钮不出现）。可在看板新建一个需求/Bug 条目并置为已接受。
2. 启动看板：`node /Users/adichou/Documents/src/agent-team-board/scripts/server.mjs`（或 `npm run app` 用 Electron 打开），浏览器访问看板页面。
3. 顶栏进入「任务」→「批量完善」子面板，选择执行 Agent 后点击「启动批量完善」（`refineCreate`），确认任务创建（面板进入运行态，显示批次号/计数/操作按钮）。
4. 点击「终止任务」（`refineAbort`），在二次确认弹窗中确认（弹窗文案承诺「终止后可立即启动新任务」）。
5. 观察终止后的「批量完善」面板：状态条显示「已终止」芯片与「任务已人工终止…」提示，但整页没有任何「启动批量完善」或「启动新任务」按钮——重新启动入口缺失，即为本 Bug。

方式 B：深测夹具（推荐，可自动断言）

1. `node /Users/adichou/Documents/src/agent-team-board/docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`
2. 查看输出的 D06 用例「终止后应显示重新启动入口（执行真实渲染函数）」：FAIL，actual 为 `终止面板没有 refineNext/refineCreate 启动按钮`（该夹具用临时项目执行真实的 `renderRefinePanel` 渲染函数并断言 HTML 含 `id="refineNext"` 或 `id="refineCreate"`）。

方式 C：最小接口链复现（不依赖 UI）

1. 在临时项目初始化看板数据并创建一个已接受条目；
2. 创建完善批次后调用 `POST /api/refine/abort`（或 `atb refine abort`）终止；
3. `GET /api/refine/current`：可见 `batch` 仍为该终止批次（`aborted: true, status: "finished"`）而非 `null`——这是启动区不出现、且 `refineNext` 被 `!b.aborted` 条件隐藏的直接来源。

## 期望行为

- 终止后的「批量完善」面板必须提供重新启动入口，与 REQ-20260908-020「界面展示 → 任务模块交互行为」的约定一致：「终止后启动区恢复，可重新启动新任务」，也与终止确认弹窗文案「终止后可立即启动新任务」（`scripts/web/app.js` 的 `abortRefineTask`）对齐。
- 具体口径（满足其一即可，二选一由 design 阶段定）：
  1. 终止批次面板内出现「启动新任务」按钮（`refineNext`，复用 `createRefineBatchAndCopy` 创建流程），即把 `batchDone && !b.aborted` 的按钮条件放宽为「批次已收尾（finished 且 remaining=0，含终止态）」；或
  2. 终止批次收尾后面板回退显示启动区（`refineCreate`，含候选实时清单/执行 Agent 选择/开发人员输入），即 `/api/refine/current` 对「已终止且已收尾」的批次不再作为 `batch` 返回（或前端按同口径处理）。
- 入口点击后的行为沿用现有创建流程：以当前已接受未完善候选创建新任务并复制主调度提示词（幂等：候选一致时不重复建批）。
- 不得回归的边界（与 D06 同批用例一致）：终止态不得被「暂停/恢复」请求复活（D12 口径）；终止后迟到的 `refine done` 不得污染新任务状态（D07，当前已 PASS）；启动区恢复后无候选时应显示「暂无可完善候选」说明而非报错。

## 验收说明

- 自动验证：运行 `node /Users/adichou/Documents/src/agent-team-board/docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`，D06「终止后应显示重新启动入口（执行真实渲染函数）」由 FAIL 转 PASS（断言终止态面板渲染 HTML 含 `id="refineNext"` 或 `id="refineCreate"`），且其余原 PASS 用例（D07/D08/D09/D10/D11）不回归。
- 手工验证（UI）：
  1. 按「复现步骤 方式 A」走通终止流程，终止后面板出现重新启动入口；
  2. 点击该入口能创建新完善任务（新批次号出现，主调度提示词复制，计数重新开始），且被终止批次的执行记录/出局账仍可查看；
  3. 无候选时（所有已接受单均已完善）入口呈现禁用或「暂无可完善候选」提示，不出现接口报错；
  4. 终止态下再点「暂停/恢复后续」不改变终止状态（批次保持 finished + aborted）。
- 回归范围：`scripts/web/app.js` 的 `renderRefinePanel`/`refineSummary` 相关渲染与 `/api/refine/current`、`queueHeadRefineBatch` 口径（若方案 2 触及后端）；不得影响批量开发面板的终止/重启同类交互。
- 修复阶段须在 design.md 完成引入来源归因（本 Bug 属 REQ-20260908-020 实现遗漏终止后交互闭环），并补充根因分析与方案选择（方案 1 或 2）。
