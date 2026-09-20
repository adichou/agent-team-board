# 设计 — REQ-20260909-009 新建条目的描述支持截图

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

统一新建弹窗（REQ-20260907-004）此前只有类型 / 标题 / 描述纯文本，创建需求 / Bug 时
没有附图途径。讨论模块曾有附件能力（REQ-20260907-001，`oncall-store` 的
`saveAttachment` / `readAttachment` / `attachmentMime`），随 REQ-20260909-004 重构移除。
本需求把该能力按「描述的可选补充」口径给到新建需求 / Bug：表单内粘贴或选择图片 →
服务端校验落盘条目目录 `attachments/` → README 描述（需求）/ 现象（Bug）节末尾追加
相对引用 → 详情抽屉 README 页签内联展示、点击放大。

## 方案

### 待确认项定稿（README「待确认」逐条）

1. **传输形态：单请求 JSON `dataBase64`（沿用讨论单）**。本地服务、单人使用，base64
   体积 +33% 可接受；服务端 `BODY_MAX_BYTES`（12MB）天然兜底极端请求。不做两步上传。
2. **拖拽不作为第三入口**：粘贴 + 文件选择已覆盖主要场景，不再扩面。
3. **张数上限取 9**（服务端 `core.ITEM_ATTACHMENTS_MAX`，前端 `SHOT_MAX_COUNT` 对齐）。
   达上限交互：**入口禁用**（「上传图片」按钮 disabled）+ 粘贴路径继续走校验被拒并
   就地提示（两个入口行为一致有兜底），计数显示「n / 9」。
4. **「✎ 修改」仅保证不丢既有引用**：编辑框载入描述节原文（含图片行）预填，保存按
   提交文本整体替换（README 即真源）；编辑时新增 / 删除截图不在本需求范围。
5. **图片接管用「渲染后拦截 img 节点」**（`linkupDocImages`，参照 `linkupDocDemo`
   先例，不改 markdown 源）；**附件端点新增 `/api/item/:id/attachment/:name`**，不泛化
   oncall 端点（后者绑定 ASK 编号与 `oncall/tickets` 目录，泛化反而混两条数据边界）。
6. **SVG 防护沿用现状口径**：附件端点响应头 `X-Content-Type-Options: nosniff` +
   `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`
   + `Cache-Control: no-store`（与讨论单附件 / `/api/fs/raw` 完全一致）；SVG 仅作为
   `<img src>` 加载，CSP 收敛下直接导航也无法执行脚本，不额外收紧。

### 数据层（`scripts/lib/core.mjs`）

- 附件常量与工具**上收 core 形成单一真源**：`ATTACHMENT_MAX_BYTES`（8MB）、
  `ATTACHMENT_IMAGE_MIME`（png/jpg/jpeg/gif/webp/svg/ico/bmp/avif）、新增
  `ITEM_ATTACHMENTS_MAX = 9`；`attachmentMime(name)`、`saveItemAttachment(dir, name, buf)`
  （防穿越文件名 + 白名单 + 8MB + 同名加序号不覆盖）、`readItemAttachment(dir, name)`
  （白名单 + 防穿越 + 8MB 在线展示上限）、`parseItemAttachments(list)`（张数 + 逐项
  校验，`{name, dataBase64}` → `{name, buf}`）。
- `oncall-store.mjs` 的同名常量 / 函数改为 import + re-export，`saveAttachment` /
  `readAttachment` 委托 core 实现（绑定 ASK 编号校验与 ticketDir），行为不变——
  条目截图与讨论单附件从此共用一套校验口径。
- `createItem` 扩展 `attachments = []`：**先全量校验（`parseItemAttachments`）再占号
  落盘**，任一附件非法抛 `AtbError` 整单拒绝、不创建目录、不消耗单号（对齐
  `core.editItem` 原子性口径）。落盘后按最终文件名（同名去重后）生成引用行
  `![截图](attachments/<encodeURIComponent(name)>)`，按添加顺序追加在描述正文末尾；
  描述为空时描述节只写引用行（不写「（待补充）」占位）；无附件时输出与旧版逐字节一致。

### 服务层（`scripts/server.mjs`）

- `POST /api/new` 透传 `attachments`（数组形态校验后交 core）；非法附件经既有
  `AtbError → 400` 通道返回明确原因，弹窗内容保留可重试、不产生重复条目。
- 新增 `GET /api/item/:id/attachment/:name`：`resolveItemDir` 定位条目（含归属需求的
  嵌套 Bug 目录），白名单 MIME + `readItemAttachment`（防穿越 + 8MB）；响应头口径
  与讨论单附件端点一致（见上）。条目不存在 / 附件不存在 → 400（JSON 错误，非演示页）。

### 前端（`scripts/web/index.html` + `app.js` + `style.css`）

- 弹窗描述字段下方新增截图区块 `#fShotRow`（标题行「截图（可选）+ n / 9 + 上传图片
  + 或直接 ⌘V 粘贴」、隐藏 `<input type=file accept="image/*" multiple>`、缩略图网格、
  空态引导、错误行）。`syncNewFormFields` 在类型为讨论时隐藏该区块（REQ-20260909-004
  口径不回退）。
