# 设计 — REQ-20260909-010 支持需求完善后自动转入计划，提供配置，默认是手动

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

批量完善（refine）面向已接受（accepted）条目补文档，全程保持 accepted；done 回执核验通过后只把完善账本置「已完善」（refined）。而批量开发候选口径是「已计划（planned）且未认领」，每条完善完成的单都需人工再点一次「移入计划」，形成重复人工步骤。本设计给出「完善完成后自动转入计划」配置（默认关闭）与回执侧自动流转的实现口径。

## 方案

### 1. 配置存储（scripts/lib/task-settings.mjs）

- `tasks/settings.json` 顶层新增 `refine` 分区：`{ version: 1, agents, models, refine: { autoPlanAfterDone: false } }`。
  - 字段挂在 `refine` 分区下（而非 models/agents 平级散落），后续完善类流转配置可就地扩展。
- `defaultSettings()` 补 `refine: { autoPlanAfterDone: false }`；`loadTaskSettings` 对存量缺字段按 false 回退（宽松读：仅严格 `=== true` 视为开启）；`saveTaskSettings` patch 支持 `refine: { autoPlanAfterDone }`，非 boolean 值整体拒绝（沿「不产生半截配置」口径，agents/models 局部合并不受影响）。
- 新增读取助手 `autoPlanAfterRefineDone(settings)` → boolean，供双路径统一取值。
- **不提供 CLI 设置入口**：沿现状任务设置仅看板设置页可改（`atb refine done` 只读该配置）。

### 2. 自动流转核心（scripts/lib/refine-store.mjs）

新增导出函数 `autoPlanRefinedItem(dataDir, itemId, runId)`——不抛错，返回结果对象：

| 结果 | reason | 含义 |
| ---- | ------ | ---- |
| `{ transitioned: true }` | — | 流转成功（accepted → planned） |
| `{ transitioned: false, reason: 'not-enabled' }` | 未开启配置（默认） |
| `{ transitioned: false, reason: 'not-accepted:<status>' }` | 条目非 accepted（如人工已移入计划） |
| `{ transitioned: false, reason: 'settings-read-failed' / 'status-read-failed' }` | 前置读取失败（不阻断回执） |
| `{ transitioned: false, reason: 'transition-failed', error }` | setStatus 流转异常（不阻断回执） |

- 内部读设置（未开启直接返回）→ 读条目状态（仅 accepted 才流转）→ 调用 `core.setStatus(dataDir, id, 'planned', { by: 'system', note: '完善后自动转入计划（<runId>）' })`，异常捕获后返回 `transition-failed`。
- **history 标注格式**：`by: 'system'`，note 为 `完善后自动转入计划（<runId>）`——自动化来源（runId 关联 + 备注文案）一次到位；`setStatus` 的 `accepted → planned` 合法边与默认 note 逻辑复用，不新增状态机边。

### 3. 触发点一：zcode 路径（finishRefineRun）

- `finishRefineRun` done 分支在 run 落 done 终态、`setRefineItemState(…, 'refined')` **之后**调用 `autoPlanRefinedItem`（完善账本先记账，流转失败不丢完成事实），结果并入回执：`receipt.autoPlan = { transitioned, to?: 'planned', reason?, error? }`（短字段，不影响 ≤2KiB 协议）。
- `refine fail` / `refine release` / abort / skipped 不触发（实现上仅 done 分支调用，结构性满足）。

### 4. 触发点二：codex 路径（server.mjs 完善执行器 settle）

- settle 的 done 核验分支与 `finishRefineRun` 同口径接入：核验通过 → `finish('done', { summary, autoPlan })`，`autoPlan` 结果随 `updateRefineRun` 落 run.json，供任务面板记录展示。
- **存量核验差异对齐（行为变更，随本需求修正）**：`precheck` 与 `settle` 仍按 REQ-20260908-020 之前的旧口径 `st.status === 'submitted'` 核验——面向已接受单改造后从未对齐，codex 完善路径在现状下必然 precheck 出局 / settle 核验失败（自动流转形同虚设）。随本需求一并改为 `accepted`（precheck 出局文案同步改为「状态已变化」通用口径，settle 失败文案「条目已离开待接受」→「条目已离开已接受」）。

### 5. done 核验放宽：人工提前移入计划（planned）时 done 成功不流转

- 现状 `finishRefineRun` 要求条目仍 accepted 才能记 done；本需求验收标准要求「回执时条目已非 accepted（如人工已移入计划）→ 不重复流转、不报错，回执成功并输出原因」。
- 口径：done 核验允许 **accepted | planned**：
  - accepted：现状行为 + 自动流转（若开启）；
  - planned：人工已提前移入计划——done 成功记账 refined、跳过流转，`receipt.autoPlan.reason = 'not-accepted:planned'`，不产生第二条流转 history；
  - 其他状态（submitted / in-progress / done）：维持现状报错（完善结果需人工核对，改用 refine fail）——验收标准仅点名「人工已移入计划」场景，最小化行为变更。
