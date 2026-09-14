# 设计 — REQ-20260910-028 新建讨论时支持上传截图，和新建需求、bug 一样

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

新建弹窗的截图区块（上传 / 粘贴 / 校验 / 缩略图 / 大图预览）在 REQ-20260909-009 / 017 已为需求 / Bug 建成；
`syncNewFormFields()` 在类型切到「讨论（ASK）」时将区块整体隐藏（REQ-20260909-004「讨论不回加」口径）。
讨论单目录（oncall/tickets/ASK-…）的附件基础设施（saveAttachment / readAttachment 落盘
`<讨论目录>/attachments/`、GET `/api/oncall/ticket/:id/attachment/:name`）自 REQ-20260907-001 已存在。
讨论已改为外部 Agent 会话自由讨论（REQ-20260909-004 / 20260910-018），截图重新有了用途，本需求去掉隐藏并打通提交链路。

## 方案

自研（复用既有口径，无新增依赖）。理由：所需能力（附件校验 / 落盘 / 预览 / 预检）在 core、oncall-store、
app.js、oncall.js 中均已有成熟实现，本需求是既有链路对讨论类型的开放与端点补齐，引入开源库成本高于复用。

### 1. 数据层（scripts/lib/oncall-store.mjs）

- `createDiscussion(dataDir, { title, background, by, attachments = [] })` 新增 attachments 参数：
  - **先全量校验再占号**：`core.parseItemAttachments(attachments)`（张数 ≤9 / 白名单 png…avif / 单张 ≤8MB /
    dataBase64 形态；任一非法抛错整单拒绝，不消耗 ASK 单号、不留半成品目录——对齐 createItem 原子性口径）。
  - 占号建目录后逐个 `saveAttachment`（core.saveItemAttachment：防穿越 + 同名自动加序号不覆盖），
    最终文件名记入 `ticket.json` 顶层新字段 `attachments`（仅新讨论写该字段；旧单轮次附件仍在 rounds[].attachments，
    展示不受影响）。
  - `question.md`（讨论背景）末尾按添加顺序追加 `![截图](attachments/<encodeURIComponent(文件名)>)` 引用行
    （对齐需求 / Bug README 描述节口径）；背景为空仅截图时 question.md 只含引用行。
- `discussionFull()` 响应补 `attachments`（顶层字段读出，列表卡片不带，保持列表精简）。
- `buildStartPrompt()`：meta.attachments 非空时在背景后追加一行绝对路径提示
  （`（讨论背景附 N 张截图，位于 <讨论目录>/attachments/ 下：…，可按需读取查看）`，
  对齐 buildOncallWorkerPrompt 的旧口径）。

### 2. 服务层（scripts/server.mjs）

- `POST /api/discussion` 透传 `attachments`（`Array.isArray(body.attachments) ? body.attachments : []`）。
- 新增 `GET /api/discussion/:id/attachment/:name`：讨论附件原始字节，口径与
  `/api/oncall/ticket/:id/attachment/:name` 完全一致（白名单图片 MIME + nosniff + 收敛 CSP + no-store + 8MB），
  仅复用 `oncall.readAttachment`。新交互走 /api/discussion* 的既有约定；旧服务对该路径返回 404「未知接口」，
  作为前端过旧预检探针（BUG-20260909-010 口径延伸：该路由随本需求上线）。

### 3. 新建表单前端（scripts/web/app.js + index.html）

- `syncNewFormFields()`：删除「类型为 ask 时隐藏 #fShotRow」的分支——截图区块三类类型都显示；
  「创建并接受」仍仅需求 / Bug 显示（讨论无接受概念）。区块内部交互（上传 / 粘贴 / 校验 / 移除 / 双击放大 /
  提交中禁用）不动，类型切换不丢已添加截图（仅重新打开面板清空，现状口径）。
- `submitNew()` ask 分支：
  - `newShots.length` 时先过 `discussionServeSupportsAttachments()` 预检
    （GET `/api/discussion/ASK-20990101-999/attachment/probe.png`；仅「未知接口：」JSON 404 判定过旧，
    2xx / 业务 4xx / 网络异常一律放行——保守拦截口径与 `shotServeSupportsAttachments` 相同）；
    过旧时拒绝提交、toast 给 `atb serve` 自愈指引，弹窗与截图保留可重试，不静默丢截图。
  - 请求体携带 `attachments: newShots.map((s) => ({ name, dataBase64 }))`（与 /api/new 同形态、按添加顺序）。
- index.html 注释同步（fShotRow 不再按讨论隐藏）。

### 4. 讨论详情前端（scripts/web/oncall.js）

- 讨论背景随 question.md 的引用行渲染出相对图片（SPA 页面路径恒为 /，不接管必 404）：
  `renderDetail()` 渲染后对相对 `attachments/<单文件名>` 形态 img 做接管——src 改写为
  `/api/discussion/:id/attachment/:name`、点击放大复用 #oncallLightbox、加载失败就地替换为占位说明
  （不渲染破损图标，对齐 app.js linkupDocImages 条目文档图片先例）；http(s)/data: 绝对地址、子目录形态不接管。
- 旧讨论（无引用行）无相对 img 可接管，展示不变。

## 风险与边界

- 旧服务 + 新前端版本错配：POST /api/discussion 的 JSON 多余字段被旧进程忽略仍 201 创建、截图无痕丢失
  ——由预检拦截（第 3 节），对齐 BUG-20260909-010；无截图路径不预检，兼容早于本功能的服务。
- 旧讨论数据兼容：顶层 attachments 字段仅新讨论写入；discussionCard / 列表不读该字段，旧单列表与详情不受影响；
  旧单轮次附件继续走 /api/oncall/ticket 端点与「历史问答」区块渲染。
- 校验双层：前端即时校验（体验）+ 服务端 parseItemAttachments 二次校验（兜底），任一附件非法整单拒绝。
- question.md 引用行由创建时一次性生成；Agent / 人直接读 markdown 可见路径，看板内由前端接管展示。
