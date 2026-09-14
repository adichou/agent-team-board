# 设计 — REQ-20260908-010 批量实施应改名为批量开发，方案应优化为提供一个已计划的状态分类，按照已计划的单自动串行处理。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现「批量实施」由三条路径构成：Zcode 批次（REQ-20260906-002，冻结候选快照 + 复制提示词人工粘贴）、Codex 自动派发（REQ-20260906-003，开关式串行取单）、手工 `/dev` 认领。选单口径统一为 `status === 'accepted' && !owner`：

- `scripts/lib/batch.mjs`（候选选单 Z01：req 优先 → 创建时间 → 编号；仅 accepted 未认领）
- `scripts/lib/scheduler.mjs`（只从 accepted 选单；预留 → 受控 claim）

状态机（`scripts/lib/core.mjs`）：

```js
STATES = ['submitted', 'accepted', 'pending-alignment', 'in-progress', 'done'];
TRANSITIONS = {
  submitted: ['accepted'],
  accepted: ['in-progress', 'submitted'],
  'pending-alignment': ['in-progress'],
  'in-progress': ['done'],
  done: ['in-progress'],
};
HUMAN_ONLY_TO = new Set(['accepted', 'done']); // hooks/state-guard.mjs PreToolUse 拦截
```

本需求把「入批」从批次账本（REQ-20260907-012 的 batchEntry 便签）升级为条目自身的「已计划」状态，并把 Zcode/Codex 两入口收敛为一个带模式选择的「开发启动」。

## 方案

（技术选型、接口设计、影响面；以下为实施建议，具体命名可在实现时调整）

### 1. 状态机扩展

- `STATES` 增加 `planned`（「已计划」），建议 TRANSITIONS 扩为：
  - `accepted: ['planned', 'in-progress', 'submitted']`（planned = 人工置计划）
  - `planned: ['in-progress', 'accepted']`（in-progress = claim 认领即实施；accepted = 人工批量移出计划）
- `HUMAN_ONLY_TO` 增加 `planned`：置计划与移出计划均为人工操作（Status Board 按钮/批量操作），Agent 只在认领时把 planned → in-progress。`scripts/state-guard.mjs` 的 `HUMAN_STATE_HINT` 与 bash 守卫（拦截 `atb status <ID> accepted|in-progress|done`）同步把 `planned` 纳入人工专属清单。
- `claim()`（`scripts/lib/core.mjs`）扩展：`planned` 与 `accepted` 同等对待（认领即实施，占用项目实施互斥 `assertNoImplConflict`）。
- UI：`scripts/web/app.js` 的 `STATE_LABEL` 增加 `planned: '已计划'`；`LANES` 五档扩为六档（已计划独立档）——**档位划分待确认**（也可在已接受档内子分类，默认独立档）。
- 详情页操作区（`drawerActionsButtonHtml`）：
  - accepted 档新增「改为已计划」按钮（data-act="planned"）；
  - planned 档提供「移出计划（退回已接受）」单个按钮。
- 批量移出计划：对齐批量接受 `acceptItems` 的交互——已计划档勾选 → 选择工具条「移出计划」→ 服务端逐条 `planned → accepted`（复用 `setStatus` 的流转校验与 `pushHistory`），返回成功/失败清单。

### 2. 改名「批量实施」→「批量开发」

面向用户的文案位置：`scripts/web/index.html`（implGo 按钮 title）、`scripts/web/app.js` 中 16 处「批量实施」字样（注释与提示语）、`scripts/server.mjs` / `scripts/atb.mjs` / `scripts/lib/*.mjs` 中面向用户的报错与说明（约 9 处）、`docs/agent-team-board/batch-execution.md` 标题与正文。原则：**面向用户的文案必须改；代码内部标识符（batch、implGo、`/api/batch/*` 路由）可保留不改**，避免无谓的 API 破坏。

### 3. 开发启动按钮与统一模式选择

- 任务模块（`renderBatchDrawer`）在 Zcode/Codex 两子面板之上（或收敛为单一「批量开发」面板）提供「开发启动」按钮 + 模式选择（`select`：zcode / codex）。
- **zcode 模式**：沿用主会话调度模型（复制提示词粘贴）还是由本按钮简化为「生成提示词并引导粘贴」，**待确认**——Zcode 无法由看板服务直接拉起会话（见 batch-execution.md §7 调研结论），「启动」对 zcode 至多是「就绪 + 提示词就位」，复制成功 ≠ 启动成功的现有区分必须保留。
- **codex 模式**：即现有 Codex 自动派发的开启（`/api/dispatch/codex/toggle`），选单从 accepted 换成 planned。
- 模式互斥沿用现状：一个项目同一时间只允许一个实施任务；模式冲突显示持有者，不静默抢占。

