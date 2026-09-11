# 设计 — REQ-20260909-011 优化批量完善和批量开发的提示词，不再区分 Agent，使用通用的描述词。设置中去掉 Agent 的配置

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

批量完善 / 批量开发自 REQ-20260908-020 起按执行 Agent（zcode / codex）维护两套主调度提示词，
设置「批量任务」区围绕 Agent 维度组织（隐藏开关 + 四路模型配置）。两类任务实际均为同一子代理模式
（主调度会话逐项派子代理 + 文件化短回执），按 Agent 分叉的提示词与配置维护成本高于差异收益。

## 方案

### 一、待确认项结论

1. **模型手动覆盖能力：彻底移除**。设置不再提供任何手动模型/档位入口；两类任务新建时的模型指令
   固定为「子代理模型与智能/推理档位跟随主调度会话」（REQ-20260909-005 follow 语义）。底层
   `generatePrompt` / `buildRefinePrompt` 的 `modelSource / model / level` 参数与行为保留
   （直连调用兼容：manual / 仅传 model 仍输出固定行、均不传不注入），但所有创建入口
   （server `/api/batch/create`、`/api/refine/create`；CLI `atb batch create`、`atb refine create`）
   固定传 `modelSource: 'follow'`，不再读取设置中的 models。
2. **存储与 API 兼容口径：保留忽略（不删字段、不迁移清理）**。
   - `task-settings.mjs` 的存储结构、缺省合并与保存校验全部保留；存量 `tasks/settings.json`
     （含手动模型值、隐藏状态）照常可读写，不报错；但创建路径与 UI 不再消费 agents/models。
   - `/api/tasks/settings` GET 原样返回完整 settings；POST 仍接受 agents / models 键但**忽略不落**
     （兼容旧客户端不报错），仅 `refine.autoPlanAfterDone` 生效。
   - `/api/batch/create` 的 `body.agent`、`/api/refine/create` 的 `body.mode`、CLI
     `refine create --mode` 均保留入参但忽略（缺省化为通用子代理模式，不报错）。
   - 存量已保存的手动模型值原样保留在存储中，仅对新建任务不再生效。
3. **批次/运行账本 agent / mode 字段：新批次固定记子代理模式标识 `subagent`**。
   - develop：`batch.mode` 维持 `'zcode'`（队列盘点过滤语义不变），`batch.agent` 记 `'subagent'`。
   - refine：`REFINE_MODES` 扩展 `'subagent'`，新批次 `mode` / `agent` 均记 `'subagent'`；
     直连显式传 `zcode / codex` 仍合法（存量语义兼容，服务端隐藏 codex 后台路径不依赖新缺省）。
   - refine 幂等判断从「同 mode」改为「最新未结束完善批次即幂等」（通用化后仅一条完善线，
     存量在途批次同样幂等返回，避免并行批次）；候选冻结排除口径本就跨全部未结束批次，不变。
   - 运行概况行：`batch.agent` 为 `zcode / codex`（存量）→ 保持「执行 Agent xxx（子代理模式）」；
     否则（新批次）→ 仅展示「子代理模式」。存量展示不回溯改写。
4. **隐藏的服务端 codex 后台路径（scheduler.mjs `codex exec` 逐项路径、`buildRefineWorkerPrompt`
   等）：本期不动**（代码保留备回退，其中 Agent 专属文案不在本单范围）。

### 二、提示词通用化

- `FOLLOW_SESSION_PROMPT_LINE`（task-settings.mjs）措辞通用化：删除「如 codex exec 的
  --model / model_reasoning_effort」举例与「设置『批量任务』的静态值」指向，改为与执行端无关的
  「支持显式指定的执行端显式传入与会话一致的值；不支持的不另行指定、依赖子代理默认继承主会话配置」。
