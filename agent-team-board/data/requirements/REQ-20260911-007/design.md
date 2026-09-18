# 设计 — REQ-20260911-007 受阻待人工决策条目的承接机制：持久呈现、人工决策入口与复工通路

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

批量 / 单项开发中 worker 遇到必须人工决策的场景，现行唯一出口是交 blocked 回执后结束，条目滞留
in-progress：无持久待办视图、无结构化作答入口、无送回执行队列的通路，形成流程黑洞
（cam-media-man REQ-20260908-001 滞留三天即实例）。

## 方案

### 形态裁定（README「待确认」四项的实施取舍）

| 待确认项 | 裁定 | 理由 |
| -------- | ---- | ---- |
| 机制形态 | **保持 in-progress + 独立决策账本**（`holds/holds.json` 执行层索引，不动状态机） | 与 refine 三态同构，风险最低；状态机 / 历史数据零迁移 |
| 复工目标 | **回到 planned 全局队列**（batch next 实时吸收新置计划条目，无需重建/重开批次） | 与 REQ-20260908-010 实时队列天然衔接；retryItems 绑定旧批次，批次结束后失效 |
| 决策记录载体 | **条目目录独立文件 `decisions.md`**（atb 维护、随代码进 git）+ holds/holds.json 账本（不进版本控制） | 结构化计数靠账本，人读留痕靠条目文档；不混入 design.md 实施记录，不复用 oncall |
| 与 oncall 分工 | 本机制自带「声明 → 呈现 → 决策 → 复工」闭环；oncall 仍只做 Agent 客服答疑 | 语义不同：oncall 不改条目状态、无复工语义 |

### 数据模型

`docs/agent-team-board/holds/holds.json`（首次写入自动加进数据目录 .gitignore）：

```
{ version, items: { <itemId>: rec }, archived: { <itemId>: rec[] } }
rec = { state: holding|resumed|cancelled|closed-done, round, itemId,
        declaredAt, declaredBy, runId|null, reason|null,
        questions: [ { id: q1.., text, answer|null, answeredAt, answeredBy, note|null } ],
        events: [ { at, kind: declared|answered|resumed|cancelled|closed-done, by, note? } ] }
```

- 活动（holding）= claim / 确认完成防呆与聚合视图的判定口径；终态记录保留在 items（最近一轮），
  再声明时整体移入 archived（多轮承接，decisions.md 保留全部历史轮次）。
- 条目 `decisions.md` 在每次声明 / 作答 / 复工 / 作废 / 闭环后整体重渲染（表格：问题 / 状态 /
  人工答复 / 补充说明 / 作答人；事件时间线）。

### 状态机与铁律（不破坏既有约束）

- hold 全程条目保持 **in-progress**；不新增状态、不改 TRANSITIONS。
- **复工专用通路** `core.resumeItemToPlanned`：in-progress → planned 仅此一处实现（清 owner、
  删认领锁、释放手工实施占用、history 留痕）；普通 `setStatus` / 网页状态接口不提供此边
  （`boardTransitionAllowed` 未放开）。
- **人工专属操作**：`atb hold answer|resume|cancel` 与 `POST /api/hold/:id/{answer,resume,cancel}`
  由 state-guard 确定性拦截 Agent（与 `atb status accepted|planned|done` 同口径）；
  `declare/list/show` 面向 worker 与人工，放行。
- **确认完成防呆**：`core.setStatus` 在 in-progress → done 时检查活动 hold——未答完拒绝
  （提示缺项数与指引），`--force` / `body.force` 显式越过后随确认闭环（closed-done，留痕）；
  已答完则放行并自动闭环。
- **认领防呆**：`core.claim` 对活动 hold 条目拒绝任何 owner（含原 owner 续认），指向待确认原因；
  复工回 planned 且无 owner 后恢复正常认领 / 批量取单。
- **回执兼容**：declare 与 blocked/failed 回执正交——worker 声明后仍按既有协议交 blocked 回执，
  历史语义与数据零改动。

### 模块与接口

| 模块 | 内容 |
| ---- | ---- |
| `scripts/lib/hold-states.mjs`（新） | 自包含账本（不 import core，防循环依赖——被 core 引用）：读写 / active 判定 / 计数 / 归档 / decisions.md 渲染器 |
| `scripts/lib/hold-store.mjs`（新） | 业务编排：declareHold / answerHold / resumeHold / cancelHold / listHolds / holdDetail / waitingText |
| `scripts/lib/core.mjs` | claim 防呆钩子；setStatus 确认完成防呆（force 口径）；`resumeItemToPlanned` 复工专用通路 |
| `scripts/atb.mjs` | `atb hold declare/list/show/answer/resume/cancel`；`atb status --force`；USAGE |
| `scripts/state-guard.mjs` | bash 规则 (2c) 拦 `atb hold answer/resume/cancel`；(3b) 拦 `POST /api/hold/:id/(answer/resume/cancel)`（GET 只读放行） |
| `scripts/server.mjs` | `GET /api/holds`（聚合清单）、`GET /api/hold/:id`（详情）、`POST /api/hold/:id/{answer,resume,cancel}`；/api/board 与 /api/item/:id 附加 hold 徽标数据；/api/item/:id/status 透传 force |
| `scripts/web/index.html` | `#holdArea` 持久聚合区（需求列表下方，空态整体隐藏）；`#holdPanel` 决策侧拉面板（读取 / 错误 / 表单三态） |
| `scripts/web/app.js` | renderHolds 聚合区（卡片：等待时长 / 未答清单✓○ / 查看进展记录 / 补决策 / 复工（缺项禁用）/ 确认完成）；决策面板（草稿保存、缺项提示）；confirmDoneGuard 二次确认 + force 提交；开发中行「⚠ 等人工决策」角标；Esc 链与弹窗让位 |
| `scripts/web/style.css`、`scripts/web/i18n.js` | 聚合区 / 卡片 / 面板样式（--inprogress 色系）；全部新增文案 EN / EN_DYNAMIC 词条 |

### 开源选型（REQ-20260909-015）

自研（无合适库的原因）：本需求是本插件执行账本 / 状态机 / 钩子体系内的流程机制，无独立开源库可依赖；
实现仅用 Node 内置 fs/path 与既有自有模块，未引入任何第三方依赖，不创建 licenses.md。

## 实施记录

- 测试：`scripts/tests/hold-20260911-007.test.mjs`（D1-D9 数据层与 CLI / P1-P3 core 集成 /
  G1-G2 钩子 / S1-S4 服务端 / U1-U2 前端静态契约）；受影响 vm 夹具补 `#holdPanel` 初始隐藏桩
  （shortcuts / impl-entry-ui / new-shot-preview / refresh-* / hide-* 共 7 处）。
- 回归：`npm test` 201 个测试文件全部通过。
- 文档同步：worker-spec.md（skill 源）、SKILL.md（CLI 速查 / 批量任务 / TDD 流程）、
  batch-execution.md（§ 待人工决策承接）。
- 存量滞留单承接：`atb hold declare <ID> --question …` 不要求 --run（人工可为历史 blocked 单补登记）。

## 风险与边界

- holds/holds.json 损坏 / 缺失按「无记录」处理（不阻断看板与批次）；decisions.md 写失败不阻断账本操作。
- 复工只处理 in-progress（状态已变化即拒绝，不静默变更）；人工 force 确认完成会越过未答决策（事件留痕）。
- 不引入通知渠道；呈现以 Status Board 聚合区与 `atb hold list` 为准（见 README 非目标）。
