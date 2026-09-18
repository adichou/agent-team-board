# 设计 — REQ-20260908-022 支持就单一需求和 Agent 进行讨论的功能

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

讨论单（oncall/tickets/ASK-…，REQ-20260907-001）与需求完全隔离：`createTicket` 无需求关联字段，派单提示词（zcode `oncall show` / codex worker prompt）不带需求文档上下文，Web 需求详情抽屉无讨论区块，讨论卡片也不显示归属需求。要就某条需求澄清/评审，只能手工粘贴需求内容，讨论记录无法回溯。

## 方案

### 1. 关联字段落位（README「待确认」定案）

**扩展讨论单 ticket.json，新增可选字段 `reqId`**（仅接受 REQ- 编号；Bug 不支持，本需求范围外）。目录落位不变（仍 `oncall/tickets/ASK-…/`），轮次/派单/附件/账本全部复用 oncall 现有机制。一个需求允许多个讨论线程（不设上限）；绑定讨论与其他讨论一样进入批量派单（无需按需求特殊处理）。

- `createTicket({ title, question, attachments, by, req })`：`req` 非空时校验形如 `REQ-YYYYMMDD-NNN` 且 `requirements/<REQ-ID>` 存在（经 `core.resolveItemDir` 定位且类型为 requirement），否则报错；缺省/空 → `reqId: null`（老单语义完全不变）。
- `ticketCard` 卡片视图带出 `reqId`；`listTickets({ status, reqId })` 支持按需求过滤（与状态过滤可组合）。

### 2. 上下文自动注入（两处口径一致）

新增 `reqContext(dataDir, reqId)`：读需求 `status.json`（id/标题/状态）与 `README.md`/`design.md`/`test-cases.md` 全文（存在才带，缺失跳过），需求目录已删除时返回 `null`。

- **zcode 模式**：`atb oncall show` 文本输出在状态行后加「归属需求：REQ-…（标题，状态）」与「── 需求文档上下文 ──」节（三文档全文）；`--json` 输出附加 `req: { id, title, status, missing, docs: [{name, content}] }`。子代理读单即得上下文，追问轮同样生效（show 每次实时读盘，回答始终基于最新落盘文档）。
- **codex 模式**：`buildOncallWorkerPrompt` 开头注入同一「归属需求」节（元信息 + 三文档全文）；未绑定需求的单提示词不变。

### 3. CLI 对等

- `atb oncall new --req <REQ-ID> --title …`：创建绑定讨论（用法文案同步更新）。
- `atb oncall list [--req <REQ-ID>]`：按需求过滤；列表行在标题前显示 `[REQ-…]` 标记。
- `atb oncall show`：输出归属需求与文档上下文（见上）。

### 4. Server API

- `POST /api/oncall/ticket`：body 可带 `req`（校验同 store 层）。
- `GET /api/oncall/tickets?req=<REQ-ID>`：返回该需求讨论卡列表（需求抽屉区块数据源，轻量、随 2 秒轮询刷新）。
- `/api/oncall/board` 卡片与 `/api/oncall/ticket/<id>` 全文带出 `reqId` / `req`。

### 5. Web 双向可见

- **需求侧**（app.js `renderDrawer`）：需求详情抽屉新增「需求讨论（N）」区块（下属 Bug / 批次设置之后、文档 tabs 之前）：条目行（单号、标题、状态徽标、轮数、最近活动时间），点行跳讨论模块并打开该单抽屉；「＋ 发起讨论」打开统一新建弹窗并预填只读「关联需求」；空态引导文案。区块数据由主轮询 `poll()` 驱动的 `refreshReqDiscussions()` 按签名去重刷新，回复中→已回复自动流转。
- **讨论侧**（oncall.js）：卡片与详情抽屉显示归属 REQ-ID 徽标/链接；点击经 `window` 自定义事件 `atb:open-req`（app.js 监听后 `openDrawer(id)`）跳回需求详情；`ATBOncall` 新增导出 `openDrawer(id)` 供需求区块跳入讨论抽屉。
- **统一新建弹窗**（index.html + app.js）：讨论类型新增可选「关联需求」输入（格式 REQ-；从需求抽屉发起时预填并只读），提交时随创建接口传 `req`。

### 6. 只读口径不变

讨论不改变 REQ/BUG 状态机、不占 impl.lock、不进 /dev 选单（复用 oncall，天然满足）。需求被删除后：讨论单保留 `reqId`，展示「（需求已删除）」，上下文注入输出缺失提示，不崩坏、不串单；需求状态流转不影响讨论线程。

## 风险与边界

- `reqId` 校验仅在创建时进行；创建后需求删除/改名不级联（讨论记录独立保留，回溯价值优先）。
- 上下文全文注入会增大 codex prompt 体积——与现状「人工粘贴全文」等价，可接受；三文档缺失时逐份跳过。
- 老数据（无 `reqId` 字段）读写路径全部走 `meta.reqId || null`，无迁移需求。
- Web 跳转跨模块依赖 `window.ATBOncall` 与自定义事件两条既有接缝风格（前者已被 app.js 使用，后者为最小新增）。

## 实施记录

- 2026-09-08 zcode-batch-018-1：按上述方案实施；新增 `scripts/tests/oncall-req-bind.test.mjs`（R1~R7，先红后绿），改动 `scripts/lib/oncall-store.mjs`、`scripts/atb.mjs`、`scripts/server.mjs`、`scripts/web/index.html`、`scripts/web/app.js`、`scripts/web/oncall.js`、`scripts/web/style.css`（区块徽标样式）。
