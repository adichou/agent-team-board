# 设计 — REQ-20260907-011 待接受需求和 Bug 可以由用户自行更改标题。已接受的需求可以驳回变为待接受

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- 标题存在于两处：`status.json.title`（机器事实源）与条目文档首行
  （`# REQ-… 标题` / `# 设计 — REQ-… 标题` / `# 测试用例 — REQ-… 标题`）。创建时由
  `core.createItem` 一次性写入，此后没有任何修改入口。
- 状态机 `TRANSITIONS` 冻结为单向主干，唯一回退边是 done → in-progress（人工驳回完成）。
  accepted 条目一旦误接受只能等待 Agent 认领，没有人工反悔路径。
- 人工操作入口约定：Status Board 网页（`boardTransitionAllowed` 白名单 + `/api/item/*`）
  与终端 `atb` 命令；Agent 侧写 `status.json` 由 `hooks/state-guard.mjs` 拦截，本设计不变更。

## 方案

### 1. 改标题（仅 submitted）

- `core.mjs` 新增 `renameItem(dataDir, id, { title, by })`：
  - 校验：标题非空、≤120 字（与 `createItem` 同口径）、不得与原标题相同；
    状态必须为 `submitted`，其余状态抛 `AtbError`。
  - 写入：更新 `status.json`（`title` / `updatedAt`），`history` 追加
    `from === to === 'submitted'` 的留痕记录（与 report 的留痕写法一致）。
  - 文档同步：遍历条目目录下全部 `.md`（`orderedDocs`），对首行做
    `# <前缀><ID> <旧标题>` → `# <前缀><ID> <新标题>` 的定点替换（按 ID 定位，
    不依赖文档种类前缀，兼容用户后期手工补充的文档首行）。
- CLI：`atb rename <ID> <新标题>`，成功输出确认行；usage 同步登记。
- 服务端：`POST /api/item/:id/title`，body `{ title }`，`by: 'board'`；
  非法状态 / 非法标题按 `AtbError` → 400 返回。
- 网页：新增 `uiPrompt`（页面内异步输入对话框，与 `uiConfirm` 同款自绘，
  IAB 内不可用同步 `window.prompt`，同 BUG-20260907-009 结论）；submitted 卡片
  「row-acts」区与详情页操作区显示「改标题」按钮，确认后调 API 并刷新。

### 2. 驳回接受（accepted → submitted）

- `TRANSITIONS.accepted` 增加 `'submitted'`；`setStatus` 的非法流转提示语同步补述。
  人工回退边（回退到前一个状态）从 1 条变 2 条，注释同步更新。
- 状态为 accepted 时条目必然无 owner（认领即 in-progress），驳回无需清理认领信息；
  history 留痕缺省 note「人工驳回接受，退回待接受」。
- 服务端 `boardTransitionAllowed` 增加 `accepted → submitted` 白名单。
- 网页：详情页 accepted 状态新增「↩ 驳回接受」按钮（`data-act="submitted"`，免二次确认，
  与既有详情页按钮一致）；`ACTION_UNDO` 新增 `accepted: { to: 'submitted' }`，
  接受操作由此获得撤销；`ACTION_LABEL` 补 `'submitted': '驳回接受'` 供拖拽换列复用。
- 范围说明：需求原文只写「已接受的需求」，但需求 / Bug 共用同一状态机与看板列，
  无业务理由区分（同批 REQ-20260907-012 亦按「需求或 Bug」并列表述），
  故实现上两者一致支持驳回；仅改标题维持原文口径只覆盖 submitted（此时需求 / Bug 均适用）。

### 影响面

- `scripts/lib/core.mjs`（renameItem、TRANSITIONS、setStatus 提示语）
- `scripts/atb.mjs`（rename 子命令）
- `scripts/server.mjs`（/api/item/:id/title、boardTransitionAllowed）
- `scripts/web/app.js`（uiPrompt、改标题按钮、驳回接受按钮、ACTION_UNDO/ACTION_LABEL）
- 不动：`hooks/state-guard.mjs`、批量为认领资格（candidates 仍要求 accepted，不受影响——
  驳回后条目回到 submitted 自然退出候选）。

## 风险与边界

- 标题同步采用「首行按 ID 定位替换」，仅覆盖 `createItem` 生成及同构手工首行；
  用户完全改写过首行（不含 ID）的文档保持原样，不视为错误。
- 驳回接受与「批量实施候选」存在竞态：候选快照在批次创建时生成，驳回后若批次仍派发该单，
  claim 会被状态机拒绝（submitted 不能认领），与既有保护一致，不新增处理。
- `atb rename` / 网页改标题均为人工语义入口，不放宽 Agent 改 `status.json` 的守卫约束。