### 4. 选单口径：从 accepted 切到 planned，实时队列

- `scripts/lib/batch.mjs` 与 `scripts/lib/scheduler.mjs` 的候选过滤改为 `status === 'planned' && !owner`（依赖策略 `depBlocked` 判定保留：依赖未满足的已计划单暂不派发）。
- 「最旧优先」：按创建时间升序（与现排序口径一致：需求优先于 Bug 的规则是否保留，**待确认**；需求原文只说「先处理最旧的单」，建议默认纯创建时间序，Bug 与需求同序）。
- 「实时获取」：调度器每轮取单时重新查询当前 planned 集合（Codex 调度器现为轮询驱动，天然支持；运行中新置计划的条目可被取到），**不再使用创建批次时冻结候选快照的模型**——Zcode 批次的冻结快照/排队批次（REQ-20260906-025）是否整体退役或仅对新流程停用，**待确认**；存量未结束批次的兼容处置（读旧账本照常跑完，还是提供迁移入口）**待确认**。
- 批次上限（1–100，默认 20）在新「实时队列」模型下的语义（是否保留总量上限）**待确认**。

### 5. 接口与服务端

- `scripts/server.mjs` 新增人工操作 API（均走人工通道，Agent 调用被 state-guard 的 curl 拦截规则约束）：
  - `POST /api/item/:id/status`（或复用既有流转入口）支持 `planned`；
  - 批量移出计划：`POST /api/plan/remove`（ids 数组）；
  - 开发启动：复用 `/api/dispatch/codex/toggle`（codex）与批次创建入口（zcode），外加模式参数。
- `scripts/atb.mjs` CLI 是否需要 `plan` / `unplan` 子命令（供人在终端操作），**待确认**（非必需，看板优先）。

### 6. 影响面清单

| 文件 | 改动 |
| --- | --- |
| `scripts/lib/core.mjs` | STATES/TRANSITIONS/HUMAN_ONLY_TO、claim() 接受 planned、setStatus 校验 |
| `scripts/state-guard.mjs` | 人工专属状态清单加入 planned（file/bash 两模式） |
| `scripts/lib/batch.mjs` | 候选口径 accepted → planned；冻结快照模型处置 |
| `scripts/lib/scheduler.mjs` | 取单口径 accepted → planned；空队列等待文案 |
| `scripts/server.mjs` | 计划/移出计划/启动 API；报错文案改名 |
| `scripts/web/index.html` | implGo 按钮文案与 title |
| `scripts/web/app.js` | STATE_LABEL/LANES/详情按钮/选择工具条/任务面板「开发启动」 |
| `docs/agent-team-board/batch-execution.md` | 名称与流程说明更新 |

## 风险与边界

- **状态机是全局铁律**：planned 必须纳入 state-guard 人工专属拦截，否则 Agent 可自行造计划绕过人工排期；实现时先改守卫再放开 UI。
- **存量兼容**：老 `status.json` 为字符串枚举，新增枚举值无需数据迁移；但未结束批次账本、REQ-20260907-012 的 batchEntry 展示、`/dev next`（`atb list` 候选）口径都要同步评审，避免 accepted 旧单被新调度器永久饿死（升级后 accepted 单不再被自动取单，需人工置计划）。
- **Zcode 模式的「启动」语义**：看板无法确证 Zcode 会话已运行（复制成功 ≠ 启动成功），按钮文案与状态展示不能宣称「已启动」，只能到「待启动/就绪」。
- **并发与互斥**：已计划不占用实施互斥（仅排期表达）；进入开发中才占用，规则与现状一致。

## 实施记录（2026-09-08，zcode-batch-014-1）

已按上述方案实施，全部 85 个测试文件（含新增 `scripts/tests/planned-state.test.mjs` S1–S17）通过。落地要点与
「待确认」项定案如下：

1. **状态机（`scripts/lib/core.mjs`）**：`STATES` 增 `planned`；`TRANSITIONS.accepted = ['planned','in-progress','submitted']`、
   `TRANSITIONS.planned = ['in-progress','accepted']`；`HUMAN_ONLY_TO` 增 `planned`。`claim()` 把 planned 与 accepted
   同等对待（认领即实施、占用实施互斥）；`setStatus` 为 accepted→planned / planned→accepted 补默认 note。
