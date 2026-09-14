# 设计 — REQ-20260907-001 Oncall 咨询看板：咨询单创建、批量/单条派单回复，富文本与截图展示，支持 zcode 与 codex

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ/BUG 状态机面向开发实施（人工接受 → 认领 → 上报 → 人工确认），不适合轻量问答。本需求新增
Oncall 咨询看板：独立数据目录与编号序列、轻量状态（待回复/回复中/已回复/失败）、复用现有派发
基础设施（zcode 提示词复制 / codex exec 后台执行）实现批量与单条派单，回答经 Markdown 渲染并
支持截图附件内联展示。

## 方案

### 1. 数据层（新模块 `scripts/lib/oncall-store.mjs`）

目录（事实源随项目走；`oncall/runs/` 不进版本控制）：

```
docs/agent-team-board/oncall/
├── settings.json          # 独立计数器（ask/run，按日重置；.locks/oncall.lock 互斥）
├── tickets/ASK-YYYYMMDD-NNN/
│   ├── ticket.json        # 元数据（atb 维护；非 REQ/BUG status.json，不经状态机铁律）
│   ├── question.md        # 第 1 轮问题正文（Markdown）
│   ├── attachments/<file> # 截图附件（图片后缀白名单）
│   └── rounds/<N>/
│       ├── question.md    # 第 N 轮追问正文（N ≥ 2）
│       └── answer.md      # 第 N 轮回答（Markdown）
└── runs/<runId>/          # codex 派发执行账本：run.json + events.jsonl + stderr.log + prompt.md + final-message.md
```

ticket.json：`{ id, title, status, createdAt, updatedAt, rounds[], dispatches[], history[] }`。
轮次：`{ no, mode, staff, by, dispatchedAt, answeredAt, error, attachments }`（第 1 轮问题在根
question.md，第 N≥2 轮在 rounds/N/question.md，回答统一在 rounds/N/answer.md）。
派单账本：`{ at, mode, staff, ids, kind: batch|single, by }`（zcode/codex 一致记录客服人员）。

单状态机（轻量、无人工接受环节，Agent/服务可经受控函数流转）：

```
pending --dispatch--> answering --answer--> answered
answered --ask--> pending（追问拉回）
answering --fail--> failed（记录原因）；failed --dispatch(重派)--> answering
```

- 编号：`ASK-YYYYMMDD-NNN`，独立序列（oncall/settings.json counters.ask），不与 REQ/BUG 混排。
- 附件：png/jpg/jpeg/gif/webp/svg/ico/bmp/avif 白名单；单文件 ≤8MB；文件名净化（防穿越）。
- 客服人员（staff）：仅展示与会话命名，长度 ≤30 字符（与 REQ-20260907-002 开发人员限制对齐），
  可空；空时展示「未指定」，不阻塞派单。
- 隔离：`core.listItems` 只扫 requirements/bugs，天然不含 ASK；不触碰 `.locks/impl.lock`；
  state-guard 铁律只拦 `**/status.json`，ticket.json 不在管辖内。

### 2. CLI（`atb oncall …`，受控入口，Agent 不手写 JSON）

```
atb oncall new --title <标题> [--question-file <md>] [--dir <项目根>]
atb oncall list [--status pending|answering|answered|failed] [--json]
atb oncall show <ASK-ID> [--json]                 # 元数据 + 各轮问题/回答全文
atb oncall ask <ASK-ID> --question-file <md>       # 追问（新轮次，状态拉回 pending）
atb oncall answer <ASK-ID> --by <会话> --mode zcode|codex [--file <md>|--stdin] [--staff <客服>]
atb oncall dispatch <ASK-ID>… --mode zcode [--staff <客服>]   # 生成主调度提示词（写派单账本）
```

### 3. 派单模式（复用现有基础设施）

- **zcode**：`oncall dispatch` / HTTP 接口生成 oncall 主调度提示词（人复制到 Zcode 本项目新会话，
  参考批次主调度模式）。提示词含会话命名指令「请将当前会话名改为：oncall-YYYYMMDD-<客服人员>」
  （未填客服人员时 oncall-YYYYMMDD-未指定）；每单一个新子 Agent，回答经
  `atb oncall answer … --mode zcode` 受控回传。
- **codex**：服务端 oncall 执行器（server.mjs 内每项目一个实例）逐单启动后台 codex exec（复用
  codex-adapter.startCodexExec：JSONL 事件、stderr 落盘、超时/取消受管回收）；提示词要求把完整
  回答作为最终回复输出；执行结束后服务端把 final-message.md 自动回传
  （`answerTicket`，mode=codex，by=oncall-YYYYMMDD-<staff|未指定>）→ 状态 answered。
  失败按 classifyFailure 分类记录轮次 error → 状态 failed，详情页展示原因与「重派」。
