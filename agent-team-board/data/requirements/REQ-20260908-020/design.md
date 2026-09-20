# 设计 — REQ-20260908-020 重构批量流程和任务管理。

> 由 Agent 在 /dev 开发前补充，人可随时批注。
> 本稿为需求完善阶段（RFB-20260908-007）给出的方案建议，开发阶段须复核细化后再实施。

## 背景

项目已有两套批量执行账本与调度：

- **批量开发（dispatch 账本）**：`scripts/lib/batch.mjs`（REQ-20260906-002 共用批次/执行账本核心层；REQ-20260908-010 选单口径从 accepted 切换为 planned、领取时实时吸收新置计划条目；REQ-20260908-019 已移除批次上限）；codex 后台路径为 `scripts/lib/scheduler.mjs`（REQ-20260906-003，每项后台 `codex exec`）。事实源 `docs/agent-team-board/dispatch/`。
- **批量完善（refine 账本）**：`scripts/lib/refine-store.mjs`（REQ-20260907-003），候选为「submitted 且文档不全」，创建批次时冻结候选快照（缺失原因 + 文档指纹基线）；zcode 模式 = 主调度会话派子代理（`refine next/done/fail/release/check`），codex 模式 = 看板服务内建 runner 逐项 `codex exec`（`scripts/server.mjs` 的 refineRunners）。事实源 `docs/agent-team-board/refine/`。
- **任务模块 UI**：`scripts/web/app.js` 的 `renderRuns`（REQ-20260907-004 五模块视图），子面板为「Zcode 批次 / Codex 自动派发 / 需求完善」；完善面板 `renderRefinePanel`（约 3265 行起）；设置模块 `renderSettingsView`（约 3851 行起，目前仅 Codex 派发配置）。
- **条目状态机**：`scripts/lib/core.mjs` `STATES = ['submitted','accepted','planned','pending-alignment','in-progress','done']`；人工可驳回 `accepted → submitted`（REQ-20260907-011）、移出计划 `planned → accepted`（REQ-20260908-010）；`accepted/planned/done` 仅限人工执行，Agent 侧由 `scripts/hooks/state-guard.mjs` 拦截。

本需求要解决的问题：两类批量任务概念与入口不统一、完善面向的是待接受单而需求要求面向已接受单且实时读取、没有单级完善三态标记、没有终止能力、子代理模式未按 Agent 差异化、模型配置没有按「完善/开发 × Agent」分设。

## 方案

（技术选型、接口设计、影响面；以下为完善阶段建议）

### 1. 账本与任务模型统一

- 保留 `dispatch/` 与 `refine/` 两套文件账本的原子写与互斥设施，但对外（CLI + API + UI）统一为「任务」抽象：任务类型 `refine | develop`，任务阶段沿用 `prepared/running/paused/finished` 并新增终止语义（如 `aborted`，或在 finished 上记 `abortRequested` 明细，二选一在开发阶段定案）。
- 服务端新增统一读数 API（建议）：`GET /api/tasks/current?kind=refine|develop`、`POST /api/tasks/{kind}/pause|abort`，内部转发到既有 batch/refine store；前端任务模块只消费统一 API，不再各自拼两套数据。

### 2. 批量完善口径切换（submitted → accepted，实时读取）

- `refineCandidates` 过滤条件从 `status === 'submitted'` 改为 `status === 'accepted'`；完整性启发式（`analyzeItemDocs`，REQ-20260908-015 口径：README 描述 + 验收标准 + 涉及 UI 时的界面展示）保留用于展示缺失原因。
- 去掉「创建时冻结候选集合」对后续轮次的约束：每轮 `refine next` 实时扫描全部已接受单取下一项（与批量开发 `batch next` 实时吸收 planned 的 REQ-20260908-010 口径对齐）；文档指纹基线仍按「领取时」逐项冻结，仅用于 done 核验「文档确有变更」。
- 并发/互斥保护沿用：refine.lock、refine-id.lock、未结束批次幂等判断改按「进行中任务」判断（开发阶段细化队尾去重是否保留）。

### 3. 单级完善三态（未完善 / 完善中 / 已完善）

- 存储位置建议：**集中账本索引**（`refine/` 下新增 item-state 索引文件，如 `refine/states.json`：itemId → `{ state, updatedAt, runId }`），不写入条目 `status.json`（状态机字段受 `hooks/state-guard.mjs` 保护，且完善状态属执行账本，不应混入业务状态）。
- 置位钩子：
  - `accepted` 进入时置 `unrefined`：挂在状态流转写入口（`core.mjs` 的 `accepted` 迁移处，含驳回后再次接受的路径）。
  - 领取（`refine next` 预留成功）置 `refining`；`refine done` 核验通过置 `refined`；`refine fail` / `release` 回置 `unrefined`；任务终止时在途项回置 `unrefined`。
  - `accepted → submitted` 驳回时清除/保留记录均可（再次接受必重置为 `unrefined`，以进入钩子为准）。
- 「完善中不可驳回」：驳回入口（看板按钮与 CLI `atb status` 的 `accepted → submitted`）检查 state === refining 时拒绝并提示；CLI 侧在 `core.mjs` 迁移校验中加同样规则，防止绕过 UI。