2. **守卫（`scripts/state-guard.mjs`）**：bash 规则②（`atb status <ID> …`）与规则③（curl 人工 API）的拦截清单
   均加入 `planned`；`HUMAN_STATE_HINT` 同步为 accepted / planned / done。
3. **选单口径**：`batch.candidateItems` 与 `scheduler.selectCandidate` 均改为 `status === 'planned' && !owner`。
   **排序定案：纯创建时间升序（最旧优先）**，「需求优先于 Bug」旧规则随已计划口径退役（需求原文「先处理最旧的单」）。
4. **实时队列**：`batch.nextItem` 领取前经 `absorbNewCandidates` 吸收「创建批次之后新置计划」的条目——运行中置计划
   无需重启/新建批次即可被取到。**limit 语义定案**：批次上限只约束创建时点的初始快照，吸收不受 limit 截断；但吸收
   排除已冻结在其他未结束批次中的条目（一个条目至多属于一个批次，防双批重复派发）。
5. **开发启动（`scripts/web/app.js`）**：任务模块 zcode/codex 面板之上新增统一「开发启动」条（`renderDevStartBar` /
   `bindDevStart` / `startDevelopment`）：模式下拉含空占位（未选模式启动禁用）、已计划队列预览（最旧优先）、运行态
   反馈（codex 开启→「停止」；zcode 批次执行中→沿用「暂停后续」）。zcode 启动=创建批次+复制主调度提示词（状态只到
   「待启动」，复制成功≠启动成功）；codex 启动=`/api/dispatch/codex/toggle {enabled:true}`，每轮从已计划队列实时取单。
6. **计划 UI**：`LANES` 六档（已计划独立档，**定案默认方案**）；详情页 accepted 档新增「改为已计划」、planned 档提供
   「移出计划（退回已接受）」（均免二次确认、可撤销，`ACTION_UNDO.planned`）；planned 行复用 `data-impl-id` 勾选
   （原已接受行勾选资格切换为已计划），选择工具条新增「移出计划」按钮，`removeFromPlan` 逐条 POST
   `/api/item/:id/status {to:'accepted'}`（**定案：不新增 `/api/plan/remove` 端点**，对齐批量接受 acceptItems 的逐条
   流转+成功/失败分列反馈，服务端 setStatus 校验天然拒绝 in-progress 等非法源）。空态/等待文案改为「等待已计划条目」。
7. **服务端（`scripts/server.mjs`）**：`boardTransitionAllowed` 增 accepted↔planned 两条人工边；`/api/board` 与
   `/api/item/:id` 的 batchEntry 附加覆盖 planned（升级后已入旧批次的已计划条目仍显示「已入批次」）。
8. **改名**：`scripts/web/`、`atb.mjs`、`server.mjs`、`lib/*`、`skills/`（SKILL.md、worker-spec.md）、`commands/dev.md`、
   `docs/agent-team-board/batch-execution.md` 中面向用户的「批量实施」统一改「批量开发」；内部标识符（`implGo`、
   `/api/batch/*`、`batch` 命令名）保留不动，避免 API 破坏。
9. **`/dev next` 口径**：dev.md/SKILL.md 改为选「创建最早的 planned」；没有已计划条目提示先接受并「改为已计划」。
   手工 `claim` 仍接受 accepted（人工兜底通道，不违反铁律）。
10. **CLI**：未新增 `plan`/`unplan` 子命令（**定案：看板优先**，终端人工可用 `atb status <ID> planned|accepted` 表达）；
    `atb list` marks 增 `planned: '◈'`，帮助文案状态机补 planned。
11. **存量兼容定案**：老 `status.json` 无需迁移（枚举新增）；未结束批次的剩余 accepted 候选在新口径下按「冻结后被认领
    或流转」出局、批次自动收尾（`check` 如实说明），需人工对相应条目置计划后走新流程——不会静默丢单，也不会永久饿死
    （planned-state S6 + batch-core BUG-20260906-001 回归验证）。本项目升级时点的在途批次 `batch-20260908-014` 同样
    适用：其剩余 accepted 候选需人工「改为已计划」后由开发启动继续处理。
12. **测试**：新增 `scripts/tests/planned-state.test.mjs`（15 用例：状态机/守卫/选单/实时队列/API/UI/改名/回归）；
    既有 `scheduler`、`batch-*`、`impl-*`、`codex-*`、`dispatch-api`、`pending-alignment`、`confirm-lane`、
    `drawer-undo`、`loop-mode`、`rename-reject` 等测试的样本构造与断言同步切到 planned 口径（`npm test` 85 文件全绿）。