- `buildRefinePrompt`（refine-store.mjs）：删除 zcode / codex 两分支，合并为单一通用版——
  「在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理…子代理会话命名统一为
  <条目编号>（与主调度会话区分）」；领取前缀固定 `refine-<批次尾号>-<序号>`（不再
  zcode-refine / codex-refine 二选一；前缀仅为会话标识字符串，不影响锁与账本语义）；
  调度要素完整保留（项目路径、批次标识、开发人员会话命名、CLI 约定、领取/回执/核对流程、
  硬性约束、nextAction 处置、「跟随主调度会话」模型指令）。`agent` 参数保留但忽略。
- `generatePrompt`（batch.mjs）：删除 agent 分叉段落；改为「每轮新启动一个子代理，按执行规范
  自行选择本批一个可实施条目…」（去掉 general-purpose 字样）；批次摘要入口、nextAction、
  nextBatch 排队接续等调度要素保留。`agent` 参数保留但忽略。
- 通用化后两类提示词（含 CLI 输出、面板展示的复制指引文案）不再出现
  zcode / Zcode / codex / Codex / general-purpose 等执行端字样。

### 三、设置区精简（web/app.js）

- `taskSettingsHtml` 重写为：分区标题「批量任务」+ 一句通用说明（两类任务均为子代理模式、
  提示词通用、子代理模型跟随主调度会话）+「完善完成后自动转入计划」开关（REQ-20260909-010
  行为不变）+ 保存按钮与就近状态。删除两张 Agent 表格、全部隐藏提示（`updateTsEmptyHints`）、
  `tsModelCfg` / `TS_LEVEL_LABEL` / `modelSourceText` / `visibleTaskAgents`。
- `bindSettingsView`：保存仅提交 `{ refine: { autoPlanAfterDone } }`；草稿反馈 / 防重复提交 /
  失败保留草稿机制不变。加载中骨架与失败重试文案不变。

### 四、启动流程去 Agent 化（web/app.js）

- 开发启动区（`renderDevStartBar`）与终态「启动新一轮」（`#devNextMode` → 删除）：去掉
  「执行 Agent」标签与下拉、空占位校验、全部隐藏禁用提示、生效模型口径行；点击「启动 /
  启动新一轮」直接创建任务并复制通用提示词。无已计划候选时启动禁用并说明原因（新增，与完善侧对齐）。
- 完善启动区（`#refineMode`）与终态（`#refineNextMode` → 删除）：同样去 Agent 化；
  「无候选禁用并说明原因」既有逻辑保留。
- `createBatchAndCopy` / `createRefineBatchAndCopy`：请求体不再携带 agent / mode；
  `state.batch.devAgent` / `state.refine.mode` 草稿删除。

### 五、入口改动（server.mjs / atb.mjs）

- `/api/batch/create`：删除 agent 解析与 `modelConfigOf`；`createBatch` 不传 agent（缺省
  subagent）、`modelSource: 'follow'`。响应保留 `agent` 字段（新批次为 `subagent`）。
- `/api/refine/create`：删除 mode 校验与 `modelConfigOf`；`createRefineBatch` 不传 mode / agent
  （缺省 subagent）、`modelSource: 'follow'`。响应保留 `mode / agent` 字段。
- `/api/tasks/settings` POST：只透传 `refine`，agents / models 忽略。
- `atb batch create` / `atb refine create`：固定 `modelSource: 'follow'`；`--mode` 保留选项但
  忽略；输出行「执行 Agent xxx」改为通用「子代理模式」口径；提示词复制指引文案通用化。

## 风险与边界

- 仅影响新建任务；提示词创建时冻结进批次账本，进行中与历史批次保持原样、不回溯改写。
- 存量 `tasks/settings.json` / API / CLI 参数全部「保留忽略」，不删字段、不做迁移清理，
  读不到 agents / models 不报错、不阻断启动。
- 服务端隐藏 codex 后台路径（scheduler / buildRefineWorkerPrompt / newCodexRefineRun）不动。
- 不改候选口径、执行流程、回执协议、暂停/终止、完善三态与流转规则（既有口径）。