### 4. 仅子代理模式 + 双 Agent 差异化提示词

- 下线/隐藏 codex 后台路径：任务模块移除「Codex 自动派发」子面板入口；`scripts/lib/scheduler.mjs`、`server.mjs` 的 codex refine runner 与 `/api/batch/pause` 等后台路由本期保留代码但不再暴露 UI（是否物理删除由开发阶段定，建议保留便于回退）。
- 子代理模式双 Agent：
  - zcode：沿用现有「主调度提示词复制到 Zcode 新会话 → 每项一个 general-purpose 子代理 → `atb refine/batch next|done|fail` 文件化回执」。
  - codex：提示词差异化——主调度提示词与子代理提示词按 codex 的 CLI 约定与会话命名规则改写（参考 `buildRefineWorkerPrompt` 已有的 codex 单项提示词形态与 REQ-20260906-003 的会话命名口径）。
  - 提示词模板建议从代码内字符串抽到 `skills/agent-team-board/` 下按 `{kind}-{agent}` 维护的模板文件（如 `prompt/refine-zcode.md` 等），便于差异化与评审；至少在 store 内按 agent 分函数。
- Agent 展示配置：设置存储新增 `tasks.refine.agents` / `tasks.develop.agents`（如 `["zcode","codex"]`）；任务启动区、执行记录筛选按该列表渲染。

### 5. 终止能力

- 新增 `atb refine abort` / `atb batch abort`（或统一 `atb tasks abort <kind>`）与对应 API：置 `abortRequested`，立即停止派发下一项；账本剩余未领取项标记 `skipped`（出局）；在途项标记 `interrupted` 并释放执行锁（沿用现有 `interrupted` 语义与锁释放路径）。
- 在途子代理无法被看板直接停止（zcode 子代理运行在主调度会话内）：终止回执/提示中明确「请在对应子代理会话停止」；codex 后台 runner 本期已下线，不涉及进程回收。

### 6. 模型与智能水平分设

- 设置存储建议扩展现有项目设置（`dispatch/settings.json` 同级或新增 `tasks/settings.json`）：`tasks.refine.models.{zcode,codex}`、`tasks.develop.models.{zcode,codex}`，每路含模型标识 + 智能档位。
- codex 侧解析沿用 `scripts/lib/codex-model-config.mjs`（模型目录、推理强度 effort、快照落盘）；批量完善/开发各自维护选择状态与快照，不复用「项目默认 + 单项覆盖」层级（单项覆盖是否保留待开发阶段定）。
- 默认值：refine → 高智能档；develop → 一般智能档。仅默认建议，设置可改。
- 提示词中注入所选模型/档位说明，主调度启动子代理时按配置传递。

### 7. UI 重构（任务模块 + 徽标 + 设置）

- `scripts/web/app.js`：`renderRuns` 子面板改为「批量完善 / 批量开发」；`renderRefinePanel` / 开发面板合并出统一的「启动区 + 当前处理详情 + 操作 + 执行记录」结构（界面布局见 README 界面展示节）。
- 已接受卡片/详情新增完善徽标组件（三态样式 + 轮询刷新，沿用现有 state sig 重渲染机制）；「驳回回待接受」按钮按徽标状态禁用。
- 设置模块新增「批量任务」分区（Agent 展示开关 + 四路模型/智能档），保存走新 API。

### 8. 影响面清单（真实文件）

- `scripts/lib/refine-store.mjs`（候选口径、实时领取、abort、states 索引、双 Agent 提示词）
- `scripts/lib/batch.mjs`（abort、任务抽象对齐、提示词差异化）
- `scripts/lib/core.mjs`（accepted 进入钩子置未完善；驳回校验「完善中禁驳」）
- `scripts/server.mjs`（统一 tasks API、隐藏 codex 后台路由、设置读写）
- `scripts/web/app.js`（任务模块重构、徽标、设置分区）
- `scripts/atb.mjs`（abort 子命令、任务统一命令面）
- `skills/agent-team-board/SKILL.md` 与 `worker-spec.md`（双 Agent 子代理口径同步）
- 测试：`scripts/tests/`（refine-*、batch-*、accept-ui、state-guard 相关用例回归 + 新增）

### 9. 待确认项（项目内查不到事实，禁止编造，需人工定案）

