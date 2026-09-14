# 设计 — REQ-20260910-003 增加一个全局看板，可以看到当前在工作的批量任务

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板现为单项目视角（顶栏 `#projectSel` + `?project=` + `atb.project` 记忆），批次账本分散在各项目自己的
`docs/agent-team-board/` 下。要了解「哪些项目有批量任务在跑」，只能逐个切项目进任务模块。注册表
（`~/.agent-team-board/projects.json`，服务端 `loadRegistry()`）已具备跨项目枚举能力，缺一个只读聚合出口。

## 方案

（技术选型、接口设计、影响面）

### 开源选型（REQ-20260909-015）

自研，理由：**无合适库**。本需求是「读自家批次账本 + 渲染一个只读列表」，数据模型（batch.json /
run.json / 状态词表）全部是项目自有结构，不存在可复用的通用开源库；服务端沿用现有零依赖 node:http，
前端沿用现有原生 JS 单页（app.js），不引入任何新依赖，也不创建 licenses.md。

### 服务端：只读聚合接口 `GET /api/batch/global`

- 位置：`handleApi` 中与项目无关区（`/api/health` 旁），**不走 `resolveProject`**——聚合与当前项目无关。
- 数据源：`loadRegistry().projects`（与 `/api/health` 的 `projects` 同口径）。
- 逐项目容错：单项目读盘失败只影响该项目行（`status:'error'` + `error` 原因），不阻塞其他项目：
  - 项目目录不存在 / 不可访问 → error（README 状态反馈「读取失败」行）；
  - 未初始化（无 `docs/agent-team-board/`）→ `status:'ok'`、`tasks:[]`（README 边界：按无任务处理，不报错）；
  - 批次账本 JSON 损坏（batch.json 解析失败）→ error（listBatches 会静默跳过坏账本，这里显式扫出并报错）；
  - 其余异常（权限等）→ try/catch 兜底为该项目 error。
- 在工作口径（与 README 一致）：
  - 批量开发：`batch.unfinishedBatches()`（`status !== 'finished'`），再排除 `aborted`（终止即 status=finished，
    双保险）；
  - 批量完善：`refine.unfinishedRefineBatches()`，同样排除 `aborted`；
  - 已结束 / 已终止批次不出现，收尾后下一轮轮询自然移出。
- 排队标记：项目内非队首的 `prepared` 批次 `queued:true`（前端 chip 显示「排队中」，与
  `batchStatusLabel(s, queued=true)` 同口径）。
- 每条任务简报字段：kind（develop/refine）、batchId、status、queued、pauseRequested、aborted、developer、
  createdAt、lastActivityAt、current（itemId/title/owner/createdAt，无当前项为 null）、counts（原始计数）。
- 计数与当前项与项目内任务面板**同源**：直接用 lib 层 `batchState` / `refineBatchState`（面板计数、
  currentRun 的同一计算函数），保证两处显示一致。

### lib 层：两个只读简报函数（不触发核对 / 结算 / 锁）

- `scripts/lib/batch.mjs` 新增 `batchBrief(dataDir, batch)`：`batchState` 计数 + 当前 run（标题经
  `itemTitleOrEmpty` 容错读取）。
- `scripts/lib/refine-store.mjs` 新增 `refineBatchBrief(dataDir, batch)`：`refineBatchState` 同口径。
- 二者均为纯读：不调用 `checkBatch` / `settleRefineBatch`（它们可能改批次状态）、不写任何文件、不碰锁。

响应形态：

```json
{
  "ok": true,
  "projects": [
    { "root": "/abs/path", "name": "proj-a", "status": "ok", "error": null,
      "tasks": [ { "kind": "develop", "batchId": "batch-20260910-028", "status": "prepared",
                   "queued": false, "pauseRequested": false, "aborted": false, "developer": null,
                   "createdAt": "…", "lastActivityAt": "…",
                   "current": { "itemId": "REQ-…", "title": "…", "owner": "…", "createdAt": "…" } | null,
                   "counts": { "total": 3, "reported": 0, "failed": 0, "interrupted": 0,
                               "blocked": 0, "skipped": 0, "remaining": 3 } } ] }
  ]
}
```

（refine 批次 counts 键为 `done`，develop 为 `reported`，与各自面板现状一致，前端按 kind 取数。）

### 前端：新视图 `global`（`scripts/web/index.html` + `app.js` + `style.css`）

