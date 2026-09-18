# BUG-20260908-021 需求详情中的交互 Demo 相对链接打开后返回 404

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260908-021（把 README 链接 `./ui-demo.html` 固化为完善口径，看板文档抽屉自始不解析相对链接，按 SPA 页面路径落到站点根 404；编号已经 `atb list` 核验，详见 design.md 源单节）
- 创建：2026-09-08T15:18:54.537Z

## 现象

在 REQ-20260908-026 需求详情中点击 README 的 ./ui-demo.html 链接，被解析为站点根路径 http://127.0.0.1:8888/ui-demo.html，返回 404 not found；实际文件位于该需求目录。期望从看板直接打开对应需求的可交互 Demo。

失效链条（均可从代码核实）：看板是单页应用，页面路径始终为 `/`（`scripts/web/app.js` 的 `history.replaceState` 仅更新查询串，约 406 行）；详情抽屉渲染 README 时（`loadDoc`，约 2263-2275 行）把 `/api/item/:id/doc/README.md` 返回的正文经 `renderMd`（`sanitizeHtml` + `marked.parse`，约 167-176 行）直接写入 `#docView`，渲染前后都没有对 `<a>` 的相对链接做重写，也没有点击拦截。于是 `./ui-demo.html` 按「当前页面 URL」解析为站点根 `/ui-demo.html`；而非 `/api/` 的 GET 请求由 `serveFile`（`scripts/server.mjs` 约 205-218 行）处理，它只在 `webRoot`（= `scripts/web`，`scripts/server.mjs` 第 32 行）内查找文件，根路径下并无 ui-demo.html，固化为纯文本 404 `not found`。

## 复现步骤

1. 打开本项目看板：`http://127.0.0.1:8888/?project=%2FUsers%2Fadichou%2FDocuments%2Fsrc%2Fagent-team-board`（默认端口 8888，`scripts/server.mjs` 第 36 行 `DEFAULT_PORT`）。
2. 在需求面板打开 REQ-20260908-026，查看 README 的「界面展示」。
3. 点击「打开已确认的交互 Demo」（目标为 `./ui-demo.html`）。
4. 浏览器访问 `http://127.0.0.1:8888/ui-demo.html`，显示 `404 / not found`。

## 已核实的现象

- `curl http://127.0.0.1:8888/ui-demo.html` 返回 HTTP 404，响应正文为 `not found`。
- 实际文件存在：`docs/agent-team-board/requirements/REQ-20260908-026/ui-demo.html`，可通过系统浏览器直接打开本地文件。
- 当前服务的普通静态路径未映射到需求目录（`serveFile` 只服务 `scripts/web`），`/api/fs/raw` 仅允许图片预览（白名单 png/jpg/jpeg/gif/webp/svg/ico/bmp/avif + 8MB 上限 + CSP `default-src 'none'`，`scripts/server.mjs` 约 306-328 行，REQ-20260906-010），不能直接承担交互 HTML 预览；`/api/fs/file` 是 1MB 上限的 JSON 文本预览接口，也不是 HTML 导航端点。
- 相对链接未按当前需求文档所在目录解析，丢失了项目和条目上下文；文档内容经 `/api/item/:id/doc/:name`（`scripts/server.mjs` 约 1656-1662 行）以 JSON 返回，前端渲染时不携带文档来源路径信息。
- 同类失效先例：REQ-20260907-004 README 第 45 行的 `[交互演示（HTML 片段）](./layout-demo.html)`，文件在其条目目录存在，同样在看板内点击即落到站点根 404。
- 完整根因及引入版本在修复阶段进一步核实（见「关联」）。

## 期望行为

从需求详情点击交互 Demo 链接，应直接打开当前项目、当前需求目录下对应的 HTML，并支持其中的本地交互；无需用户手动寻找文件或复制路径。多项目切换后仍应定位正确项目。

与 REQ-20260908-021 边界的衔接（修复方案须显式处理，具体设计留 design.md）：该需求的边界节明确「Status Board 内嵌可交互预览不在本期：/api/fs/raw 仅支持图片且 CSP `default-src 'none'`，html 无法在面板内执行；人工用本地浏览器打开条目目录下的 ui-demo.html 查看……面板是否增加『打开演示』入口：待确认，如需另行立项」，其界面展示节也将打开方式定为「本地浏览器直接打开」。本 Bug 的诉求是不再出现可点击却必然 404 的链接；实现取「看板内（新端点/沙箱）打开」还是「引导跳转本地文件/系统浏览器」由修复阶段定夺，但不得为支持演示直接放开既有访问保护（防穿越、MIME 白名单、CSP 收敛）。

## 验收标准

- [ ] REQ-20260908-026 README 中的 Demo 链接可从看板直接打开，不返回站点根路径 404。
- [ ] Demo 内按钮、页签、状态切换等交互可用。
- [ ] 相同文件名在不同需求或项目中能正确区分，不串单、不串项目。
- [ ] 文件不存在时给出明确提示；非法路径不能越出允许的项目范围。
- [ ] HTML 预览与看板管理接口保持合理隔离，不为支持演示而取消既有访问保护。
- [ ] 既有 Markdown 链接、文件浏览和图片预览不受影响。
- [ ] README 源文件中的 `./ui-demo.html` 相对链接写法保持不变（继续兼容编辑器/GitHub 中的相对跳转与 REQ-20260908-021 的判定口径），修复在看板侧生效。
- [ ] 同类相对链接（如 REQ-20260907-004 的 `./layout-demo.html`）不再落到站点根 404，或在修复说明中明确记录豁免范围。

## 关联

- 复现条目：REQ-20260908-026（包含本次无法从看板打开的 Demo；不是已确认的引入来源）。
- 约定源头（已核实）：REQ-20260908-021 把「README 界面展示节链接 `./ui-demo.html`」固化为完善流程口径（`skills/agent-team-board/SKILL.md` 第 26、51、86-87 行；`scripts/server.mjs` 约 838 行注释），从此所有涉及 UI 的已完善需求 README 都带这条看板内必然 404 的相对链接；同类失效更早已由 REQ-20260907-004 的 `./layout-demo.html` 先例出现。
- 看板侧「文档渲染不做相对链接重写」为现状代码事实（`scripts/web/app.js` 的 `loadDoc`/`renderMd`）；该局限的引入时点无法考证（项目目录非 git 仓库，无历史可查），待确认。最终归因按原计划在修复阶段核验后记入 design.md 和头部元信息。