- **既有用例调整**：`refine-store.test.mjs` R6/R7「planned 后 done 拒绝」断言按本需求口径更新（planned → done 成功；拒绝分支改以其他状态覆盖）。

### 6. CLI 输出（atb.mjs refine done）

非 `--json` 输出在回执 JSON 行之前增加流转结果行：

- 成功：`已自动转入计划：<ID>（accepted → planned，进入批量开发候选）`；
- 未开启：`未开启自动转入计划：需人工移入计划（设置 → 批量任务）`；
- 条目非 accepted（如 planned）：`未自动转入计划（条目当前为 planned）：无需自动转入`；
- 读取/流转失败：`自动转入计划失败（<原因>）：请人工移入计划`（警示）。

`--json` 回执原样含 `autoPlan` 字段。

### 7. 设置页（scripts/web/app.js）

- `taskSettingsHtml` 在「批量完善」表格块之后、「批量开发」之前新增独立开关块：`<input type="checkbox" id="tsAutoPlan">完善完成后自动转入计划`，随保存值回显勾选（默认不勾选）；块内附说明文字（开启语义 + 默认关闭 + 仅对后续回执生效）。
- `bindSettingsView`：开关 `change` 走既有 `tsDirty`（「有未保存的更改」）；保存时 `refine.autoPlanAfterDone` 并入 POST body（`{ agents, models, refine }`）；保存成功 toast 调整为「已保存批量任务设置（流转开关仅对后续完善回执生效）」，失败就近报错、草稿保留（沿现状）。
- server `/api/tasks/settings` POST 透传 `refine: body.refine ?? undefined`（省略即保留既有值，与 agents/models 同口径）。

### 8. 面板记录标注（scripts/web/app.js runAttemptsHtml）

- `listRefineRuns` records 透传 `autoPlan`（run.json 字段）；`runAttemptsHtml`（批量完善/批量开发共用）在 done 记录的执行状态列 summary 下方追加 muted 小字：`transitioned` → 「已自动转入计划（planned）」；`transitioned: false` 且 reason 非 not-enabled → 「未自动转入计划：<原因>」。develop 记录无该字段不受影响。

## 风险与边界

- **人工专属状态铁律不放宽**：`HUMAN_ONLY_TO` 与 `state-guard` 拦截的是 Agent 命令面（`atb status <ID> planned`）与 status.json 直写；自动流转发生在回执处理逻辑内部（`finishRefineRun` / settle 调 `setStatus`），不经 CLI status 命令、不经 Agent 写文件。用户开启配置 = 授权系统在回执处理内代执行这一步，与看板人工按钮（server 内部同样调 `setStatus`）的实现层级一致；Agent 纪律与拦截规则零改动（新增源码断言用例守护）。
- **生效时机**：保存后仅对后续 done 回执生效——实现上每次回执实时读设置，无追溯/补流转路径，结构性满足。
- **流转失败不丢单**：done 终态与 refined 账本先落，流转后置且全捕获异常；回执始终成功，CLI/面板给警示。
- **人工操作不回退**：自动置计划走同一条 `accepted → planned` 边，history 仅 note/by 不同；「移出计划」、撤销、认领、批量开发吸收等行为与人工置计划无差别（planned → accepted 钩子会照常重置未完善并允许重新入队，沿 BUG-20260908-010 既有口径）。
- **Bug 条目同口径**：完善候选与 done 回执均不区分条目类型，自动流转对需求与 Bug 一并生效（README「待确认 1」结论：同口径，不默认臆断排除）。
- **server 侧 submitted → accepted 对齐**属行为变更（见方案 4）：修正的是 REQ-20260908-020 改造遗留的口径脱节，不修正则 codex 完善路径完全不可用；对齐后 precheck/settle 与 `finishRefineRun` 三处同口径。
- 回执 `autoPlan` 字段为短枚举 + 可选 error（截断 120 字符），不会突破 ≤2KiB 协议上限（实测含 autoPlan 的回执远小于上限）。

## 待确认（README「待确认」项的结论）

1. **Bug 条目**：同口径一并生效（见风险与边界）。
2. **存储结构**：`tasks/settings.json` 顶层 `refine: { autoPlanAfterDone }`；不提供 CLI 设置入口（沿现状仅设置页可改）。
3. **codex settle 核验差异**：随本需求对齐为 accepted（precheck + settle 两处，见方案 4）。
4. **兜底展示**：CLI 输出行 + 回执 JSON `autoPlan` 字段 + 任务面板执行记录标注（见方案 6/8）；history 标注 `by: 'system'` + note 含 runId（见方案 2）。
