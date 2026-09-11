# 设计 — BUG-20260908-021 需求详情中的交互 Demo 相对链接打开后返回 404

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-021（把「README 界面展示节链接 `./ui-demo.html`」固化为完善流程口径——SKILL.md 与 server.mjs 注释均按该约定持续产出；自此所有涉及 UI 的已完善需求 README 都带这条相对链接，而看板文档抽屉自始未解析相对链接，链接按 SPA 页面 URL 解析到站点根必然 404。编号已经 `atb list` 核验存在，状态 in-progress。补充归因说明：看板侧「文档渲染不做相对链接重写」的代码局限随 Status Board 文档抽屉初始实现即存在，项目非 git 仓库、无历史可考证具体引入时点；更早的同类失效先例是 REQ-20260907-004 README 的 `./layout-demo.html`，彼时为一次性写法，REQ-20260908-021 才将其固化为全量产出约定，故源单归 REQ-20260908-021。）

## 根因分析

1. 看板是单页应用，页面路径恒为 `/`（`scripts/web/app.js` 的 `syncProjectUrl` 仅 `history.replaceState` 更新查询串，不产生真实路径）。
2. 详情抽屉渲染 README 时（`loadDoc` → `renderMd`（`sanitizeHtml` + `marked.parse`）→ 写入 `#docView`），渲染前后均未对 `<a>` 相对链接做重写，也无点击拦截；`./ui-demo.html` 按当前页面 URL 解析为站点根 `/ui-demo.html`，丢失项目与条目上下文（文档经 `/api/item/:id/doc/:name` 以 JSON 返回，前端不携带文档来源路径）。
3. 非 `/api` 的 GET 由 `serveFile` 处理，它只在 `webRoot`（`scripts/web`）内查找文件，根路径下没有 ui-demo.html → 纯文本 404。
4. 既有文件端点不能也不应承担交互 HTML 预览：`/api/fs/raw` 仅放行图片（REQ-20260906-010 白名单 + CSP `default-src 'none'`）；`/api/fs/file` 是 1MB 上限的 JSON 文本预览。

## 方案

取「看板内新端点 + CSP 收敛沙箱打开」（README「期望行为」所列两可方案之一），修复全部落在看板侧，条目 markdown 源（`./ui-demo.html` 写法）保持不变：

- 服务端（`scripts/server.mjs`）新增只读端点 `GET /api/item/:id/demo/:name`（`?project=` 绑定多项目）：
  - 名称白名单 `^[A-Za-z0-9][A-Za-z0-9._-]*\.(html|htm)$`（无斜杠、无前导点、仅 html/htm 后缀）+ `realpath` 必须落在条目目录内（防穿越与符号链接逃逸）；2MB 上限防大文件拖垮本地服务；`/demo/` 前缀的非法形态兜底返回提示页而非「未知接口」JSON。
  - 200 响应：`text/html; charset=utf-8` + `nosniff` + CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src/font-src/media-src data:; base-uri/form-action/frame-ancestors 'none'`——内联脚本/样式可用（按钮、页签、状态切换），外部加载与 fetch/XHR 全禁（演示页无法触达看板管理 API）。
  - 错误（条目/文件不存在 404，非法路径/超限 400）返回人读 HTML 提示页（该端点会被浏览器直接导航打开，JSON 错误对人不友好），提示页同样 nosniff + 收敛 CSP。
- 前端（`scripts/web/app.js`）新增 `linkupDocDemo(view, itemId)`，`loadDoc` 渲染 markdown 后调用：只接管「单文件名 .html/.htm」相对链接（`./` 前缀与裸文件名），改写 `href` 为 `apiUrl('/api/item/<id>/demo/<name>')`（自动携带当前 project），并设 `target="_blank"` + `rel="noopener noreferrer"`（新标签打开，演示页拿不到看板页引用）；协议绝对地址、`#` 锚点、带子目录/越出条目的相对路径保持原有行为不动。REQ-20260907-004 的 `./layout-demo.html` 为同形态，自动覆盖（验收第 8 条）。

## 风险与边界

- CSP 放行 `'unsafe-inline'` 脚本是演示交互的前提，仅作用于本端点返回的页面；该页经 noopener 新标签打开（无 opener 引用），fetch/XHR 被 `default-src 'none'` 禁止，无法操作看板管理 API；既有防护（`/api/fs/raw` 图片口径、防穿越规则、BUG-20260907-005 跨站防护）一概不放宽，与 REQ-20260908-021 边界节「不为演示取消既有访问保护」一致。
- 正在运行的看板服务路由集在启动时固化（BUG-20260907-017 口径）：需 `atb serve`（或手动重启服务）后新端点才生效；期间点击改写后的链接会得到旧服务「未知接口」JSON，重启即自愈。
- 演示内容自身的注入面维持 `sanitizeHtml` 现状（本地仓库 markdown 约定产出），本 Bug 不扩面；同名单文件名靠「条目号 + project」双键隔离，不串单、不串项目。

## 实施记录（2026-09-09，zcode-batch-018-1）

- `scripts/server.mjs`：新增 `DEMO_HTML_NAME_RE` / `DEMO_HTML_MAX_BYTES` / `DEMO_HTML_CSP` 常量、`escapeHtmlText`、`sendDemoHtmlPage` 错误页，`/api/item/:id/demo/:name` 路由与 `/demo/` 前缀兜底 400 提示页（置于 docMatch 之后、最终 404 之前）。
- `scripts/web/app.js`：新增 `linkupDocDemo`（紧随 `renderMd`/`apiUrl`），`loadDoc` 渲染后接线调用。
- 测试：新增 `scripts/tests/item-demo-link.test.mjs`（D1–D7 端点行为 + U1–U4 前端结构契约与 vm 行为），`run-all.mjs` 按 `*.test.mjs` 通配自动纳入。
