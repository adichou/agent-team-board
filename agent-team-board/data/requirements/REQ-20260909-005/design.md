# 设计 — REQ-20260909-005 批量任务中的智能体模型和智能或推理程度要保持和主调度会话一致

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260908-020 落地了「任务类型 × 执行 Agent」四路子代理 model/level 设置，创建任务时由
`server.mjs`（`/api/batch/create`、`/api/refine/create`）读取并把固定配置行冻结进主调度提示词
（`batch.generatePrompt` / `refine-store.buildRefinePrompt`）。该静态值与主调度会话实际使用的
模型 / 推理档位无关，导致批次内执行智能随设置而非会话漂移。REQ-20260909-001 已把设置界面
精简为仅隐藏开关（底层 models 存储保留），本需求在其上重新引入「模型来源」维度：
默认跟随主调度会话，手动指定为显式覆盖（五列表格）。

## 待确认项结论（README「待确认」）

1. **zcode / codex 子代理启动参数能否显式指定模型与档位**（项目内核实，不臆断）：
   - codex：**支持**。依据 `scripts/lib/codex-adapter.mjs` 的 `buildExecArgs`
     （REQ-20260906-024）：`codex exec --model <id>` 与 `-c model_reasoning_effort="<档>"`
     为有类型字段，配套校验见 `codex-model-config.mjs`。
   - zcode：**项目内查不到依据**。现有实现只是把「子代理模型配置」写进主调度提示词文本，
     属指令约定而非启动参数；Zcode 主会话派发 general-purpose 子 Agent 时能否显式传
     模型 / 档位在本项目内无可核实信息。
   - **降级口径（两条共用一条指令，不按 Agent 分叉措辞）**：跟随档提示词指令写成
     「支持显式指定的执行端（如 codex exec `--model` / `model_reasoning_effort`）显式传入
     与当前会话一致的值；不支持显式指定的执行端不另行指定，依赖子代理默认继承主会话配置」。
     不在提示词里断言 zcode 支持或不支持。
2. **主调度会话能否运行时感知自身模型与档位**：看板不感知、不记录（README 现状依据），
   本需求不新增感知链路。跟随档指令为规范性要求（「必须与当前主调度会话保持一致」），
   不注入具体模型值；启动区只展示来源（跟随 / 手动值），不尝试展示主会话模型名。
3. **任务模块「当前处理详情」是否展示生效模型来源**：展示，范围限定「启动前可见」——
   开发启动区、完善启动区与收尾「启动新一轮」区展示所选 Agent 的生效口径；
   运行面板不展示（提示词已冻结进批次账本，口径可从提示词文本区分）。

## 方案

### 数据层（scripts/lib/task-settings.mjs）

- 每路配置增加 `source: 'follow' | 'manual'`：
  - 新增常量 `TASK_MODEL_SOURCES = ['follow', 'manual']`、`TASK_SOURCE_LABEL`。
  - `defaultSettings()`：四路默认 `{ source: 'follow', model: '', level: refine?'high':'medium' }`
    ——默认跟随主调度会话；level 保留原缺省值仅作手动档缺省建议（README 状态反馈口径）。
- **读取迁移（`loadTaskSettings`）**：存量路无 `source` 字段时按值判定——
  `model` 非空，或 `level` 偏离该类缺省（refine≠high / develop≠medium）→ `manual`（有明确
  手工配置痕迹，值原样保留）；否则 `follow`。存量 `model`/`level` 值一律不清空、不重置，
  切回手动时按保存值回显。判定为启发式：REQ-20260908-020 保存过的「空模型 + 缺省档」与
  从未保存在存储上不可区分（REQ-20260909-001 起 agents-only 保存同样会写入缺省形态 models），
  只能以「偏离缺省即手动」近似，无偏离证据的一律落到新默认「跟随」。
- **保存（`saveTaskSettings`）**：`patch.models[kind][agent]` 接受可选 `source`，非
  follow/manual 整体拒绝（沿用非法值整体拒绝口径）；显式 `source='follow'` 时不清空既有
  model/level（保値，供切回手动回显）。兼容既有调用（如 `/api/tasks/settings` 直接写
  model/level 的旧客户端）：patch 未带 `source` 但写入了非空 `model` → 该路 `source`
  置 `manual`（写模型即手动，保持 REQ-20260908-020 API 语义不回退）。

### 提示词口径（scripts/lib/batch.mjs、scripts/lib/refine-store.mjs）

- `generatePrompt` / `buildRefinePrompt` 增加 `modelSource` 入参（`'follow' | 'manual' | null`）：
  - `'follow'`：注入跟随指令行（替换固定配置行）——
    「子代理模型与智能/推理档位：跟随主调度会话——启动每个子代理时，其模型与智能/推理档位
    必须与当前主调度会话保持一致：支持显式指定的执行端（如 codex exec 的
    --model / model_reasoning_effort）显式传入与会话一致的值，不支持的执行端不另行指定、
    依赖子代理默认继承主会话配置；不得改用设置「批量任务」的静态值，也不得落到与主会话
    不同的默认档。」
  - `'manual'`（或未传 source 但有 model/level，兼容旧调用）：沿用现状固定行逐字不变
    （REQ-20260908-020 行为不回退）。
  - `null` 且无 model/level：不注入任何行（直连库调用的既有行为不变）。
  - 跟随 / 手动两口径在提示词文本中可明确区分（「跟随主调度会话」vs「来自设置『批量任务』」）。
- 提示词仍在创建时冻结进批次账本；进行中任务不受后续保存影响（现状机制，无改动）。

### 服务端与 CLI 统一（scripts/server.mjs、scripts/atb.mjs）