- 添加入口两个：文件选择（多选，读完 `input.value` 复位允许重选同文件）；弹窗打开
  期间 `document paste` 监听，仅拦截含图片文件的剪贴板项（纯文本粘贴不受影响），
  自动命名 `paste-<毫秒时间戳>.<后缀>`（MIME 推断后缀、未知兜底 png，无路径、
  白名单后缀）。
- 本地即时校验 `shotValidate`：白名单后缀 / 单张 8MB / 张数 9——不合法项不进列表、
  就地提示（`#fShotError`），单张失败不影响已添加项。缩略图与提交共用一次
  `FileReader.readAsDataURL`（`dataUrl` 供 `<img>`，去前缀得 `base64` 供提交）。
- 提交：`submitNew` 需求 / Bug 分支携带 `attachments: [{name, dataBase64}]`（按添加
  顺序）；提交中 `shotBusy` 置位禁用添加 / 移除入口（与提交按钮禁用同步，防竞态），
  失败保留标题 / 描述 / 已附截图可重试；`openModal` 重开清空（对齐既有重置口径）。
- 抽屉展示：`linkupDocImages(view, itemId)` 渲染后拦截 `img`，把「attachments/ 单
  文件名」形态（`./` 前缀与裸相对均可）改写为 `/api/item/:id/attachment/:name`（带
  `?project=`）；协议绝对地址 / 根相对 / 子目录形态不动。`loadDoc` 与 `docCache`
  缓存回填（`activateDrawerTab`）两处接线。点击放大复用 `#oncallLightbox`（点击任意
  处 / Esc 关闭，对齐讨论单交互）；`onerror` 就地替换占位说明（文件被移动 / 删除 /
  超 8MB），不渲染空白破图。
- 样式：`.shot-list` flex-wrap（窄屏 ≤736px 缩略图可换行）、`.shot-x` 移除按钮
  （`:disabled` 态）、`.btn.small`；README 内联截图 `.doc-shot`（等宽缩略 + zoom-in
  光标，形态对齐讨论单 `figure.oncall-fig`）。深浅色沿用现有 CSS 变量。

### 影响面与兼容

- `createItem` 调用方（CLI `atb new`、讨论候选创建 `oncall-store.createItems`）不传
  `attachments`，行为不变；`POST /api/new` 旧调用（无 attachments 字段）兼容。
- `editItem`（REQ-20260908-011）描述节整体替换口径不变：图片行是描述节正文的
  一部分，编辑框预填原文（含图片行），仅改标题保存不动描述节，改描述按提交文本
  整体替换——「不丢既有引用」由预填原文保证；用户手动删掉图片行属预期编辑。
- 文件模块经 `/api/fs/raw` 预览 `attachments/` 图片的能力不受影响（README 口径）。
- `docs/` 随项目进 git，截图与 README 引用随之版本化；不改状态机、不写 status.json。

## 测试

- `scripts/tests/item-attachment-store.test.mjs`（S1–S7）：落盘与引用行、同名去重、
  整单拒绝（非白名单 / 8MB / 穿越 / 缺数据 / 超张数，不留目录不占号）、无附件口径
  不变、editItem 兼容、读取防穿越与展示上限。
- `scripts/tests/item-attachment-serve.test.mjs`（V1–V4）：/api/new 附件链路、附件
  端点响应头口径（MIME/nosniff/CSP/no-store）与原字节、非法附件 400 且不建条目、
  旧调用兼容。
- `scripts/tests/item-shot-ui.test.mjs`（U1–U7）：静态契约（区块位置 / accept /
  multiple / 样式）、类型切换隐藏、提交体携带与讨论不携带、本地校验与移除回退、
  openModal 重置、图片接管（相对改写 / 绝对不动 / 点击放大 / 失败占位 / 双接线）、
  粘贴自动命名。
- 既有回归：`drawer-tabs-20260909-006.test.mjs` 补 `linkupDocImages` 桩（缓存回填
  重新接管截图）；`npm test` 117 个测试文件全绿。
- 浏览器人工验收（M1–M3）：真实剪贴板粘贴、放大视觉与深浅色 / 窄屏、创建失败保留。

## 风险与边界

- 请求体上限：9 × 8MB 的极端提交会被 `BODY_MAX_BYTES`（12MB）以「请求体过大」拒绝，
  toast 明确原因且表单保留，用户移除部分截图即可重试——不放宽全局上限。
- README 引用行使用 `encodeURIComponent` 编码文件名（含空格等字符时 markdown 可正确
  解析）；人工手写引用若不编码，浏览器会按原样请求，端点对常见未编码字符同样可解码
  命中（`decodeURIComponent` 在路由匹配前完成）。
- SVG 含脚本的固有风险由附件端点收敛 CSP + nosniff 承接（与既有两处图片端点同口径），
  README 渲染层 `sanitizeHtml` 仍剥离脚本与内联事件，双层防护不放宽。
- 半写入窗口：附件全部校验通过后先写 status/文档再落盘附件，仅剩磁盘 IO 失败一类
  不可预期错误可能残留目录（与既有创建路径同级别风险），git 可回收。
