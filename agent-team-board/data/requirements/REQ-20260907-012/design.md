# 设计 — REQ-20260907-012 已接受的需求或 Bug 不要在列表界面或详细内容界面显示已接受便签，应呈现是否已进入批次

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

「已接受」只是状态机中转态；人工接受后条目要进入批量实施批次（REQ-20260906-002）才会被派发。
现状列表卡片与详情抽屉只显示「已接受」状态，无法回答「这条排进批次了吗」。

## 方案

### 数据层（scripts/lib/batch.mjs + scripts/server.mjs）

- `batch.mjs` 新增导出 `batchEntryIndex(dataDir)`：读取未结束批次
  （`unfinishedBatches`，创建时间升序），为每个 candidate 建立 `itemId → { batchId, status }`
  索引；同一编号出现在多个未结束批次时取**最早创建**的批次（与队列派发顺序一致）。
  批次 `finished` 后不再计入（`unfinishedBatches` 口径天然满足）。
- `server.mjs`：
  - `/api/board`：响应组装后，对 `status === 'accepted'` 的条目附加
    `batchEntry`（入批为 `{ batchId, status }`，否则 `null`）；非 accepted 不附加（载荷最小化）。
  - `GET /api/item/:id`：同样为 accepted 条目附加 `batchEntry`。
- 读取成本：每次轮询读 dispatch/batches 下少量 JSON，与既有 `queueHeadBatch` 等同量级。

### 前端（scripts/web/app.js）

- 新增 `BATCH_ENTRY_STATUS_LABEL`（prepared=排队中 / running=执行中 / paused=已暂停 /
  needs_attention=需人工处理）与 `acceptedEntryHtml(it)`：accepted 条目渲染
  「已入批次」（`title="已入批次 <batchId>（<状态>），等待派发实施"`）/「未入批次」chip；
  字段缺失（历史响应/异常）按未入批次兜底。
- 列表 `reqRowEl`：accepted 条目的状态 chip 由固定 `LANE_LABEL` 改为 `acceptedEntryHtml(it)`，
  卡片 `title` 同步改为批次进入状态说明；其他 lane 不变。
- 详情 `renderDrawer`：meta「状态」字段 accepted 时渲染 `acceptedEntryHtml(it)`；
  `drawerActionsNoticeHtml` accepted 分支改为按入批与否输出指引（不再以「已接受。」开头）。
- `renderBoard` 列表签名 per-item 元组追加 `batchEntry`（取 batchId+status），
  入批/出批后轮询自动重绘。

### 不改动

- 状态机、筛选条五档、批量实施面板内部展示、`LANE_HINT`（accepted 行 title 已由本需求接管）。

## 风险与边界

- `batchEntry` 为新增可选字段，旧客户端/测试stub忽略即可；前端对缺省值兜底为「未入批次」。
- 多个未结束批次含同一编号时只显示最早批次；这符合队列派发语义（先入先派）。
- refine 完善批次面向待接受条目，与实施批次账本分离，不参与判定。

## 实施记录

- 2026-09-08 zcode-batch-010-4（批次 batch-20260908-010 / run-20260908-057）：
  - `scripts/lib/batch.mjs`：新增导出 `batchEntryIndex(dataDir)`（未结束批次 candidates → 最早批次 `{batchId, status}`）。
  - `scripts/server.mjs`：`/api/board` 对 accepted 条目附加 `batchEntry`（入批 `{batchId,status}`，否则 `null`；非 accepted 不附加）；`GET /api/item/:id` 同口径。
  - `scripts/web/app.js`：
    - 新增 `BATCH_ENTRY_STATUS_LABEL` / `acceptedEntryChip(it)` / `acceptedEntryTitle(it)`，字段缺失兜底「未入批次」。
    - 列表 `reqRowEl`：accepted 行状态 chip 改为「已入批次/未入批次」（`s-accepted in-batch` 标记 hook，沿用已接受档配色），卡片 title 同步改为批次进入状态说明。
    - 详情 `renderDrawer`：meta「状态」字段 accepted 时渲染批次进入 chip；`drawerActionsNoticeHtml` accepted 分支按入批与否输出指引（不再以「已接受。」开头）。
    - `renderBoard` 列表签名 per-item 元组追加 `batchEntry`（`batchId:status`），入批/出批后轮询自动重绘。
  - TDD：新增 `scripts/tests/accepted-batch-entry.test.mjs`（L1–L6 前端 vm + S1 lib 单测 + S2 起真实 server 集成），先跑红（7 项失败）后实现跑绿；全量 `npm test` 73 个测试文件 0 失败。