- oncall codex 执行**不占**项目实施互斥（impl.lock）：咨询为只读问答；项目内 oncall 执行并发 1，
  与 REQ/BUG 批次实施互不影响。

### 4. HTTP API（server.mjs，全部绑定 ?project=）

```
GET  /api/oncall/board                      # 卡片列表 + codexReady（CLI 是否就绪）
POST /api/oncall/ticket                     # 创建 { title, question, attachments:[{name,dataBase64}] }
GET  /api/oncall/ticket/:id                 # 详情元数据
GET  /api/oncall/ticket/:id/round/:no       # { question, answer }（Markdown 全文）
GET  /api/oncall/ticket/:id/attachment/:name# 图片原始字节（白名单 MIME + nosniff + CSP）
POST /api/oncall/ticket/:id/ask             # 追问 { question, attachments? }
POST /api/oncall/dispatch                   # 批量/单条派单 { ids, mode, staff }（zcode 返回提示词；codex 入队执行）
GET  /api/oncall/dispatch/records           # 派单账本（含 codex 执行状态）
POST /api/oncall/redispatch                 # 失败重派 { id, mode, staff }
```

### 5. 前端（新文件 `scripts/web/oncall.js` + app.js/index.html 挂钩）

- 顶栏 view-tabs 增第三个 tab「Oncall」（与「需求/文件」同款样式）；视图切换走 setView('oncall')。
- 列表页：状态筛选（待回复/回复中/已回复，含失败计数）、卡片（单号、标题、状态徽标、派单模式
  徽标、提问时间、回复轮数）、空态引导、勾选「待回复」单批量派单（模式选择 + 客服人员输入框，
  localStorage 记忆上次值 atb.oncall.staff）。
- 新建表单：标题 + Markdown 正文 + 截图上传（file 选择与粘贴均支持，base64 上传）；保存即入列
  表（pending），无需人工接受。
- 详情抽屉：问题与各轮回答 Markdown 渲染（marked），截图内联（/attachment 端点）点击放大
  （lightbox 遮罩）；每轮标注模式/时间/来源会话/客服人员；底部「问询」输入框 + 模式选择可追问。
- 状态反馈：随主 2 秒轮询拉 /api/oncall/board（签名去重）；codex 未就绪时隐藏 codex 模式入口
  （不显示假按钮）；失败单显示原因与重派入口。
- 独立 `#oncallDrawer` 抽屉（不与 REQ/BUG 详情抽屉共用状态）。

### 6. 影响面

- 新增：lib/oncall-store.mjs、web/oncall.js、tests/oncall-*.test.mjs。
- 修改：atb.mjs（oncall 子命令）、server.mjs（/api/oncall/* + oncall 执行器）、web/index.html
  （Oncall tab + oncallView/oncallDrawer 容器 + script 引入）、web/app.js（视图挂钩与轮询触发）、
  web/style.css（Oncall 样式）。
- 不动：core.mjs 状态机、batch/dispatch 实施账本、impl.lock 语义；/dev 与 /dev next 选单不受影响。

## 风险与边界

- oncall 提示词由人复制启动（zcode 模式），复制成功 ≠ 已派发；派单账本在调用 dispatch 时落盘，
  回传/自动回传才转 answered——与批次「登记运行后才显示执行中」同一口径。
- codex 模式后台执行消耗模型请求；仅用户显式点击派单触发，服务不自动巡检补派。
- 咨询单回答不承诺改代码；提示词明确「若结论涉及改代码，建议另建 /req」。
- 附件按图片白名单校验，杜绝把任意文件写入数据目录；详情页渲染前经 sanitizeHtml 兜底。

## 实施记录

- 2026-09-07（zcode-batch-003-01）：按本设计实施。数据层 `lib/oncall-store.mjs`（ASK 编号独立
  计数、pending/answering/answered/failed 状态流转、追问轮次、附件白名单、派单账本）；CLI
  `atb oncall new/list/show/ask/answer/dispatch`；server 增 `/api/oncall/*` 与 oncall codex 执行器
  （复用 startCodexExec，final-message 自动回传，不占 impl.lock）；前端 `web/oncall.js`
  Oncall 视图（列表/筛选/新建含粘贴截图/批量派单/详情 Markdown+内联图+放大/单条追问/重派），
  index.html 增 Oncall tab 与容器，app.js 挂钩视图切换与轮询。测试新增 oncall-store/cli/serve/
  dispatch/ui/isolation 六个文件。