1. **codex 子代理模式的承载方式**：codex 作为子代理是由 zcode 主调度会话内拉起（zcode 派 codex CLI？），还是 codex 会话自身作主调度再派子代理？两者提示词与回执通道差异较大，需定案。
2. **zcode 侧子代理模型/智能档的指定机制**：zcode 主调度派 general-purpose 子代理时是否支持显式指定模型与智能水平、如何指定，查不到既有实现，需确认（决定设置项能否真正生效）。
3. **与 REQ-20260908-016 的关系**：016 提出在待接受之前增加「待完善」状态（新建单 → 完善后转待接受），与本需求「已接受单的三态完善标记」是两套完善口径；两者是否合一、全流程如何衔接（新建 → ？→ 待接受 → 已接受(未完善→已完善) → 已计划），需产品定案。
4. **与 REQ-20260907-010 的冲突**：010 要求「待接受 → 已接受的前提是文档完整，否则提示用批量完善」，与本期「完善面向已接受单」方向相反；驳回/接受时的提示逻辑如何调整需定案。
5. **codex 后台模式的去留**：本期「不提供」是仅隐藏入口还是删除 scheduler/codex-adapter 代码路径，需定案（建议先隐藏，保留回退能力）。
6. **完善状态的历史留痕**：驳回后再接受重置「未完善」时，是否保留上一轮完善记录供追溯（账本 runs 已可追溯，索引是否冗余记录需评审）。

## 实施记录

- 2026-09-08（完善阶段 RFB-20260908-007 / run-20260908-164447-c1b7）：补全 README（现状差距、目标细化、界面展示、验收标准）与本文档方案建议、测试用例；未改业务代码。开发未开始。
- 2026-09-08（开发阶段 batch-20260908-017 / run-20260908-078）：按上述方案实施，要点与定案口径：
  - 新增 `scripts/lib/refine-states.mjs`（单级完善三态索引，`refine/states.json`，自持原子写避免与 core 循环依赖）与 `scripts/lib/task-settings.mjs`（批量任务设置，`tasks/settings.json`）。
  - `core.mjs`：进入 accepted 一律置「未完善」（含驳回后再接受、移出计划回已接受）；accepted → submitted 驳回前校验完善中拦截（CLI/UI 双侧同口径）。
  - `refine-store.mjs`：候选切换为「已接受且未完善」（完整性启发式仅展示原因）；`nextRefineItem` 每轮实时吸收新接受单（吸收时逐项冻结指纹基线）；领取→完善中、done→已完善、fail/release/终止→未完善；新增 `abortRefineBatch`（剩余项 skipped 出局、在途 interrupted 注明人工终止、锁全部释放、批次 finished+aborted）；`buildRefinePrompt` 按执行 Agent（zcode/codex）差异化并注入设置中的模型/档位；codex 模式同样返回子代理主调度提示词（不再服务端逐项 exec）。
  - `batch.mjs`：`createBatch`/`generatePrompt` 支持执行 Agent 差异化；新增 `abortBatch` 与 skipped 终态记账（batchState/计数/删除保护/listRuns 同步）；`nextItem`/`checkBatch` 识别 abortRequested。
  - `server.mjs`：`/api/tasks/settings` GET/POST、`/api/refine/abort`、`/api/batch/abort`；`/api/refine/create` 子代理化（codex 不再入队后台，注入模型/档位）；`/api/board`、`/api/item/:id` 为已接受单附 `refineState`。
  - `atb.mjs`：`refine abort`、`batch abort` 子命令；usage/输出文案切 accepted 口径。
  - UI（app.js/index.html/style.css）：任务模块子面板收敛「批量完善 / 批量开发」（Codex 自动派发 tab 移除，面板代码与 codex 渲染分支保留给存量记录深链）；两类面板统一 启动区（执行 Agent 按设置过滤）+ 当前处理详情 + 暂停/终止（uiConfirm 二次确认）+ 执行记录；已接受卡片/详情三态徽标（点击跳批量完善面板；完善中驳回按钮禁用）；设置模块新增「批量任务」分区（Agent 展示 × 四路模型/智能档位）；顶栏「模型配置待处理」徽标改跳设置模块（无死链）。
  - `skills/agent-team-board/SKILL.md`：批量任务（两类/双 Agent/终止/三态）口径同步。
  - 测试：新增 `scripts/tests/tasks-refine.test.mjs`（T1-T10：候选口径/实时读取/三态/禁驳/终止×2/双 Agent 提示词/agent 落盘/任务设置）；更新 refine-store/cli/serve/ui、impl-entry-ui、planned-state、next-batch-entry、codex-ui、accepted-batch-entry 至新口径；`test-cases.md` 结果列回填。
  - 待确认项处理：#1/#2（codex 承载方式与 zcode 模型指定机制）按「提示词差异化 + 设置落盘注入」实现，实际传递机制待对应 Agent 支持后接通；#5 codex 后台路径仅隐藏未删除（保留回退）；#3/#4/#6 属产品口径，未在本期强改。

## 风险与边界

- 完善三态若误写入 `status.json` 会触碰状态机铁律（HUMAN_ONLY / state-guard 拦截），必须走执行账本索引。
- 候选从「冻结快照」改「实时读取」后，需重新评估并发创建/幂等判断（队尾一致判断、未结束批次互斥）在动态候选下的正确性，防止重复完善与死锁。
- 驳回「完善中禁驳」必须在 CLI 与 UI 双侧生效，仅挡 UI 会被 `atb status` 绕过。
- 终止语义要与既有 `interrupted`（服务重启释放）区分来源，账本记录需可辨识「人工终止」。
- codex 后台下线涉及既有 `/api/dispatch/*` 路由与顶栏待处理入口，隐藏不彻底会出现死入口（如「模型配置待处理」跳转）。
