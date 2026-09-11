# BUG-20260908-016 批量完善没有显示 zcode 和codex 的选择，生成的提示词都是 zcode

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：BUG-20260908-014（「启动新任务」入口复用创建流程但运行态面板无执行 Agent 选择，静默回退默认 zcode；双 Agent 能力来自 REQ-20260908-020）
- 创建：2026-09-08T13:04:04.894Z

## 现象

REQ-20260908-020 深测/使用发现。看板「任务 → 批量完善」面板在完善任务已存在（运行中或已结束）时，整个面板不渲染「执行 Agent：zcode / codex」选择控件；用户从收尾面板点「启动新任务」后，新任务一律按默认 `zcode` 模式创建，复制到剪贴板的主调度提示词全部是 zcode 版（提示词首部为「执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词…」），没有任何途径选到 codex。

细化（基于当前代码核对）：

- 执行 Agent 选择（`#refineMode` 下拉）只存在于创建面板：`scripts/web/app.js` 的 `renderRefinePanel`（约 3371–3405 行）在 `!data.batch` 分支里渲染（约 3392–3397 行）；而 `/api/refine/current`（`scripts/server.mjs` 约 1460–1477 行）用 `queueHeadRefineBatch` 取当前批次——该函数「全部结束回退最新」（`scripts/lib/refine-store.mjs` 约 259–262 行：`unfinishedRefineBatches(dataDir)[0] || listRefineBatches(dataDir)[0] || null`）。即：只要本项目创建过任意一个完善任务，`data.batch` 永远非空，面板永远走运行态分支（约 3407–3449 行），带选择的创建面板从此不再出现。
- 收尾面板的「启动新任务」按钮（`#refineNext`，约 3424–3427 行，`batchDone && !b.aborted` 时显示）直接绑定 `createRefineBatchAndCopy`（约 3636–3637 行）；该函数取执行 Agent 的逻辑是 `$('#refineMode')?.value || state.refine.mode || 'zcode'`（约 3469 行）——运行态面板里没有 `#refineMode`，于是回退 `state.refine.mode`，其初始值即 `'zcode'`（约 141 行），且只有创建面板下拉的 change 事件才会改它（约 3629–3633 行）。结果：从「启动新任务」创建的新任务 mode 恒为 zcode，`createRefineBatch` 按 zcode 生成差异化提示词（`scripts/lib/refine-store.mjs` 约 296–318 行、346–348 行），toast 与面板也只显示 zcode。
- 该问题不是设置隐藏导致：批量任务设置中 refine 的 Agent 展示为 `["zcode","codex"]`（`docs/agent-team-board/tasks/settings.json`；默认值见 `scripts/lib/task-settings.mjs` 约 26–39 行），按设置本应两个都可选。
- 对照（同模块批量开发无此缺陷）：批量开发子面板把启动条 `renderDevStartBar` 常驻渲染（约 2541 行），`#devMode` 下拉默认空占位「选择执行 Agent…」，未选择时「启动批量开发」禁用（约 2434–2446 行、2462–2468 行）；批量完善的启动入口既非常驻、收尾重启又无选择，行为不一致。
- 次要问题：即使在首次创建面板里，`#refineMode` 也默认选中第一项 zcode（无「请选择」空项，`mode = agents[0] || 'zcode'`，约 3378 行），用户不主动改下拉就会静默按 zcode 创建。
- 相邻但不同单：终止（aborted）后面板连「启动新任务」入口都没有，是 BUG-20260908-014；codex 完善运行记录文案混入 zcode 标识是 BUG-20260908-013。本单聚焦「已结束（非终止）批次的启动新任务入口无 Agent 选择、恒建 zcode 任务」。

## 复现步骤

方式 A（看板界面路径）：