1. **导航与容器**：第二行模块导航「任务」旁新增「全局」页签（`data-view="global"`）；`#globalView`
   容器与 runsView 同级。`VIEWS` 数组加入 `'global'`，URL 深链 `?view=global` 与 `syncProjectUrl`
   沿用现有机制；`MODULE_SUB.global` / `SEARCH_PLACEHOLDER.global` 补齐。
2. **不随项目切换变化**：视图数据只来自 `/api/batch/global`；顶栏项目选择器保持可见（跳转时会被
   `switchProject` 同步）。
3. **渲染结构**（对齐 README 界面展示）：
   - 汇总条：「N 个项目 · M 个在工作的批量任务（执行中 x · 待启动 y · 排队中 z · 已暂停 w · 待核对 v）」；
   - 筛选 chips：状态（全部 / 执行中 / 待启动 / 已暂停 / 待核对）× 类型（全部 / 批量开发 / 批量完善），
     复用 `.filter-chip` 样式，纯前端过滤；
   - 关键词过滤：复用第三行搜索框（`runSearch` 增加 global 分支，匹配项目名 / 批次号 / 条目编号 / owner）；
   - 列表按项目分组（组头：项目名 + 完整路径 title + 该项目任务数），组内每条任务一行卡片：
     状态 chip（`batchStatusLabel` 同口径 + 已请求暂停小标）+ 类型 chip + 批次号（等宽）+ 当前条目编号
     （可点击）与标题 + owner + 计数行（已上报|已完成 a / 异常 b / 待处理 c / 共 d）+ 开发人员 + 创建 /
     最后活动时间；
   - 底部说明行：随轮询自动刷新，操作进对应项目任务模块。
4. **状态反馈**：首载骨架（行级浅色块）；全部收尾空态；部分失败（项目组降级为错误卡，随下轮轮询自动重试，
   不给重试按钮）；无注册项目引导空态；连接异常沿用 `#pollState` 指示灯口径（保留上次数据）。
5. **轮询**：`poll()` 中 `state.view === 'global'` 时 `refreshGlobal()`；响应整体做 JSON 签名比对，
   无变化不重渲染（不打断筛选与悬停）。
6. **跳转**：
   - 任务行 / 「进入项目任务」按钮 → `switchProject(root)` → `gotoRuns(kind === 'refine' ? 'refine' : 'develop')`
     （顶栏选择器、URL `?project=` 随 switchProject 同步，浏览器返回可回到全局视图）；
   - 当前条目编号 → `switchProject(root)` → `setView('status')` → `openDrawer(itemId)`（复用
     `data-goto-item` 跳转语义）。
7. **视图快照（REQ-20260910-001）**：`view` 与全局筛选档（globalStatus / globalKind）进 sessionStorage
   快照；刷新恢复沿用 `applyViewSnapshot` 既有链路。
8. **样式**：`style.css` 新增 `.global-view` 系列；颜色一律走现有 CSS 变量（`--bg/--panel/--border/--muted`
   等），深浅色 `prefers-color-scheme` 自动适配，不引入单主题样式。
9. **只读**：面板内不出现任何暂停 / 终止 / 删除按钮，不调用任何写接口。

### 影响面

- `scripts/server.mjs`：新增一个 GET 路由（只读，无迁移）。
- `scripts/lib/batch.mjs` / `scripts/lib/refine-store.mjs`：各新增一个导出的只读函数。
- `scripts/web/index.html` / `app.js` / `style.css`：新增视图，不改既有视图逻辑（poll/runSearch/setView
  各加一个 global 分支）。
- Electron 壳加载同一页面，自动受益，无需改动。
- 旧版本服务 + 新前端：接口 404 落入既有「未知接口 → atb serve 自愈」指引（api() 封装既有兜底）。

## 风险与边界

- 轮询成本：每 2s 全注册表读盘一次。与现有面板「实时读盘、不新增缓存状态机」口径一致（README 边界 2）；
  注册表为个位数到十几个项目量级，每个项目只读批次目录与 run 目录索引，可控；签名无变化不重渲染。
- 注册表可能含已迁移 / 删除路径：逐项目容错（错误行）而非整页报错。
- 聚合只读：不写任何账本、不改条目 status.json、不碰锁；对未初始化项目按「无任务」处理。
- Codex 后台执行器状态不聚合（README 口径解读第 3 点：首期只聚合两类批次账本）。