- `/api/batch/create`、`/api/refine/create`：读取该路 `{ source, model, level }`，
  `source==='follow'` 时只传 `modelSource`（model/level 不注入）；手动时传 `modelSource`
  与 model/level。
- `atb batch create`（agent 缺省 zcode）与 `atb refine create`（--mode）：同样读取
  `tasks/settings.json` 对应路并传 `modelSource/model/level`——CLI 与看板两条创建路径
  口径统一，不再出现一边注入一边不注入的分叉。

### 前端（scripts/web/app.js）

- **设置「批量任务」区（`taskSettingsHtml`）**：两类任务各一张五列表格——
  执行 Agent / 模型来源 / 子代理模型 / 推理强度 / 是否隐藏，固定 Codex、Zcode 两行：
  - 模型来源下拉 `tsSource-<kind>-<agent>`（跟随主调度会话=默认 / 手动指定）；
  - 来源=跟随：该行 `tsModel-*` 输入与 `tsLevel-*` 下拉 `disabled` 置灰，
    placeholder/title「跟随主调度会话，无需配置」；来源=手动：恢复可编辑
    （模型可留空沿用默认，强度高 / 中 / 低）；
  - 切换来源即时改草稿控件可用性，未保存不生效；迁移回显按 loadTaskSettings 结果；
  - 说明文字增补默认跟随与手动=显式覆盖语义；沿用 `.ts-table-wrap` 横向滚动容器。
- **保存**：`bindSettingsView` 提交 `{ agents, models }` 全量四路 `{source, model, level}`；
  防重复提交、成功 / 失败 toast、失败保留草稿、加载骨架与失败重试全部沿用
  REQ-20260909-001 机制。
- **启动区口径展示**：新增 `modelSourceLine(kind, agent)` 助手——跟随显示
  「子代理模型：跟随主调度会话（与主调度会话的模型 / 智能推理档位一致）」，手动显示
  「子代理模型：手动 <模型或（默认）> · 智能档位 <档>（显式覆盖，与主调度会话不一致）」。
  接入四处：开发启动区（`renderDevStartBar`，`#devModelSource`，选择变化即时更新）、
  完善启动区（`renderRefinePanel` 创建面板）、开发与完善的收尾「启动新一轮」区
  （`#devNextMode` / `#refineNextMode` 旁，随既有 change 重渲染联动）。

## 风险与边界

- **与 REQ-20260909-001 的界面关系**：001 删除了模型 / 强度控件（两列表格），本需求按更新后
  的用户意图重新引入为「来源 + 手动覆盖」五列；001 保留的加载 / 失败 / 重试 / 草稿 / 全部隐藏
  提示机制与 aria-label 契约不变，`task-settings-simplify-20260909-001.test.mjs`、
  `refine-ui.test.mjs` 中「不得出现模型 / 强度控件」的断言按本需求口径更新。
- **迁移启发式**：存量「空模型 + 缺省档」不可区分是否保存过，统一落「跟随」；若个别用户
  曾显式保存缺省档 intending 手动，需在设置里重新选一次手动（值仍在，一键切回）。
- **跟随档的可执行性**：看板无法核验子代理实际模型，一致性由主调度会话按提示词指令保证；
  看板侧不做运行时校验（不新增感知链路，见待确认 2）。
- **不改范围**：Agent 展示 / 隐藏、候选口径、批次执行与回执协议、进行中任务的冻结提示词
  均不动；`generatePrompt` 未传模型信息的直连调用输出逐字不变（batch-core D2 不回归）。

## 实施记录

- 2026-09-09 zcode-batch-20260909-019-1：按上述方案实施。改动：
  - `scripts/lib/task-settings.mjs`：`TASK_MODEL_SOURCES` / `TASK_SOURCE_LABEL` / `defaultLevelOf` /
    `FOLLOW_SESSION_PROMPT_LINE`（跟随指令行，两处提示词共用）/ `modelConfigOf`（规范化读取）；
    默认与迁移（model 非空或档位偏离该类缺省 → manual，缺省形态 → follow，值一律保留）；
    保存校验 source、显式 follow 保値、无 source 写非空 model → manual（旧 API 语义兼容）。
  - `scripts/lib/batch.mjs` / `scripts/lib/refine-store.mjs`：`generatePrompt` / `buildRefinePrompt` /
    `createBatch` / `createRefineBatch` 增加 `modelSource`——follow 注入跟随指令（忽略误传的
    model/level），manual 或仅传 model/level 沿用现状固定行，均未传不注入（直连调用不变）。
  - `scripts/server.mjs`：`/api/batch/create`、`/api/refine/create` 改经 `modelConfigOf` 按来源传递。
  - `scripts/atb.mjs`：`batch create` / `refine create` 读任务设置传 `modelSource/model/level`，
    CLI 与看板口径统一。
  - `scripts/web/app.js`：`taskSettingsHtml` 五列表格（模型来源 / 子代理模型 / 推理强度 +
    隐藏开关），跟随机禁用置灰 + 占位「跟随主调度会话，无需配置」；`bindSettingsView` 来源切换
    即时启停控件、保存提交 agents + models 四路全量；`modelSourceText` 在开发启动区、完善启动区、
    两处「启动新一轮」区展示所选 Agent 生效口径（选择变化即时更新）。
  - 测试：新增 `scripts/tests/model-follow-session-20260909-005.test.mjs`（14 用例：数据层 3 /
    提示词 3 / CLI 1 / 服务端 1 / 界面 6）；按本需求口径更新被取代契约
    `task-settings-simplify-20260909-001.test.mjs`（T1/T2/T5/T8/T9 五列表格与保存载荷）、
    `tasks-panel-26.test.mjs` K10、`refine-ui.test.mjs` R12-7 及四处隔离 vm 桩补
    `modelSourceText` 依赖；全量 111 个测试文件通过。