1. 启动看板，确认「设置 → 批量任务」中批量完善的 zcode、codex 均勾选展示；
2. 「任务 → 批量完善」：首次进入时创建面板有「执行 Agent」下拉，保持默认（或任选）点击「启动批量完善」，得到一个完善任务；
3. 等该任务收尾（全部条目 done/fail/skipped，面板出现「本批完善范围已处理完毕」与「启动新任务」按钮）；
4. 此时面板自上而下没有任何 zcode / codex 选择控件；点击「启动新任务」；
5. toast 与新批次面板显示执行 Agent 为 zcode，「主调度提示词」内容为 zcode 版（含「执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词」「子代理会话命名统一为：<批次号>-refine-<序号>」）；重复步骤 3–4，每次都是 zcode，全程无法选 codex。

方式 B（代码路径核对，无需看板）：

1. 读 `/api/refine/current`（`scripts/server.mjs` 约 1460–1477 行）：项目里已有完善批次时永远返回非空 `batch`（`queueHeadRefineBatch` 回退最新批次，`scripts/lib/refine-store.mjs` 约 259–262 行）→ `renderRefinePanel` 永远走运行态分支，`#refineMode` 不存在；
2. 「启动新任务」→ `createRefineBatchAndCopy`（`scripts/web/app.js` 约 3468–3476 行）：`$('#refineMode')?.value` 为 undefined，回退 `state.refine.mode`（初始 `'zcode'`，约 141 行）→ `POST /api/refine/create` 携带 `mode: "zcode"`；
3. `getRefineBatch` 查看新建批次：`mode`/`agent` 均为 `zcode`，`prompt` 为 `buildRefinePrompt` 的 zcode 分支（`scripts/lib/refine-store.mjs` 约 310–318 行）。

## 期望行为

- 批量完善从任何「启动/重启」入口（含已结束批次的「启动新任务」）创建新任务前，都必须能选择执行 Agent（zcode / codex），选项按设置「批量任务」的 refine Agent 展示过滤（隐藏的不出现；全隐藏时禁用启动并提示，沿用现有文案口径），与 REQ-20260908-020「双 Agent 差异化、隐藏的 Agent 不出现在任务启动选项」一致。
- 未明确选择 Agent 时不得静默按 zcode 创建：建议对齐批量开发的交互——下拉默认空占位「选择执行 Agent…」，未选择时启动按钮禁用并提示；修复方案（常驻启动条或在收尾面板内嵌 Agent 选择）由开发阶段在 design.md 定案，验收只约束行为。
- 用户选择 codex 后：`POST /api/refine/create` 以 `mode: "codex"` 创建，批次 `mode`/`agent` 为 codex，主调度提示词为 codex 差异化版（含 codex CLI/子会话命名口径）；选择 zcode 同理。二者互不混用。
- 选择应在本轮启动内生效且可见：创建后面板状态条显示的「执行 Agent」与用户选择一致；刷新/轮询后不回落到默认值。

## 验收说明

- 界面：项目已有完善批次（含已结束非终止批次）时，「任务 → 批量完善」的启动/「启动新任务」入口均出现执行 Agent 选择；不选 Agent 时无法启动（按钮禁用或有明确提示，不产生请求）；设置中隐藏 codex 后选项只剩 zcode，全隐藏时给出「到设置恢复展示」提示且启动禁用。
- 账本：分别以 zcode / codex 启动新任务后，`refine/batches/<batchId>/batch.json` 的 `mode`、`agent` 与选择一致；`prompt` 相应为 zcode/codex 差异化提示词（codex 版含「执行 Agent：codex」，zcode 版含「执行 Agent：zcode」），不出现「选了 codex 却下发 zcode 提示词」。
- 幂等/队列不回退：同模式队尾候选一致仍幂等返回已有批次；跨模式排队、暂停/终止、实时吸收新接受单等既有行为不变（回归 `scripts/tests/refine-store.test.mjs`、`scripts/tests/refine-ui.test.mjs`、`scripts/tests/tasks-refine.test.mjs` 现有用例全部通过）。
- 对照回归：批量开发面板的启动交互不受影响（`renderDevStartBar` / `bindDevStart` 行为不变）。
- 报告人原始触发路径（首次创建面板还是收尾「启动新任务」）待确认；不影响上述代码层根因与修复验收。
